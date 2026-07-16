import { describe, expect, it } from 'vitest'
import { createRequestExportPreview } from './request-export-preview'

const baseRow = {
  id: 'database-id',
  workspace_id: 'workspace-id',
  collection_id: 'collection-id',
  name: 'Users Request',
  description: 'file=C:\\Users\\me\\request.txt',
  protocol: 'http',
  method: 'GET',
  url: 'https://api.example.com/users',
  params_json: '[]',
  headers_json: '[]',
  auth_json: JSON.stringify({ type: 'bearer', token: 'raw-bearer-fixture' }),
  body_json: JSON.stringify({ type: 'none' }),
  settings_json: JSON.stringify({ timeoutMs: 30000 }),
  stream_config_json: '{}',
}

describe('createRequestExportPreview', () => {
  it('creates sanitized cURL and Request JSON previews', () => {
    const curl = createRequestExportPreview(baseRow, 'curl')
    expect(curl.format).toBe('curl')
    expect(curl.content).toContain("--request 'GET'")

    const json = createRequestExportPreview(baseRow, 'request-json')
    expect(json).toMatchObject({
      format: 'request-json',
      protocol: 'http',
      filenameSuggestion: 'users-request.request-studio.json',
    })
    expect(JSON.parse(json.content)).toMatchObject({
      format: 'request-studio.request',
      version: 1,
      protocol: 'http',
    })
    expect(json.content.endsWith('\n')).toBe(true)
    expect(JSON.stringify({ curl, json })).not.toMatch(
      /raw-bearer-fixture|database-id|workspace-id|C:\\\\Users/,
    )
  })

  it.each([
    [
      'websocket',
      null,
      'wss://api.example.com/events',
      {
        subprotocols: [],
        connectTimeoutMs: 10000,
        idleTimeoutMs: 0,
        pingEnabled: false,
        pingIntervalMs: 30000,
        autoReconnect: false,
        maxReconnectAttempts: 3,
        reconnectDelayMs: 1000,
        maxMessageBytes: 1048576,
      },
    ],
    [
      'sse',
      'GET',
      'https://api.example.com/events',
      {
        method: 'GET',
        body: { type: 'none' },
        connectTimeoutMs: 10000,
        idleTimeoutMs: 60000,
        maxEventBytes: 1048576,
        maxSessionDurationMs: 1800000,
      },
    ],
  ] as const)('creates Request JSON for %s and rejects cURL', (protocol, method, url, streamConfig) => {
    const row = {
      ...baseRow,
      protocol,
      method,
      url,
      stream_config_json: JSON.stringify(streamConfig),
    }
    expect(createRequestExportPreview(row, 'request-json')).toMatchObject({
      format: 'request-json',
      protocol,
    })
    expect(() => createRequestExportPreview(row, 'curl')).toThrow(
      'cURL export supports HTTP requests only.',
    )
  })

  it('uses a safe fallback JSON filename', () => {
    expect(
      createRequestExportPreview({ ...baseRow, name: '***' }, 'request-json'),
    ).toMatchObject({ filenameSuggestion: 'request.request-studio.json' })
  })
})
