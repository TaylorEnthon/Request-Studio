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

describe('code generation contract', () => {
  it('registers deterministic HTTP-only generator capabilities', () => {
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
