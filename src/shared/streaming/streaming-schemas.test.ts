import { describe, expect, it } from 'vitest'
import { defaultSseConfig, defaultWebSocketConfig, sseDraftSchema, webSocketDraftSchema } from './streaming-schemas'
const base = {
  savedRequestId: 'r',
  workspaceId: 'w',
  name: 'R',
  url: 'ws://127.0.0.1',
  params: [],
  headers: [],
  auth: { type: 'none' as const },
}
describe('streaming schemas', () => {
  it('accepts bounded WebSocket settings and rejects schemes/subprotocols', () => {
    expect(webSocketDraftSchema.safeParse({ ...base, ...defaultWebSocketConfig }).success).toBe(true)
    expect(webSocketDraftSchema.safeParse({ ...base, ...defaultWebSocketConfig, url: 'https://x' }).success).toBe(false)
    expect(
      webSocketDraftSchema.safeParse({ ...base, ...defaultWebSocketConfig, subprotocols: ['bad space'] }).success,
    ).toBe(false)
  })
  it('accepts GET/POST SSE and rejects bodies on GET and unbounded events', () => {
    const s = { ...base, url: 'http://127.0.0.1/events', ...defaultSseConfig }
    expect(sseDraftSchema.safeParse(s).success).toBe(true)
    expect(sseDraftSchema.safeParse({ ...s, body: { type: 'text', content: 'x' } }).success).toBe(false)
    expect(sseDraftSchema.safeParse({ ...s, maxEventBytes: 11 * 1024 * 1024 }).success).toBe(false)
    expect(sseDraftSchema.safeParse({ ...s, method: 'POST', body: { type: 'json', content: '{}' } }).success).toBe(true)
  })
})
