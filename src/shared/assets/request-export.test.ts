import { describe, expect, it } from 'vitest'
import { requestAssetV1Schema, type RequestAssetV1 } from './request-asset'
import {
  mapSavedRequestToExportAsset,
  sanitizeRequestAssetForOutput,
} from './request-export'

const websocketConfig = JSON.stringify({
  subprotocols: [],
  connectTimeoutMs: 10000,
  idleTimeoutMs: 0,
  pingEnabled: false,
  pingIntervalMs: 30000,
  autoReconnect: false,
  maxReconnectAttempts: 3,
  reconnectDelayMs: 1000,
  maxMessageBytes: 1048576,
})
const sseConfig = JSON.stringify({
  method: 'GET',
  body: { type: 'none' },
  connectTimeoutMs: 10000,
  idleTimeoutMs: 60000,
  maxEventBytes: 1048576,
  maxSessionDurationMs: 1800000,
})
const baseRow = {
  id: 'database-id',
  workspace_id: 'workspace-id',
  collection_id: 'collection-id',
  name: 'Export request',
  description: '',
  protocol: 'http',
  method: 'POST',
  url: 'https://api.example.com/items',
  params_json: '[]',
  headers_json: '[]',
  auth_json: '{"type":"none"}',
  body_json: '{"type":"none"}',
  settings_json: '{"timeoutMs":30000}',
  stream_config_json: '{}',
  history: ['history-secret'],
  experiment: { token: 'experiment-secret' },
}

