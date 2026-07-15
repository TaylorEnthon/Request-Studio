import { describe, expect, it } from 'vitest'
import { requestAssetV1Schema } from './request-asset'
import { mapSavedRequestToAsset } from './request-asset-mapper'

const entry = (id: string, key: string, value: string) => ({ id, enabled: true, key, value })
const common = {
  format: 'request-studio.request' as const,
  version: 1 as const,
  name: 'Users',
  description: '',
}
const httpAsset = {
  ...common,
  protocol: 'http' as const,
  request: {
    method: 'POST' as const,
    url: 'https://api.example.com/users',
    params: [entry('p1', 'page', '1')],
    headers: [entry('h1', 'Accept', 'application/json')],
    auth: { type: 'bearer' as const, token: '{{TOKEN}}' },
    body: { type: 'json' as const, content: '{"name":"Tom"}' },
    settings: { timeoutMs: 30000 },
  },
}

describe('RequestAssetV1 schema', () => {
  it('accepts a valid HTTP asset', () => {
    expect(requestAssetV1Schema.parse(httpAsset)).toEqual(httpAsset)
  })

  it('accepts a valid WebSocket asset without runtime messages or sessions', () => {
    const asset = {
      ...common,
      protocol: 'websocket',
      request: {
        url: 'wss://api.example.com/events', params: [], headers: [], auth: { type: 'none' },
        subprotocols: ['json'], connectTimeoutMs: 10000, idleTimeoutMs: 0,
        pingEnabled: true, pingIntervalMs: 30000, autoReconnect: false,
        maxReconnectAttempts: 3, reconnectDelayMs: 1000, maxMessageBytes: 1048576,
      },
    }
    expect(requestAssetV1Schema.parse(asset)).toEqual(asset)
  })

  it('accepts a valid SSE asset without event history', () => {
    const asset = {
      ...common,
      protocol: 'sse',
      request: {
        method: 'POST', url: 'https://api.example.com/events', params: [], headers: [], auth: { type: 'none' },
        body: { type: 'text', content: 'start', contentType: 'text/plain' }, connectTimeoutMs: 10000,
        idleTimeoutMs: 60000, maxEventBytes: 1048576, maxSessionDurationMs: 1800000,
      },
    }
    expect(requestAssetV1Schema.parse(asset)).toEqual(asset)
  })

  it('rejects unknown protocols and missing required fields', () => {
    expect(requestAssetV1Schema.safeParse({ ...httpAsset, protocol: 'grpc' }).success).toBe(false)
    const request: Partial<typeof httpAsset.request> = { ...httpAsset.request }
    delete request.method
    expect(requestAssetV1Schema.safeParse({ ...httpAsset, request }).success).toBe(false)
  })

  it('rejects database and runtime metadata', () => {
    expect(requestAssetV1Schema.safeParse({ ...httpAsset, id: 'db-id' }).success).toBe(false)
    expect(requestAssetV1Schema.safeParse({ ...httpAsset, request: { ...httpAsset.request, executionId: 'run' } }).success).toBe(false)
  })

  it('rejects local file references and resolved credentials', () => {
    const binary = { ...httpAsset, request: { ...httpAsset.request, body: { type: 'binary', fileRef: 'C:\\Users\\me\\secret.bin' } } }
    expect(requestAssetV1Schema.safeParse(binary).success).toBe(false)
    const secret = { ...httpAsset, request: { ...httpAsset.request, auth: { type: 'bearer', token: 'resolved-secret' } } }
    expect(requestAssetV1Schema.safeParse(secret).success).toBe(false)
  })
})

describe('mapSavedRequestToAsset', () => {
  const baseRow = {
    id: 'database-id', workspace_id: 'workspace', collection_id: 'collection', name: 'Users', description: '',
    url: 'https://api.example.com/users', params_json: '[]', headers_json: '[]',
    auth_json: '{"type":"none"}', body_json: '{"type":"none"}', settings_json: '{"timeoutMs":30000}',
    stream_config_json: '{}', created_at: 'yesterday', updated_at: 'today', execution_id: 'runtime-only',
  }

  it('maps an HTTP row without database or runtime metadata', () => {
    const row = Object.freeze({ ...baseRow, protocol: 'http', method: 'GET' })
    const asset = mapSavedRequestToAsset(row)
    expect(asset).toEqual({
      ...common,
      protocol: 'http',
      request: { method: 'GET', url: row.url, params: [], headers: [], auth: { type: 'none' }, body: { type: 'none' }, settings: { timeoutMs: 30000 } },
    })
    expect(JSON.stringify(asset)).not.toMatch(/database-id|workspace|collection|yesterday|today|runtime-only/)
  })

  it('maps WebSocket stream configuration only', () => {
    const stream = { subprotocols: ['json'], connectTimeoutMs: 10000, idleTimeoutMs: 0, pingEnabled: false, pingIntervalMs: 30000, autoReconnect: false, maxReconnectAttempts: 3, reconnectDelayMs: 1000, maxMessageBytes: 1048576 }
    const asset = mapSavedRequestToAsset({ ...baseRow, protocol: 'websocket', method: null, url: 'wss://api.example.com/events', stream_config_json: JSON.stringify(stream) })
    expect(asset).toEqual({ ...common, protocol: 'websocket', request: { url: 'wss://api.example.com/events', params: [], headers: [], auth: { type: 'none' }, ...stream } })
    expect(asset).not.toHaveProperty('messages')
  })

  it('maps SSE method, body, and stream settings', () => {
    const stream = { method: 'POST', body: { type: 'text', content: 'start' }, connectTimeoutMs: 10000, idleTimeoutMs: 60000, maxEventBytes: 1048576, maxSessionDurationMs: 1800000 }
    const asset = mapSavedRequestToAsset({ ...baseRow, protocol: 'sse', method: 'POST', stream_config_json: JSON.stringify(stream) })
    expect(asset).toEqual({ ...common, protocol: 'sse', request: { url: baseRow.url, params: [], headers: [], auth: { type: 'none' }, ...stream } })
    expect(asset).not.toHaveProperty('events')
  })
})
