import type { RequestAssetV1 } from '../assets/request-asset'
import {
  sanitizeRequestAssetForOutput,
  type ExportWarning,
} from '../assets/request-export'
import { generateJavaScriptFetch } from './javascript-fetch-generator'
import { generatePythonRequests } from './python-requests-generator'
import { generateSseFetch } from './sse-fetch-generator'
import { generateTypeScriptAxios } from './typescript-axios-generator'
import { generateBrowserWebSocket } from './websocket-browser-generator'

export type CodeGenerationLanguage =
  | 'javascript-fetch'
  | 'python-requests'
  | 'typescript-axios'
  | 'sse-fetch'
  | 'browser-websocket'

export type CodeGeneratorCapability = Readonly<{
  language: CodeGenerationLanguage
  displayName: string
  supportedProtocols: readonly RequestAssetV1['protocol'][]
}>

export type GeneratedCode = Readonly<{
  language: CodeGenerationLanguage
  content: string
  warnings: readonly ExportWarning[]
}>

export type HttpCodeGenerationModel = Readonly<{
  method: Extract<RequestAssetV1, { protocol: 'http' }>['request']['method']
  url: string
  headers: readonly Readonly<{ key: string; value: string }>[]
  basicAuth: Readonly<{ username: string; password: string }> | null
  body: Readonly<{
    kind: 'json' | 'text' | 'form-urlencoded'
    content: string
  }> | null
  warnings: readonly ExportWarning[]
}>

export type SseCodeGenerationModel = Readonly<{
  method: Extract<RequestAssetV1, { protocol: 'sse' }>['request']['method']
  url: string
  headers: readonly Readonly<{ key: string; value: string }>[]
  basicAuth: HttpCodeGenerationModel['basicAuth']
  body: HttpCodeGenerationModel['body']
  warnings: readonly ExportWarning[]
}>

export type WebSocketCodeGenerationModel = Readonly<{
  url: string
  subprotocols: readonly string[]
  warnings: readonly ExportWarning[]
}>

type CodeGenerationModel =
  | HttpCodeGenerationModel
  | SseCodeGenerationModel
  | WebSocketCodeGenerationModel
type Adapter = CodeGeneratorCapability &
  Readonly<{ generate: (model: CodeGenerationModel) => string }>
type QueryEntry = Readonly<{ enabled: boolean; key: string; value: string }>
type HttpLikeRequest =
  | Extract<RequestAssetV1, { protocol: 'http' }>['request']
  | Extract<RequestAssetV1, { protocol: 'sse' }>['request']
type NormalizedHttpFields = Omit<HttpCodeGenerationModel, 'method'>

const encodePart = (value: string): string =>
  value
    .split(/({{[A-Za-z_][A-Za-z0-9_]*}})/)
    .map((part) =>
      /^{{[A-Za-z_][A-Za-z0-9_]*}}$/.test(part) ? part : encodeURIComponent(part),
    )
    .join('')

function withQuery(url: string, entries: readonly QueryEntry[]): string {
  const enabled = entries.filter(({ enabled }) => enabled)
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
    .map(({ key, value }) => `${encodePart(key)}=${encodePart(value)}`)
    .join('&')
  return `${base}${separator}${query}${fragment}`
}

function normalizeHttpLikeRequest(
  request: HttpLikeRequest,
  hasRedactedValues: boolean,
): NormalizedHttpFields {
  const query: QueryEntry[] = request.params.map(({ enabled, key, value }) => ({
    enabled,
    key,
    value,
  }))
  const headers = request.headers
    .filter(({ enabled }) => enabled)
    .map(({ key, value }) => ({ key, value }))
  let basicAuth: HttpCodeGenerationModel['basicAuth'] = null

  if (request.auth.type === 'bearer') {
    headers.push({ key: 'Authorization', value: `Bearer ${request.auth.token}` })
  } else if (request.auth.type === 'basic') {
    basicAuth = { username: request.auth.username, password: request.auth.password }
  } else if (request.auth.type === 'api-key') {
    if (request.auth.placement === 'query') {
      query.push({ enabled: true, key: request.auth.key, value: request.auth.value })
    } else {
      headers.push({ key: request.auth.key, value: request.auth.value })
    }
  }

  const warnings: ExportWarning[] = []
  const hasContentType = () =>
    headers.some(({ key }) => key.toLowerCase() === 'content-type')
  let body: HttpCodeGenerationModel['body'] = null
  if (request.body.type === 'json') {
    if (!hasContentType()) headers.push({ key: 'Content-Type', value: 'application/json' })
    body = { kind: 'json', content: request.body.content }
  } else if (request.body.type === 'text') {
    if (request.body.contentType && !hasContentType()) {
      headers.push({ key: 'Content-Type', value: request.body.contentType })
    }
    body = { kind: 'text', content: request.body.content }
    warnings.push({
      code: 'opaque-text',
      message: 'Review unstructured text for opaque sensitive values.',
    })
  } else if (request.body.type === 'form-urlencoded') {
    if (!hasContentType()) {
      headers.push({
        key: 'Content-Type',
        value: 'application/x-www-form-urlencoded',
      })
    }
    body = {
      kind: 'form-urlencoded',
      content: request.body.entries
        .filter(({ enabled }) => enabled)
        .map(({ key, value }) => `${encodePart(key)}=${encodePart(value)}`)
        .join('&'),
    }
  } else if (request.body.type === 'multipart' || request.body.type === 'binary') {
    warnings.push({
      code: 'file-content-omitted',
      message: 'Local file content was omitted.',
    })
  }

  if (hasRedactedValues) {
    warnings.unshift({
      code: 'sanitized-values',
      message: 'Sensitive values were redacted.',
    })
  }
  return {
    url: withQuery(request.url, query),
    headers,
    basicAuth,
    body,
    warnings,
  }
}

