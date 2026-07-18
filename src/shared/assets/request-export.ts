import { requestAssetV1Schema, type RequestAssetV1 } from './request-asset'
import { mapSavedRequestToAsset, type SavedRequestAssetRow } from './request-asset-mapper'

export type ExportWarning = Readonly<{ code: string; message: string }>

export type ExportPreview = Readonly<{
  format: 'curl'
  protocol: 'http'
  filenameSuggestion: string
  content: string
  warnings: readonly ExportWarning[]
}>

const REDACTED = '[REDACTED]'
const INVALID_EXPORT_DATA = 'Saved request export data is invalid.'
const INVALID_JSON_BODY = 'Request export JSON body is invalid.'
const protectedValue = /^(?:\s*\{\{[A-Za-z_][A-Za-z0-9_]*\}\}\s*)+$/
const sensitiveKey = /authorization|cookie|token|password|api[-_ ]?key|secret/i

function protect(value: unknown): unknown {
  return typeof value === 'string' && (value === REDACTED || protectedValue.test(value))
    ? value
    : REDACTED
}

function parseJson(value: string, safeMessage = INVALID_EXPORT_DATA): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new TypeError(safeMessage)
  }
}

function sanitizeUrl(value: string): string {
  const safeAuthority = value.replace(
    /^([a-z][a-z\d+.-]*:\/\/)[^/?#]*@/i,
    '$1[REDACTED]@',
  )
  const queryStart = safeAuthority.indexOf('?')
  if (queryStart < 0) return safeAuthority
  const fragmentStart = safeAuthority.indexOf('#', queryStart)
  const queryEnd = fragmentStart < 0 ? safeAuthority.length : fragmentStart
  const query = safeAuthority.slice(queryStart + 1, queryEnd)
  const sanitized = query
    .split('&')
    .map((part) => {
      const separator = part.indexOf('=')
      const rawKey = separator < 0 ? part : part.slice(0, separator)
      let key: string
      try {
        key = decodeURIComponent(rawKey.replace(/\+/g, ' '))
      } catch {
        throw new TypeError(INVALID_EXPORT_DATA)
      }
      if (!sensitiveKey.test(key)) return part
      const rawValue = separator < 0 ? '' : part.slice(separator + 1)
      let decodedValue: string
      try {
        decodedValue = decodeURIComponent(rawValue.replace(/\+/g, ' '))
      } catch {
        throw new TypeError(INVALID_EXPORT_DATA)
      }
      const safeValue = protect(decodedValue)
      return `${rawKey}=${safeValue === decodedValue ? rawValue : String(safeValue)}`
    })
    .join('&')
  return `${safeAuthority.slice(0, queryStart + 1)}${sanitized}${safeAuthority.slice(queryEnd)}`
}

function sanitizeEntries(value: unknown): unknown {
  if (!Array.isArray(value)) return value
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
    const copy = { ...(entry as Record<string, unknown>) }
    if (typeof copy.value === 'string') copy.value = sanitizeText(copy.value)
    if (typeof copy.key === 'string' && sensitiveKey.test(copy.key)) {
      copy.value = protect(copy.value)
    }
    if (typeof copy.description === 'string') copy.description = sanitizeText(copy.description)
    return copy
  })
}

function sanitizeAuth(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const auth = { ...(value as Record<string, unknown>) }
  if (auth.type === 'bearer') auth.token = protect(auth.token)
  if (auth.type === 'basic') auth.password = protect(auth.password)
  if (auth.type === 'api-key') auth.value = protect(auth.value)
  return auth
}

function sanitizeJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeJsonValue)
  if (typeof value === 'string') return sanitizeText(value)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      sensitiveKey.test(key) ? protect(child) : sanitizeJsonValue(child),
    ]),
  )
}

function protectTextValue(value: string): string {
  const scheme = /^([A-Za-z][\w.-]*\s+)(.+)$/.exec(value)
  if (scheme) {
    const credential = protect(scheme[2])
    return credential === scheme[2] ? `${scheme[1]}${credential}` : REDACTED
  }
  return String(protect(value))
}

