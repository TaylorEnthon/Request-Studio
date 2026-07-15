import { defaultHttpConfig } from '../schemas/http'
import {
  CurlParseError,
  tokenizeCurl,
  type CurlDialect,
  type CurlDialectOption,
} from './curl-tokenizer'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
type Entry = Readonly<{ id: string; enabled: true; key: string; value: string }>
type Auth =
  | Readonly<{ type: 'none' }>
  | Readonly<{ type: 'bearer'; token: string }>
  | Readonly<{ type: 'basic'; username: string; password: string }>
type Body =
  | Readonly<{ type: 'none' }>
  | Readonly<{ type: 'json'; content: string }>
  | Readonly<{ type: 'text'; content: string; contentType?: string }>

export interface SensitiveField {
  readonly kind: 'bearer' | 'basic-username' | 'basic-password' | 'api-key' | 'header-secret'
  readonly position: number
  readonly placeholder: string
}

export interface ParsedCurlRequest {
  readonly dialect: CurlDialect
  readonly request: Readonly<{
    method: Method
    url: string
    params: readonly Entry[]
    headers: readonly Entry[]
    auth: Auth
    body: Body
    settings: Readonly<{ timeoutMs: number }>
  }>
  readonly sensitiveFields: readonly SensitiveField[]
  readonly warnings: readonly string[]
}

const methods = new Set<Method>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const sensitiveKey = /authorization|cookie|token|password|api[-_ ]?key|secret/i
const fileFlags = new Set([
  '--config', '--form', '--upload-file', '--cert', '--key', '--cacert', '--capath', '--cookie',
  '--cookie-jar', '--output', '--trace', '--trace-ascii', '--data-binary', '-K', '-F', '-T', '-b', '-c', '-o',
])

interface PositionedValue {
  value: string
  position: number
}

const placeholderBase = (key: string): string => {
  if (/api[-_ ]?key/i.test(key)) return 'API_KEY'
  if (/password/i.test(key)) return 'PASSWORD'
  if (/token/i.test(key)) return 'TOKEN'
  if (/cookie/i.test(key)) return 'COOKIE'
  if (/authorization/i.test(key)) return 'AUTHORIZATION'
  return 'HEADER_SECRET'
}

const secretKind = (key: string): SensitiveField['kind'] =>
  /api[-_ ]?key/i.test(key) ? 'api-key' : 'header-secret'

