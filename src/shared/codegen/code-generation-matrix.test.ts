import { describe, expect, it } from 'vitest'
import type { RequestAssetV1 } from '../assets/request-asset'
import { generateCode, type CodeGenerationLanguage } from './code-generation'

const baseRequest: Extract<RequestAssetV1, { protocol: 'http' }>['request'] = {
  method: 'GET', url: 'https://api.example.com/items', params: [], headers: [],
  auth: { type: 'none' }, body: { type: 'none' }, settings: { timeoutMs: 30000 },
}
const http = (request: typeof baseRequest): RequestAssetV1 => ({
  format: 'request-studio.request', version: 1, protocol: 'http', name: 'Matrix', description: '', request,
})

describe('code generation quality matrix', () => {
  it.each(['javascript-fetch', 'typescript-axios', 'python-requests'] as const)(
    'generates deterministic GET, JSON POST, and text POST output for %s',
    (language) => {
      const assets = [
        http(baseRequest),
        http({ ...baseRequest, method: 'POST', body: { type: 'json', content: '{"count":2,"file":"/Users/Alice/private.txt"}' } }),
        http({ ...baseRequest, method: 'POST', body: { type: 'text', content: 'hello', contentType: 'text/plain' } }),
      ]
      for (const asset of assets) {
        const generated = generateCode(asset, language)
        expect(generated).toEqual(generateCode(asset, language))
        expect(JSON.stringify(generated)).not.toContain('/Users/Alice/private.txt')
      }
    },
  )

  it.each([
    { type: 'bearer', token: '{{TOKEN}}' } as const,
    { type: 'basic', username: 'user', password: '{{PASSWORD}}' } as const,
    { type: 'api-key', placement: 'header', key: 'X-API-Key', value: '{{API_KEY}}' } as const,
    { type: 'api-key', placement: 'query', key: 'api_key', value: '{{API_KEY}}' } as const,
  ])('preserves placeholder auth while excluding source-only values for $type', (auth) => {
    const candidate = http({ ...baseRequest, auth })
    for (const language of ['javascript-fetch', 'typescript-axios', 'python-requests'] as CodeGenerationLanguage[]) {
      const output = generateCode(candidate, language)
      expect(JSON.stringify(output)).toMatch(/{{(?:TOKEN|PASSWORD|API_KEY)}}/)
      expect(JSON.stringify(output)).not.toMatch(/raw-secret|C:\\\\Users|database-id|runtimeMetadata/)
    }
  })

  it('keeps SSE and WebSocket protocol adapters deterministic', () => {
    const sse: RequestAssetV1 = {
      format: 'request-studio.request', version: 1, protocol: 'sse', name: 'Events', description: '',
      request: { method: 'GET', url: 'https://api.example.com/events', params: [], headers: [], auth: { type: 'none' }, body: { type: 'none' }, connectTimeoutMs: 10000, idleTimeoutMs: 0, maxEventBytes: 1048576, maxSessionDurationMs: 60000 },
    }
    const websocket: RequestAssetV1 = {
      format: 'request-studio.request', version: 1, protocol: 'websocket', name: 'Socket', description: '',
      request: { url: 'wss://api.example.com/events', params: [], headers: [], auth: { type: 'none' }, subprotocols: [], connectTimeoutMs: 10000, idleTimeoutMs: 0, pingEnabled: false, pingIntervalMs: 30000, autoReconnect: false, maxReconnectAttempts: 3, reconnectDelayMs: 1000, maxMessageBytes: 1048576 },
    }
    expect(generateCode(sse, 'sse-fetch')).toEqual(generateCode(sse, 'sse-fetch'))
    expect(generateCode(websocket, 'browser-websocket')).toEqual(generateCode(websocket, 'browser-websocket'))
  })
})