describe('mapSavedRequestToExportAsset', () => {
  it('sanitizes an existing request asset with the export rules', () => {
    const unsafe = {
      format: 'request-studio.request',
      version: 1,
      protocol: 'http',
      name: 'Users',
      description: 'source=C:\\Users\\me\\secret.txt',
      request: {
        method: 'POST',
        url: 'https://api.example.com/users?api_key=raw-query',
        params: [
          { id: 'p1', enabled: true, key: 'token', value: 'raw-param' },
          { id: 'p2', enabled: true, key: 'visible', value: '{{VISIBLE_TOKEN}}' },
        ],
        headers: [{ id: 'h1', enabled: true, key: 'X-Api-Key', value: 'raw-header' }],
        auth: { type: 'bearer', token: 'raw-bearer' },
        body: { type: 'json', content: '{"password":"raw-body","name":"Ada"}' },
        settings: { timeoutMs: 30000 },
      },
    }

    const result = sanitizeRequestAssetForOutput(unsafe as unknown as RequestAssetV1)
    const serialized = JSON.stringify(result)

    expect(serialized).not.toMatch(
      /raw-query|raw-param|raw-header|raw-bearer|raw-body|C:\\\\Users/,
    )
    expect(serialized).toContain('{{VISIBLE_TOKEN}}')
    expect(serialized).toContain('[REDACTED]')
    expect(requestAssetV1Schema.parse(result)).toEqual(result)
  })

  it.each([
    ['http', 'https://api.example.com/items', 'POST', '{}'],
    ['websocket', 'wss://api.example.com/events', null, websocketConfig],
    ['sse', 'https://api.example.com/events', 'GET', sseConfig],
  ] as const)('maps a sanitized %s asset without storage metadata', (protocol, url, method, streamConfig) => {
    const asset = mapSavedRequestToExportAsset({
      ...baseRow,
      protocol,
      url,
      method,
      stream_config_json: streamConfig,
    })
    expect(asset.protocol).toBe(protocol)
    expect(JSON.stringify(asset)).not.toMatch(
      /database-id|workspace-id|collection-id|history-secret|experiment-secret/,
    )
  })

  it('redacts URL, entries, auth, and nested JSON while preserving placeholders', () => {
    const asset = mapSavedRequestToExportAsset({
      ...baseRow,
      url: 'https://api.example.com/items?access_token=url-secret&view=public',
      params_json: JSON.stringify([
        { id: 'p1', enabled: true, key: 'api_key', value: 'query-secret' },
        { id: 'p2', enabled: true, key: 'token', value: '{{TOKEN}}' },
      ]),
      headers_json: JSON.stringify([
        { id: 'h1', enabled: false, key: 'Authorization', value: 'Bearer header-secret' },
      ]),
      auth_json: JSON.stringify({ type: 'basic', username: 'user', password: 'basic-secret' }),
      body_json: JSON.stringify({
        type: 'json',
        content: JSON.stringify({ profile: { password: 'body-secret' }, label: 'public' }),
      }),
    })

    expect(asset.protocol).toBe('http')
    if (asset.protocol !== 'http') throw new Error('Expected HTTP asset')
    expect(asset.request.url).toBe(
      'https://api.example.com/items?access_token=[REDACTED]&view=public',
    )
    expect(asset.request.params.map((entry) => entry.value)).toEqual(['[REDACTED]', '{{TOKEN}}'])
    expect(asset.request.headers[0].value).toBe('[REDACTED]')
    expect(asset.request.auth).toEqual({
      type: 'basic',
      username: 'user',
      password: '[REDACTED]',
    })
    expect(JSON.parse(asset.request.body.type === 'json' ? asset.request.body.content : '{}')).toEqual({
      profile: { password: '[REDACTED]' },
      label: 'public',
    })
    expect(JSON.stringify(asset)).not.toMatch(
      /url-secret|query-secret|header-secret|basic-secret|body-secret/,
    )
  })

  it('redacts local paths in ordinary entry values while preserving placeholders and text', () => {
    const asset = sanitizeRequestAssetForOutput({
      format: 'request-studio.request',
      version: 1,
      protocol: 'http',
      name: 'Paths',
      description: '',
      request: {
        method: 'GET',
        url: 'https://api.example.com/items',
        params: [
          { id: 'p1', enabled: true, key: 'source', value: 'C:\\Users\\me\\query.txt' },
          { id: 'p2', enabled: true, key: 'visible', value: '{{VISIBLE_PATH}}' },
          { id: 'p3', enabled: true, key: 'label', value: 'ordinary value' },
        ],
        headers: [
          { id: 'h1', enabled: true, key: 'X-Source', value: '/home/me/header.txt' },
        ],
        auth: { type: 'none' },
        body: { type: 'none' },
        settings: { timeoutMs: 30000 },
      },
    })

    expect(asset.request.params.map(({ value }) => value)).toEqual([
      '[REDACTED]',
      '{{VISIBLE_PATH}}',
      'ordinary value',
    ])
    expect(asset.request.headers[0].value).toBe('[REDACTED]')
  })

  it('sanitizes WebSocket auth and an SSE form body', () => {
    const websocket = mapSavedRequestToExportAsset({
      ...baseRow,
      protocol: 'websocket',
      method: null,
      url: 'wss://api.example.com/events',
      auth_json: JSON.stringify({ type: 'bearer', token: 'websocket-secret' }),
      stream_config_json: websocketConfig,
    })
    expect(websocket.protocol).toBe('websocket')
    if (websocket.protocol !== 'websocket') throw new Error('Expected WebSocket asset')
    expect(websocket.request.auth).toEqual({ type: 'bearer', token: '[REDACTED]' })

    const sse = mapSavedRequestToExportAsset({
      ...baseRow,
      protocol: 'sse',
      method: 'POST',
      stream_config_json: JSON.stringify({
        ...JSON.parse(sseConfig),
        method: 'POST',
        body: {
          type: 'form-urlencoded',
          entries: [{ id: 'f1', enabled: true, key: 'apiKey', value: 'sse-secret' }],
        },
      }),
    })
    expect(sse.protocol).toBe('sse')
    if (sse.protocol !== 'sse') throw new Error('Expected SSE asset')
    expect(sse.request.body).toEqual({
      type: 'form-urlencoded',
      entries: [{ id: 'f1', enabled: true, key: 'apiKey', value: '[REDACTED]' }],
    })
    expect(JSON.stringify({ websocket, sse })).not.toMatch(/websocket-secret|sse-secret/)
  })

  it('removes local file references and recognizable text credentials', () => {
    const multipart = mapSavedRequestToExportAsset({
      ...baseRow,
      body_json: JSON.stringify({
        type: 'multipart',
        entries: [
          {
            id: 'f1',
            enabled: true,
            key: 'upload',
            kind: 'file',
            fileRef: 'C:\\Users\\me\\secret.bin',
            filename: 'secret.bin',
          },
          {
            id: 't1',
            enabled: true,
            key: 'apiKey',
            kind: 'text',
            textValue: 'multipart-secret',
          },
        ],
      }),
    })
    expect(multipart.protocol).toBe('http')
    if (multipart.protocol !== 'http' || multipart.request.body.type !== 'multipart') {
      throw new Error('Expected multipart HTTP asset')
    }
    expect(multipart.request.body.entries[0].fileRef).toBeNull()
    expect(multipart.request.body.entries[1].textValue).toBe('[REDACTED]')

    const text = mapSavedRequestToExportAsset({
      ...baseRow,
      body_json: JSON.stringify({
        type: 'text',
        content:
          'Authorization: Basic basic-text-secret Cookie=session-cookie token=text-secret file=C:\\Users\\me\\private.txt home=/home/me/private.txt',
      }),
    })
    expect(JSON.stringify({ multipart, text })).not.toMatch(
      /multipart-secret|basic-text-secret|session-cookie|text-secret|C:\\\\Users|\/home\/me/,
    )
  })

  it('redacts generic authorization values and absolute paths containing spaces', () => {
    const asset = mapSavedRequestToExportAsset({
      ...baseRow,
      body_json: JSON.stringify({
        type: 'text',
        content:
          'Authorization: ApiKey auth-secret; authorization=assignment-secret; windows=C:\\Users\\Jane Doe\\secret.txt; posix=/home/Jane Doe/secret.txt',
      }),
    })
    expect(JSON.stringify(asset)).not.toMatch(
      /auth-secret|assignment-secret|Jane Doe|secret\.txt/,
    )
  })

  it('preserves text placeholders and ordinary text after a path', () => {
    const asset = mapSavedRequestToExportAsset({
      ...baseRow,
      body_json: JSON.stringify({
        type: 'text',
        content:
          'Authorization: Bearer {{TOKEN}} token={{TOKEN}} file=C:\\Temp\\a.txt then continue',
      }),
    })
    expect(asset.protocol).toBe('http')
    if (asset.protocol !== 'http' || asset.request.body.type !== 'text') {
      throw new Error('Expected text HTTP asset')
    }
    expect(asset.request.body.content).toContain('Authorization: Bearer {{TOKEN}}')
    expect(asset.request.body.content).toContain('token={{TOKEN}}')
    expect(asset.request.body.content).toContain('file=[REDACTED] then continue')
  })

  it('redacts extensionless absolute paths containing spaces', () => {
    const asset = mapSavedRequestToExportAsset({
      ...baseRow,
      body_json: JSON.stringify({
        type: 'text',
        content: 'windows=C:\\Program Files\\Secrets; posix=/home/Jane Doe/private',
      }),
    })
    expect(JSON.stringify(asset)).not.toMatch(/Program Files|Jane Doe|\\Secrets|\/private/)
  })

  it('uses a fixed safe error for malformed JSON body content', () => {
    const secret = 'malformed-body-secret'
    const row = {
      ...baseRow,
      body_json: JSON.stringify({ type: 'json', content: `{"token":"${secret}"` }),
    }
    expect(() => mapSavedRequestToExportAsset(row)).toThrow('Request export JSON body is invalid.')
    try {
      mapSavedRequestToExportAsset(row)
    } catch (error) {
      expect(String(error)).not.toContain(secret)
    }
  })

  it('redacts URL userinfo and credential-shaped export metadata', () => {
    const asset = mapSavedRequestToExportAsset({
      ...baseRow,
      name: 'token=name-secret C:\\Users\\me\\request.txt',
      description: 'Cookie=description-secret /home/me/notes.txt',
      url: 'https://user:userinfo-secret@api.example.com/items',
      body_json: JSON.stringify({
        type: 'multipart',
        entries: [
          {
            id: 'f1',
            enabled: true,
            key: 'upload',
            kind: 'file',
            fileRef: 'C:\\Users\\me\\secret.bin',
            filename: 'C:\\Users\\me\\secret.bin',
            description: 'password=part-secret',
          },
        ],
      }),
    })

    const serialized = JSON.stringify(asset)
    expect(asset.request.url).toBe('https://[REDACTED]@api.example.com/items')
    expect(serialized).not.toMatch(
      /name-secret|description-secret|userinfo-secret|part-secret|C:\\\\Users|\/home\/me/,
    )
  })

  it('preserves an encoded placeholder in a sensitive URL query value', () => {
    const asset = mapSavedRequestToExportAsset({
      ...baseRow,
      url: 'https://api.example.com/items?access_token=%7B%7BTOKEN%7D%7D',
    })
    expect(asset.request.url).toBe(
      'https://api.example.com/items?access_token=%7B%7BTOKEN%7D%7D',
    )
  })

  it('converts mapper and schema failures to one fixed safe error', () => {
    const sourceValue = 'invalid-protocol-value'
    try {
      mapSavedRequestToExportAsset({ ...baseRow, protocol: sourceValue })
      throw new Error('Expected export mapping to fail')
    } catch (error) {
      expect(String(error)).toBe('TypeError: Saved request export data is invalid.')
      expect(String(error)).not.toContain(sourceValue)
      expect(error).not.toHaveProperty('cause')
    }
  })
})
