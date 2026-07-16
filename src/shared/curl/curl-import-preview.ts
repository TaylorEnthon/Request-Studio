import { requestAssetV1Schema, type RequestAssetV1 } from '../assets/request-asset'
import { parseCurl, type ParsedCurlRequest, type SensitiveField } from './curl-parser'
import {
  CurlParseError,
  type CurlDialect,
  type CurlDialectOption,
  type CurlErrorCode,
} from './curl-tokenizer'

export type CurlPreviewSeverity = 'warning' | 'error'

export interface CurlPreviewIssue {
  readonly code: string
  readonly message: string
  readonly severity: CurlPreviewSeverity
}

export interface CurlSensitiveMapping {
  readonly kind:
    | 'bearer-token'
    | 'basic-username'
    | 'basic-password'
    | 'api-key'
    | 'header-secret'
  readonly placeholder: string
  readonly location: string
  readonly suggestedVariable: string
}

export interface CurlImportPreview {
  readonly protocol: 'http'
  readonly dialect: CurlDialect
  readonly request: Extract<RequestAssetV1, { protocol: 'http' }>['request']
  readonly warnings: readonly CurlPreviewIssue[]
  readonly sensitiveMappings: readonly CurlSensitiveMapping[]
}

export type CurlImportPreviewResult =
  | Readonly<{ ok: true; preview: CurlImportPreview }>
  | Readonly<{
      ok: false
      dialect: CurlDialect | 'unknown'
      issues: readonly CurlPreviewIssue[]
    }>

const DIALECTS = new Set<CurlDialectOption>(['auto', 'posix', 'powershell', 'cmd'])

const ERROR_MESSAGES: Record<CurlErrorCode, string> = {
  INPUT_TOO_LARGE: 'The cURL input exceeds the preview size limit.',
  EMPTY_INPUT: 'Enter a cURL command to preview.',
  UNSAFE_SYNTAX: 'Shell execution syntax is not supported.',
  UNTERMINATED_QUOTE: 'The cURL command contains an unterminated quote.',
  DANGLING_ESCAPE: 'The cURL command contains an incomplete escape.',
  INVALID_COMMAND: 'The input must start with curl or curl.exe.',
  MISSING_VALUE: 'A supported cURL option is missing a value.',
  UNSUPPORTED_FLAG: 'The cURL command contains an unsupported option.',
  INVALID_HEADER: 'The cURL command contains an invalid header.',
  INVALID_BODY: 'The cURL command contains invalid JSON data.',
  INVALID_URL: 'The cURL command contains an invalid or unsupported URL.',
  FILE_REFERENCE: 'File references are not supported in cURL preview.',
  MULTIPLE_URLS: 'Exactly one request URL is supported.',
}

const MAPPING_KINDS: Record<SensitiveField['kind'], CurlSensitiveMapping['kind']> = {
  bearer: 'bearer-token',
  'basic-username': 'basic-username',
  'basic-password': 'basic-password',
  'api-key': 'api-key',
  'header-secret': 'header-secret',
}

const normalizedDialect = (dialect: string): CurlDialect | 'unknown' =>
  dialect === 'auto' ? 'unknown' : (dialect as CurlDialect)

const normalizeWarning = (warning: string): CurlPreviewIssue =>
  warning === 'Method inferred as POST from request data.'
    ? {
        code: 'METHOD_INFERRED',
        message: 'POST was inferred from request data.',
        severity: 'warning',
      }
    : {
        code: 'PARSER_WARNING',
        message: 'The cURL request was normalized with a warning.',
        severity: 'warning',
      }

const sensitiveLocation = (
  request: Extract<RequestAssetV1, { protocol: 'http' }>['request'],
  field: SensitiveField,
): string => {
  const { placeholder } = field

  if (field.kind === 'bearer' && request.auth.type === 'bearer' && request.auth.token === placeholder) {
    return 'auth.token'
  }
  if (
    field.kind === 'basic-username' &&
    request.auth.type === 'basic' &&
    request.auth.username === placeholder
  ) {
    return 'auth.username'
  }
  if (
    field.kind === 'basic-password' &&
    request.auth.type === 'basic' &&
    request.auth.password === placeholder
  ) {
    return 'auth.password'
  }

  const header = request.headers.find(({ value }) => value === placeholder)
  if (header) return `header.${header.key}`

  const parameter = request.params.find(({ value }) => value === placeholder)
  if (parameter) return `query.${parameter.key}`

  if (
    (request.body.type === 'json' || request.body.type === 'text') &&
    request.body.content.includes(placeholder)
  ) {
    return 'body'
  }

  throw new Error('Sensitive placeholder is missing from the request.')
}

const normalizeSensitiveMapping = (
  request: Extract<RequestAssetV1, { protocol: 'http' }>['request'],
  field: SensitiveField,
): CurlSensitiveMapping => {
  const variableMatch = /^\{\{([A-Z][A-Z0-9_]*)\}\}$/.exec(field.placeholder)
  if (!variableMatch) throw new Error('Sensitive placeholder is invalid.')

  return {
    kind: MAPPING_KINDS[field.kind],
    placeholder: field.placeholder,
    location: sensitiveLocation(request, field),
    suggestedVariable: variableMatch[1],
  }
}

export const normalizeCurlImportPreview = (parsed: ParsedCurlRequest): CurlImportPreview => {
  const asset = requestAssetV1Schema.parse({
    format: 'request-studio.request',
    version: 1,
    protocol: 'http',
    name: 'cURL import preview',
    description: '',
    request: parsed.request,
  })

  if (asset.protocol !== 'http') throw new Error('Preview request protocol is invalid.')

  return {
    protocol: 'http',
    dialect: parsed.dialect,
    request: asset.request,
    warnings: parsed.warnings.map(normalizeWarning),
    sensitiveMappings: parsed.sensitiveFields.map((field) =>
      normalizeSensitiveMapping(asset.request, field),
    ),
  }
}

export const previewCurlImport = (
  input: string,
  requestedDialect: string = 'auto',
): CurlImportPreviewResult => {
  if (!DIALECTS.has(requestedDialect as CurlDialectOption)) {
    return {
      ok: false,
      dialect: 'unknown',
      issues: [
        {
          code: 'UNKNOWN_DIALECT',
          message: 'The selected shell dialect is not supported.',
          severity: 'error',
        },
      ],
    }
  }

  const dialect = requestedDialect as CurlDialectOption
  try {
    return { ok: true, preview: normalizeCurlImportPreview(parseCurl(input, dialect)) }
  } catch (error) {
    if (error instanceof CurlParseError) {
      return {
        ok: false,
        dialect: error.dialect ?? normalizedDialect(requestedDialect),
        issues: [
          {
            code: `CURL_${error.code}`,
            message: ERROR_MESSAGES[error.code],
            severity: 'error',
          },
        ],
      }
    }

    return {
      ok: false,
      dialect: normalizedDialect(requestedDialect),
      issues: [
        {
          code: 'PREVIEW_FAILED',
          message: 'The cURL command could not be previewed.',
          severity: 'error',
        },
      ],
    }
  }
}
