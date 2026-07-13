import { expect, it } from 'vitest'
import { buildSseRequest, buildWebSocketRequest } from './stream-request-builder'
import { defaultSseConfig, defaultWebSocketConfig } from '../../shared/streaming/streaming-schemas'
const common = {
  savedRequestId: 'r',
  workspaceId: 'w',
  name: 'R',
  params: [{ id: 'p', enabled: true, key: 'q', value: '{{TOKEN}}' }],
  headers: [{ id: 'h', enabled: true, key: 'X-Test', value: 'ok' }],
  auth: { type: 'bearer' as const, token: '{{TOKEN}}' },
}
it('builds WebSocket query, headers and ordered subprotocols with variables', () => {
  const value = buildWebSocketRequest(
    { ...common, url: 'ws://localhost/socket?old=1', ...defaultWebSocketConfig, subprotocols: ['chat', 'json'] },
    [{ key: 'TOKEN', value: 'secret', isSecret: true }],
  )
  expect(value).toMatchObject({
    url: 'ws://localhost/socket?old=1&q=secret',
    headers: { 'X-Test': 'ok', authorization: 'Bearer secret' },
    subprotocols: ['chat', 'json'],
  })
  expect(value.secretValues).toEqual(['secret'])
})
it('builds POST SSE JSON and required defaults', () => {
  const value = buildSseRequest(
    {
      ...common,
      url: 'http://localhost/events',
      ...defaultSseConfig,
      method: 'POST',
      body: { type: 'json', content: '{"token":"{{TOKEN}}"}' },
    },
    [{ key: 'TOKEN', value: 'secret', isSecret: true }],
  )
  expect(value).toMatchObject({
    method: 'POST',
    headers: {
      'X-Test': 'ok',
      authorization: 'Bearer secret',
      accept: 'text/event-stream',
      'cache-control': 'no-cache',
      'content-type': 'application/json',
    },
    body: '{"token":"secret"}',
  })
})