function sanitizeText(content: string): string {
  return content
    .replace(
      /\b(authorization\s*[:=])\s*((?:[A-Za-z][\w.-]*\s+)?[^\s,;]+)/gi,
      (_match, prefix: string, value: string) => `${prefix} ${protectTextValue(value)}`,
    )
    .replace(
      /\b(cookie|token|password|api[-_ ]?key|secret)\s*([=:])\s*([^\s&,;]+)/gi,
      (_match, key: string, separator: string, value: string) =>
        `${key}${separator}${protectTextValue(value)}`,
    )
    .replace(/[A-Za-z]:\\[^\r\n"',;]*?\.[A-Za-z0-9]{1,10}(?=\s|$|[,;])/g, REDACTED)
    // ponytail: unquoted extensionless paths have no reliable endpoint, so redact to a safe delimiter.
    .replace(/[A-Za-z]:\\[^\r\n"',;]+(?=$|[,;])/g, REDACTED)
    .replace(/[A-Za-z]:\\[^\r\n\s"',;]+/g, REDACTED)
    .replace(
      /\/(?:Users|home|tmp|var|opt|etc)\/[^\r\n"',;]*?\.[A-Za-z0-9]{1,10}(?=\s|$|[,;])/g,
      REDACTED,
    )
    .replace(
      /\/(?:Users|home|tmp|var|opt|etc)\/[^\r\n"',;]+(?=$|[,;])/g,
      REDACTED,
    )
    .replace(/\/(?:Users|home|tmp|var|opt|etc)\/[^\r\n\s"',;]+/g, REDACTED)
}

function sanitizeBody(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const body = { ...(value as Record<string, unknown>) }
  if (body.type === 'json' && typeof body.content === 'string') {
    body.content = JSON.stringify(
      sanitizeJsonValue(parseJson(body.content, INVALID_JSON_BODY)),
    )
  } else if (body.type === 'text' && typeof body.content === 'string') {
    body.content = sanitizeText(body.content)
  } else if (body.type === 'form-urlencoded') {
    body.entries = sanitizeEntries(body.entries)
  } else if (body.type === 'multipart' && Array.isArray(body.entries)) {
    body.entries = body.entries.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
      const copy = { ...(entry as Record<string, unknown>) }
      if (copy.kind === 'file') copy.fileRef = null
      if (typeof copy.filename === 'string') copy.filename = sanitizeText(copy.filename)
      if (typeof copy.description === 'string') copy.description = sanitizeText(copy.description)
      if (copy.kind === 'text' && typeof copy.key === 'string' && sensitiveKey.test(copy.key)) {
        copy.textValue = protect(copy.textValue)
      }
      return copy
    })
  } else if (body.type === 'binary') {
    body.fileRef = null
  }
  return body
}

function sanitizeStreamConfig(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const config = { ...(value as Record<string, unknown>) }
  if ('body' in config) config.body = sanitizeBody(config.body)
  return config
}

export function sanitizeRequestAssetForOutput(asset: RequestAssetV1): RequestAssetV1 {
  try {
    const request = asset.request
    const sanitizedRequest: Record<string, unknown> = {
      ...request,
      url: sanitizeUrl(request.url),
      params: sanitizeEntries(request.params),
      headers: sanitizeEntries(request.headers),
      auth: sanitizeAuth(request.auth),
    }
    if ('body' in request) sanitizedRequest.body = sanitizeBody(request.body)

    return requestAssetV1Schema.parse({
      ...asset,
      name: sanitizeText(asset.name),
      description: sanitizeText(asset.description),
      request: sanitizedRequest,
    })
  } catch {
    throw new TypeError(INVALID_EXPORT_DATA)
  }
}

export function mapSavedRequestToExportAsset(row: SavedRequestAssetRow): RequestAssetV1 {
  try {
    return mapSavedRequestToAsset({
      ...row,
      name: sanitizeText(row.name),
      description: sanitizeText(row.description),
      url: sanitizeUrl(row.url),
      params_json: JSON.stringify(sanitizeEntries(parseJson(row.params_json))),
      headers_json: JSON.stringify(sanitizeEntries(parseJson(row.headers_json))),
      auth_json: JSON.stringify(sanitizeAuth(parseJson(row.auth_json))),
      body_json: JSON.stringify(sanitizeBody(parseJson(row.body_json))),
      stream_config_json: JSON.stringify(sanitizeStreamConfig(parseJson(row.stream_config_json))),
    })
  } catch (error) {
    if (error instanceof TypeError && error.message === INVALID_JSON_BODY) throw error
    // Export errors intentionally drop secret-bearing source data, including `cause`.
    // eslint-disable-next-line preserve-caught-error
    throw new TypeError(INVALID_EXPORT_DATA)
  }
}
