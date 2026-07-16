import type { RequestAssetV1 } from './request-asset'
import type { ExportPreview, ExportWarning } from './request-export'

type HttpRequestAsset = Extract<RequestAssetV1, { protocol: 'http' }>
type QueryEntry = Readonly<{ enabled: boolean; key: string; value: string }>

const quote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`

function encodePart(value: string): string {
  return value
    .split(/(\{\{[A-Za-z_][A-Za-z0-9_]*\}\})/)
    .map((part) =>
      /^\{\{[A-Za-z_][A-Za-z0-9_]*\}\}$/.test(part) ? part : encodeURIComponent(part),
    )
    .join('')
}

function withQuery(url: string, entries: readonly QueryEntry[]): string {
  const enabled = entries.filter((entry) => entry.enabled)
  if (enabled.length === 0) return url
  const fragmentStart = url.indexOf('#')
  const base = fragmentStart < 0 ? url : url.slice(0, fragmentStart)
  const fragment = fragmentStart < 0 ? '' : url.slice(fragmentStart)
  const separator = base.includes('?')
    ? base.endsWith('?') || base.endsWith('&')
      ? ''
      : '&'
    : '?'
  const query = enabled
    .map((entry) => `${encodePart(entry.key)}=${encodePart(entry.value)}`)
    .join('&')
  return `${base}${separator}${query}${fragment}`
}

function filename(name: string): string {
  const stem = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
  return `${stem || 'request'}.sh`
}

export function createCurlExportPreview(asset: HttpRequestAsset): ExportPreview {
  const request = asset.request
  const warnings: ExportWarning[] = []
  const query: QueryEntry[] = request.params.map(({ enabled, key, value }) => ({
    enabled,
    key,
    value,
  }))
  if (request.auth.type === 'api-key' && request.auth.placement === 'query') {
    query.push({ enabled: true, key: request.auth.key, value: request.auth.value })
  }

  const args = [
    '--globoff',
    `--request ${quote(request.method)}`,
    `--url ${quote(withQuery(request.url, query))}`,
  ]
  for (const header of request.headers) {
    if (header.enabled) args.push(`--header ${quote(`${header.key}: ${header.value}`)}`)
  }
  if (request.auth.type === 'bearer') {
    args.push(`--header ${quote(`Authorization: Bearer ${request.auth.token}`)}`)
  } else if (request.auth.type === 'basic') {
    args.push(`--user ${quote(`${request.auth.username}:${request.auth.password}`)}`)
  } else if (request.auth.type === 'api-key' && request.auth.placement === 'header') {
    args.push(`--header ${quote(`${request.auth.key}: ${request.auth.value}`)}`)
  }

  const hasContentType = request.headers.some(
    (header) => header.enabled && header.key.toLowerCase() === 'content-type',
  )
  const body = request.body
  if (body.type === 'json') {
    if (!hasContentType) args.push(`--header ${quote('Content-Type: application/json')}`)
    args.push(`--data-raw ${quote(body.content)}`)
  } else if (body.type === 'text') {
    if (body.contentType && !hasContentType) {
      args.push(`--header ${quote(`Content-Type: ${body.contentType}`)}`)
    }
    args.push(`--data-raw ${quote(body.content)}`)
    warnings.push({
      code: 'opaque-text',
      message: 'Review unstructured text for opaque sensitive values.',
    })
  } else if (body.type === 'form-urlencoded') {
    for (const entry of body.entries) {
      if (entry.enabled) args.push(`--data-urlencode ${quote(`${entry.key}=${entry.value}`)}`)
    }
  } else if (body.type === 'multipart') {
    for (const entry of body.entries) {
      if (!entry.enabled) continue
      if (entry.kind === 'text') {
        args.push(`--form ${quote(`${entry.key}=${entry.textValue ?? ''}`)}`)
      } else {
        warnings.push({
          code: 'file-content-omitted',
          message: 'Local file content was omitted.',
        })
      }
    }
  } else if (body.type === 'binary') {
    warnings.push({
      code: 'file-content-omitted',
      message: 'Local file content was omitted.',
    })
  }

  if (JSON.stringify(asset).includes('[REDACTED]')) {
    warnings.unshift({ code: 'sanitized-values', message: 'Sensitive values were redacted.' })
  }
  return {
    format: 'curl',
    protocol: 'http',
    filenameSuggestion: filename(asset.name),
    content: ['curl \\', ...args.map((argument, index) =>
      `  ${argument}${index === args.length - 1 ? '' : ' \\'}`,
    )].join('\n'),
    warnings,
  }
}
