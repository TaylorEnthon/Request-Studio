import { defaultSseConfig, defaultWebSocketConfig } from '../streaming/streaming-schemas'
import { requestAssetV1Schema, type RequestAssetV1 } from './request-asset'

export type SavedRequestAssetRow = Readonly<{
  name: string
  description: string
  protocol: string
  method: string | null
  url: string
  params_json: string
  headers_json: string
  auth_json: string
  body_json: string
  settings_json: string
  stream_config_json: string
  [key: string]: unknown
}>

const parseJson = (value: string): unknown => JSON.parse(value)
const parseRecord = (value: string): Record<string, unknown> => {
  const parsed = parseJson(value)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('Stream configuration must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

export function mapSavedRequestToAsset(row: SavedRequestAssetRow): RequestAssetV1 {
  const common = {
    format: 'request-studio.request' as const,
    version: 1 as const,
    name: row.name,
    description: row.description,
  }
  const requestBase = {
    url: row.url,
    params: parseJson(row.params_json),
    headers: parseJson(row.headers_json),
    auth: parseJson(row.auth_json),
  }

  if (row.protocol === 'http') {
    return requestAssetV1Schema.parse({
      ...common,
      protocol: 'http',
      request: {
        method: row.method,
        ...requestBase,
        body: parseJson(row.body_json),
        settings: parseJson(row.settings_json),
      },
    })
  }

  const streamConfig = parseRecord(row.stream_config_json)
  if (row.protocol === 'websocket') {
    return requestAssetV1Schema.parse({
      ...common,
      protocol: 'websocket',
      request: { ...requestBase, ...defaultWebSocketConfig, ...streamConfig },
    })
  }
  if (row.protocol === 'sse') {
    return requestAssetV1Schema.parse({
      ...common,
      protocol: 'sse',
      request: {
        ...requestBase,
        ...defaultSseConfig,
        ...(row.method ? { method: row.method } : {}),
        ...streamConfig,
      },
    })
  }

  throw new TypeError(`Unsupported request protocol: ${row.protocol}`)
}
