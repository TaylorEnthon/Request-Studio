import { describe, expect, it } from 'vitest'
import type { RequestAssetV1 } from '../assets/request-asset'
import {
  generateCode,
  listCodeGenerators,
  type CodeGenerationLanguage,
} from './code-generation'

const httpAsset: RequestAssetV1 = {
  format: 'request-studio.request',
  version: 1,
  protocol: 'http',
  name: 'Users',
  description: '',
  request: {
    method: 'GET',
    url: 'https://api.example.com/users',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: { type: 'none' },
    settings: { timeoutMs: 30000 },
  },
}

const websocketAsset: RequestAssetV1 = {
  format: 'request-studio.request',
  version: 1,
  protocol: 'websocket',
  name: 'Events',
  description: '',
  request: {
    url: 'wss://api.example.com/events',
    params: [],
    headers: [],
    auth: { type: 'none' },
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
}

const sseAsset: RequestAssetV1 = {
  format: 'request-studio.request',
  version: 1,
  protocol: 'sse',
  name: 'Stream',
  description: '',
  request: {
    method: 'GET',
    url: 'https://api.example.com/events',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: { type: 'none' },
    connectTimeoutMs: 10000,
    idleTimeoutMs: 0,
    maxEventBytes: 1048576,
    maxSessionDurationMs: 60000,
  },
}

describe('code generation contract', () => {
  it('registers deterministic exact generator capabilities', () => {
    expect(listCodeGenerators()).toEqual([
      {
        language: 'javascript-fetch',
        displayName: 'JavaScript Fetch',
        supportedProtocols: ['http'],
      },
      {
        language: 'python-requests',
        displayName: 'Python requests',
        supportedProtocols: ['http'],
      },
      {
        language: 'typescript-axios',
        displayName: 'TypeScript Axios',
        supportedProtocols: ['http'],
      },
      {
        language: 'sse-fetch',
        displayName: 'SSE Fetch',
        supportedProtocols: ['sse'],
      },
      {
        language: 'browser-websocket',
        displayName: 'Browser WebSocket',
        supportedProtocols: ['websocket'],
      },
    ])
    expect(listCodeGenerators()).toEqual(listCodeGenerators())
  })

  it('rejects missing generators and unsupported protocols with fixed errors', () => {
    expect(() => generateCode(httpAsset, 'missing' as CodeGenerationLanguage)).toThrow(
      'Code generator is not available.',
    )
    expect(() => generateCode(websocketAsset, 'javascript-fetch')).toThrow(
      'Code generator does not support this protocol.',
    )
    expect(() => generateCode(sseAsset, 'typescript-axios')).toThrow(
      'Code generator does not support this protocol.',
    )
  })

  it('sanitizes once and returns deterministic code', () => {
    const unsafe = {
      ...httpAsset,
      request: {
        ...httpAsset.request,
        headers: [
          { id: 'h1', enabled: true, key: 'Authorization', value: 'raw-generator-secret' },
          { id: 'h2', enabled: true, key: 'X-Variable', value: '{{TOKEN}}' },
        ],
      },
    } as unknown as RequestAssetV1

    const first = generateCode(unsafe, 'javascript-fetch')
    const second = generateCode(unsafe, 'javascript-fetch')

    expect(first).toEqual(second)
    expect(first.content).toContain('{{TOKEN}}')
    expect(first.warnings).toContainEqual({
      code: 'sanitized-values',
      message: 'Sensitive values were redacted.',
    })
    expect(JSON.stringify(first)).not.toContain('raw-generator-secret')
  })

  it.each([
    ['typescript-axios', httpAsset],
    ['sse-fetch', sseAsset],
    ['browser-websocket', websocketAsset],
  ] as const)('returns deterministic %s output', (language, asset) => {
    expect(generateCode(asset, language)).toEqual(generateCode(asset, language))
  })

  it.each([
    ['typescript-axios', httpAsset],
    ['sse-fetch', sseAsset],
    ['browser-websocket', websocketAsset],
  ] as const)('keeps every adapter output free of source-only metadata', (language, asset) => {
    const unsafe = {
      ...asset,
      request: {
        ...asset.request,
        headers: [
          {
            id: 'header-id-should-not-leak',
            enabled: true,
            key: 'Authorization',
            value: 'raw-generator-secret',
          },
          { id: 'placeholder-id', enabled: true, key: 'X-Variable', value: '{{TOKEN}}' },
        ],
      },
    } as unknown as RequestAssetV1

    const result = generateCode(unsafe, language)

    if (language !== 'browser-websocket') expect(result.content).toContain('{{TOKEN}}')
    expect(JSON.stringify(result)).not.toContain('raw-generator-secret')
    expect(JSON.stringify(result)).not.toContain('header-id-should-not-leak')
  })

  it.each([
    ['typescript-axios', httpAsset],
    ['sse-fetch', sseAsset],
    ['browser-websocket', websocketAsset],
  ] as const)('keeps local entry paths out of %s output', (language, asset) => {
    const withPaths = {
      ...asset,
      request: {
        ...asset.request,
        params: [
          { id: 'path-param', enabled: true, key: 'source', value: 'C:\\Users\\me\\query.txt' },
        ],
        headers: [
          { id: 'path-header', enabled: true, key: 'X-Source', value: '/home/me/header.txt' },
        ],
      },
    } as RequestAssetV1

    expect(JSON.stringify(generateCode(withPaths, language))).not.toMatch(
      /C:\\\\Users|C%3A%5CUsers|\/home\/me|%2Fhome%2Fme/,
    )
  })

  it.each([
    [
      { type: 'text', content: 'ordinary text', contentType: 'text/plain' } as const,
      'opaque-text',
    ],
    [
      {
        type: 'multipart',
        entries: [
          {
            id: 'f1',
            enabled: true,
            key: 'upload',
            kind: 'file',
            fileRef: null,
            filename: 'file.bin',
          },
        ],
      } as const,
      'file-content-omitted',
    ],
    [{ type: 'binary', fileRef: null } as const, 'file-content-omitted'],
  ])('reports the expected warning for body type $type', (body, warningCode) => {
    const result = generateCode(
      {
        ...httpAsset,
        request: {
          ...httpAsset.request,
          method: 'POST',
          body: body as Extract<RequestAssetV1, { protocol: 'http' }>['request']['body'],
        },
      },
      'javascript-fetch',
    )
    expect(result.warnings.map(({ code }) => code)).toContain(warningCode)
  })
})