export function parseCurl(input: string, requestedDialect: CurlDialectOption = 'auto'): ParsedCurlRequest {
  const { dialect, tokens } = tokenizeCurl(input, requestedDialect)
  if (!tokens.length || !/^curl(?:\.exe)?$/i.test(tokens[0].value)) {
    throw new CurlParseError('INVALID_COMMAND', 'Input must start with curl or curl.exe.', tokens[0]?.start, dialect)
  }

  let method: Method | undefined
  let urlValue: PositionedValue | undefined
  let user: PositionedValue | undefined
  const rawHeaders: PositionedValue[] = []
  const data: PositionedValue[] = []

  const missingValue = (flag: string, position: number): never => {
    throw new CurlParseError('MISSING_VALUE', 'A supported cURL option is missing its value.', position, dialect, flag)
  }
  const takeNext = (index: number, flag: string, inline?: string): [PositionedValue, number] => {
    if (inline !== undefined) {
      if (!inline) missingValue(flag, tokens[index].start)
      return [{ value: inline, position: tokens[index].start + flag.length + 1 }, index]
    }
    const next = tokens[index + 1]
    if (!next) missingValue(flag, tokens[index].start)
    return [{ value: next.value, position: next.start }, index + 1]
  }

  for (let index = 1; index < tokens.length; index += 1) {
    const token = tokens[index]
    const equal = token.value.startsWith('--') ? token.value.indexOf('=') : -1
    const flag = equal > 0 ? token.value.slice(0, equal) : token.value
    const inline = equal > 0 ? token.value.slice(equal + 1) : undefined

    const shortFlag = /^-[XHdu]/.test(flag) ? flag.slice(0, 2) : flag
    const shortInline = shortFlag !== flag ? flag.slice(2) : undefined
    const option = shortFlag
    if (fileFlags.has(option) || fileFlags.has(flag)) {
      throw new CurlParseError('FILE_REFERENCE', 'File-based cURL options are not supported.', token.start, dialect, option)
    }

    if (['-X', '--request', '--url', '-H', '--header', '-d', '--data', '--data-raw', '-u', '--user'].includes(option)) {
      const [found, consumed] = takeNext(index, option, inline ?? shortInline)
      index = consumed
      if (option === '-X' || option === '--request') {
        const normalized = found.value.toUpperCase() as Method
        if (!methods.has(normalized)) {
          throw new CurlParseError('UNSUPPORTED_FLAG', 'The requested HTTP method is not supported.', found.position, dialect, option)
        }
        method = normalized
      } else if (option === '--url') {
        if (urlValue) throw new CurlParseError('MULTIPLE_URLS', 'Exactly one URL is supported.', found.position, dialect)
        urlValue = found
      } else if (option === '-H' || option === '--header') rawHeaders.push(found)
      else if (option === '-d' || option === '--data' || option === '--data-raw') {
        if (found.value.startsWith('@')) {
          throw new CurlParseError('FILE_REFERENCE', 'File data references are not supported.', found.position, dialect, option)
        }
        data.push(found)
      } else user = found
      continue
    }

    if (token.value.startsWith('-')) {
      throw new CurlParseError('UNSUPPORTED_FLAG', 'This cURL option is not supported.', token.start, dialect)
    }
    if (urlValue) throw new CurlParseError('MULTIPLE_URLS', 'Exactly one URL is supported.', token.start, dialect)
    urlValue = { value: token.value, position: token.start }
  }

  if (!urlValue) throw new CurlParseError('INVALID_URL', 'A request URL is required.', undefined, dialect)

  let parsedUrl: URL
  try {
    parsedUrl = new URL(urlValue.value)
  } catch {
    throw new CurlParseError('INVALID_URL', 'The request URL is invalid.', urlValue.position, dialect)
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new CurlParseError('INVALID_URL', 'Only HTTP and HTTPS URL protocols are supported.', urlValue.position, dialect)
  }
  if (parsedUrl.username || parsedUrl.password) {
    throw new CurlParseError('INVALID_URL', 'Credentials embedded in URLs are not supported.', urlValue.position, dialect)
  }

  const sensitiveFields: SensitiveField[] = []
  const counts = new Map<string, number>()
  const placeholder = (base: string): string => {
    const count = (counts.get(base) ?? 0) + 1
    counts.set(base, count)
    return `{{${base}${count === 1 ? '' : `_${count}`}}}`
  }
  const record = (kind: SensitiveField['kind'], position: number, base: string): string => {
    const value = placeholder(base)
    sensitiveFields.push({ kind, position, placeholder: value })
    return value
  }

  const params: Entry[] = []
  let paramIndex = 0
  for (const [key, value] of parsedUrl.searchParams) {
    paramIndex += 1
    params.push({
      id: `curl-param-${paramIndex}`,
      enabled: true,
      key,
      value: sensitiveKey.test(key) ? record(secretKind(key), urlValue.position, placeholderBase(key)) : value,
    })
  }
  parsedUrl.search = ''
  parsedUrl.hash = ''

  let auth: Auth = { type: 'none' }
  if (user) {
    const separator = user.value.indexOf(':')
    if (separator < 0) {
      throw new CurlParseError('MISSING_VALUE', 'Basic authentication requires a username and password.', user.position, dialect, '-u')
    }
    auth = {
      type: 'basic',
      username: record('basic-username', user.position, 'BASIC_USERNAME'),
      password: record('basic-password', user.position + separator + 1, 'BASIC_PASSWORD'),
    }
  }

  const headers: Entry[] = []
  rawHeaders.forEach((raw, index) => {
    const separator = raw.value.indexOf(':')
    if (separator <= 0) {
      throw new CurlParseError('INVALID_HEADER', 'A cURL header must contain a name and value.', raw.position, dialect, '-H')
    }
    const key = raw.value.slice(0, separator).trim()
    const sourceValue = raw.value.slice(separator + 1).trimStart()
    if (!key) throw new CurlParseError('INVALID_HEADER', 'A cURL header name is required.', raw.position, dialect, '-H')

    const bearer = /^Bearer\s+(.+)$/i.exec(sourceValue)
    if (/^authorization$/i.test(key) && bearer && auth.type === 'none') {
      auth = { type: 'bearer', token: record('bearer', raw.position + separator + 1, 'TOKEN') }
      return
    }
    headers.push({
      id: `curl-header-${index + 1}`,
      enabled: true,
      key,
      value: sensitiveKey.test(key)
        ? record(secretKind(key), raw.position + separator + 1, placeholderBase(key))
        : sourceValue,
    })
  })

  const joinedData = data.map(({ value }) => value).join('&')
  const contentType = headers.find(({ key }) => /^content-type$/i.test(key))?.value
  let body: Body = { type: 'none' }
  if (data.length) {
    if (/\bapplication\/(?:[\w.+-]+\+)?json\b/i.test(contentType ?? '')) {
      try {
        const parsed: unknown = JSON.parse(joinedData)
        let changed = false
        const sanitize = (value: unknown, key = ''): unknown => {
          if (key && sensitiveKey.test(key)) {
            changed = true
            return record(secretKind(key), data[0].position, placeholderBase(key))
          }
          if (Array.isArray(value)) return value.map((item) => sanitize(item))
          if (value && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitize(child, childKey)]))
          }
          return value
        }
        const sanitized = sanitize(parsed)
        body = { type: 'json', content: changed ? JSON.stringify(sanitized) : joinedData }
      } catch {
        body = { type: 'text', content: joinedData, ...(contentType ? { contentType } : {}) }
      }
    } else body = { type: 'text', content: joinedData, ...(contentType ? { contentType } : {}) }
  }

  const warnings: string[] = []
  if (!method && data.length) warnings.push('Method inferred as POST from request data.')
  const finalMethod = method ?? (data.length ? 'POST' : 'GET')
  if ((finalMethod === 'GET' || finalMethod === 'HEAD') && body.type !== 'none') {
    throw new CurlParseError('UNSUPPORTED_FLAG', 'GET and HEAD requests with data are not supported.', data[0].position, dialect, '-d')
  }

  return {
    dialect,
    request: {
      method: finalMethod,
      url: parsedUrl.toString(),
      params,
      headers,
      auth,
      body,
      settings: { ...defaultHttpConfig.settings },
    },
    sensitiveFields,
    warnings,
  }
}
