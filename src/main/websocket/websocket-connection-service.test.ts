import { afterEach, beforeEach, expect, it } from 'vitest'
import { createDatabase } from '../database/database'
import { startMockStreamingServer } from '../../test/mock-streaming-server'
import { WebSocketConnectionService } from './websocket-connection-service'
import { defaultWebSocketConfig } from '../../shared/streaming/streaming-schemas'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
let server: Awaited<ReturnType<typeof startMockStreamingServer>>, db: ReturnType<typeof createDatabase>, dir: string
beforeEach(async () => {
  server = await startMockStreamingServer()
  dir = mkdtempSync(join(tmpdir(), 'rs-ws-'))
  db = createDatabase(':memory:')
  db.prepare("insert into workspaces values('w','W','x','x')").run()
  db.prepare("insert into collections values('c','w','C','x','x')").run()
  db.prepare(
    "insert into saved_requests(id,workspace_id,collection_id,name,protocol,method,url,description,created_at,updated_at) values('r','w','c','R','websocket',null,'','','x','x')",
  ).run()
})
afterEach(async () => {
  db.close()
  await server.close()
  rmSync(dir, { recursive: true, force: true })
})
const draft = (path = '/ws/echo', overrides: any = {}) => ({
  savedRequestId: 'r',
  workspaceId: 'w',
  name: 'R',
  url: server.wsUrl + path,
  params: [],
  headers: [],
  auth: { type: 'none' as const },
  ...defaultWebSocketConfig,
  ...overrides,
})
const waitUntil = async (predicate: () => boolean) => {
  const deadline = Date.now() + 1000
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for WebSocket event.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}
it('connects, sends text/JSON/Base64 and records ordered echo messages', async () => {
  const events: any[] = [],
    service = new WebSocketConnectionService(db, { assetRoot: dir, emit: (e) => events.push(e) }),
    run = service.start(draft(), [])
  await run.opened
  await service.sendText(run.connectionId, 'hello', [])
  await service.sendJson(run.connectionId, '{"x":1}', [])
  await service.sendBinary(run.connectionId, Buffer.from('bin').toString('base64'))
  await waitUntil(() => events.filter((e) => e.type === 'record').length === 6)
  expect(events.filter((e) => e.type === 'record').map((e) => e.record.direction)).toEqual([
    'outbound',
    'outbound',
    'outbound',
    'inbound',
    'inbound',
    'inbound',
  ])
  expect(service.disconnect(run.connectionId)).toBe(true)
  expect(service.disconnect(run.connectionId)).toBe(false)
  await run.closed
  expect(service.activeCount).toBe(0)
})
it('resourceizes inbound binary and negotiates subprotocol', async () => {
  const events: any[] = [],
    service = new WebSocketConnectionService(db, { assetRoot: dir, emit: (e) => events.push(e) }),
    run = service.start(draft('/ws/binary', { subprotocols: ['chat'] }), [])
  await run.opened
  await waitUntil(() => events.some((e) => e.type === 'record' && e.record.direction === 'inbound'))
  expect(events.find((e) => e.type === 'lifecycle' && e.state === 'open').negotiatedProtocol).toBe('chat')
  const binary = events.find((e) => e.type === 'record' && e.record.direction === 'inbound')
  expect(binary.record).toMatchObject({ dataKind: 'binary', byteLength: 8 })
  expect(binary.record.resourceId).toBeTruthy()
  service.disconnect(run.connectionId)
  await run.closed
})