function createHttpModel(
  asset: Extract<RequestAssetV1, { protocol: 'http' }>,
): HttpCodeGenerationModel {
  return {
    method: asset.request.method,
    ...normalizeHttpLikeRequest(asset.request, JSON.stringify(asset).includes('[REDACTED]')),
  }
}

function createSseModel(
  asset: Extract<RequestAssetV1, { protocol: 'sse' }>,
): SseCodeGenerationModel {
  return {
    method: asset.request.method,
    ...normalizeHttpLikeRequest(asset.request, JSON.stringify(asset).includes('[REDACTED]')),
  }
}

function createWebSocketModel(
  asset: Extract<RequestAssetV1, { protocol: 'websocket' }>,
): WebSocketCodeGenerationModel {
  const request = asset.request
  const query: QueryEntry[] = request.params.map(({ enabled, key, value }) => ({
    enabled,
    key,
    value,
  }))
  const omitsHeaders =
    request.headers.some(({ enabled }) => enabled) ||
    request.auth.type === 'bearer' ||
    request.auth.type === 'basic' ||
    (request.auth.type === 'api-key' && request.auth.placement === 'header')

  if (request.auth.type === 'api-key' && request.auth.placement === 'query') {
    query.push({ enabled: true, key: request.auth.key, value: request.auth.value })
  }

  const warnings: ExportWarning[] = []
  if (JSON.stringify(asset).includes('[REDACTED]')) {
    warnings.push({
      code: 'sanitized-values',
      message: 'Sensitive values were redacted.',
    })
  }
  if (omitsHeaders) {
    warnings.push({
      code: 'browser-websocket-headers-omitted',
      message: 'Browser WebSocket does not support custom headers or header-based authentication.',
    })
  }

  return {
    url: withQuery(request.url, query),
    subprotocols: request.subprotocols,
    warnings,
  }
}

const adapters: readonly Adapter[] = [
  {
    language: 'javascript-fetch',
    displayName: 'JavaScript Fetch',
    supportedProtocols: ['http'],
    generate: (model) => generateJavaScriptFetch(model as HttpCodeGenerationModel),
  },
  {
    language: 'python-requests',
    displayName: 'Python requests',
    supportedProtocols: ['http'],
    generate: (model) => generatePythonRequests(model as HttpCodeGenerationModel),
  },
  {
    language: 'typescript-axios',
    displayName: 'TypeScript Axios',
    supportedProtocols: ['http'],
    generate: (model) => generateTypeScriptAxios(model as HttpCodeGenerationModel),
  },
  {
    language: 'sse-fetch',
    displayName: 'SSE Fetch',
    supportedProtocols: ['sse'],
    generate: (model) => generateSseFetch(model as SseCodeGenerationModel),
  },
  {
    language: 'browser-websocket',
    displayName: 'Browser WebSocket',
    supportedProtocols: ['websocket'],
    generate: (model) => generateBrowserWebSocket(model as WebSocketCodeGenerationModel),
  },
]

export function listCodeGenerators(): readonly CodeGeneratorCapability[] {
  return adapters.map(({ language, displayName, supportedProtocols }) => ({
    language,
    displayName,
    supportedProtocols: [...supportedProtocols],
  }))
}

export function generateCode(
  asset: RequestAssetV1,
  language: CodeGenerationLanguage,
): GeneratedCode {
  const adapter = adapters.find((candidate) => candidate.language === language)
  if (!adapter) throw new TypeError('Code generator is not available.')

  const sanitized = sanitizeRequestAssetForOutput(asset)
  if (!adapter.supportedProtocols.includes(sanitized.protocol)) {
    throw new TypeError('Code generator does not support this protocol.')
  }
  const model =
    sanitized.protocol === 'http'
      ? createHttpModel(sanitized)
      : sanitized.protocol === 'sse'
        ? createSseModel(sanitized)
        : createWebSocketModel(sanitized)
  return {
    language,
    content: adapter.generate(model),
    warnings: model.warnings,
  }
}
