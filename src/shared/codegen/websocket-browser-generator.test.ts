import { describe, expect, it } from 'vitest'
import type { RequestAssetV1 } from '../assets/request-asset'
import { generateCode } from './code-generation'

const asset = (request: Extract<RequestAssetV1, { protocol: 'websocket' }>['request']): RequestAssetV1 => ({
  format: 'request-studio.request',
  version: 1,
  protocol: 'websocket',
  name: 'Events',
  description: '',
  request,
})

const baseRequest: Extract<RequestAssetV1, { protocol: 'websocket' }>['request'] = {
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
}

describe('Browser WebSocket generator', () => {
  it('generates URL query parameters and subprotocols', () => {
    expect(
      generateCode(
        asset({
          ...baseRequest,
          params: [{ id: 'p1', enabled: true, key: 'channel', value: '{{CHANNEL}}' }],
          subprotocols: ['chat', 'events'],
        }),
        'browser-websocket',
      ).content,
    ).toBe(
      [
        'const socket = new WebSocket(',
        '  "wss://api.example.com/events?channel={{CHANNEL}}",',
        '  ["chat", "events"],',
        ')',
      ].join('\n'),
    )
  })

  it('warns without exposing unsupported custom header values', () => {
    const result = generateCode(
      asset({
        ...baseRequest,
        headers: [{ id: 'h1', enabled: true, key: 'Authorization', value: '{{TOKEN}}' }],
      }),
      'browser-websocket',
    )

    expect(result.warnings).toContainEqual({
      code: 'browser-websocket-headers-omitted',
      message: 'Browser WebSocket does not support custom headers or header-based authentication.',
    })
    expect(result.content).not.toContain('{{TOKEN}}')
  })
})
