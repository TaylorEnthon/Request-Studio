import { afterEach, beforeEach, expect, it } from 'vitest'
import { createDatabase } from '../database/database'
import { startMockStreamingServer } from '../../test/mock-streaming-server'
import { SseConnectionService } from './sse-connection-service'
import { defaultSseConfig } from '../../shared/streaming/streaming-schemas'
let server: Awaited<ReturnType<typeof startMockStreamingServer>>, db: ReturnType<typeof createDatabase>
beforeEach(async () => {
  server = await startMockStreamingServer()
  db = createDatabase(':memory:')
  db.prepare("insert into workspaces values('w','W','x','x')").run()
  db.prepare("insert into collections values('c','w','C','x','x')").run()
  db.prepare(
    "insert into saved_requests(id,workspace_id,collection_id,name,protocol,method,url,description,created_at,updated_at) values('r','w','c','R','sse','GET','','','x','x')",
  ).run()
})
afterEach(async () => {
  db.close()
  await server.close()
})
const draft = (path: string, overrides: any = {}) => ({
  savedRequestId: 'r',
  workspaceId: 'w',
  name: 'R',
  url: server.httpUrl + path,
  params: [],
  headers: [],
  auth: { type: 'none' as const },
  ...defaultSseConfig,
  ...overrides,
})
it('streams chunked UTF-8 events with sequence and metrics into History', async () => {
  const events: any[] = [],
    service = new SseConnectionService(db, { emit: (e) => events.push(e) }),
    run = service.start(draft('/sse/chunked'), [])
  await run.result
  const records = events.filter((e) => e.type === 'record')
  expect(records.map((e) => e.record.preview)).toEqual(['你好', '{"x":1}'])
  expect(records.map((e) => e.record.sequence)).toEqual([1, 2])
  const session = db.prepare('select * from stream_sessions where id=?').get(run.sessionId) as any
  expect(session).toMatchObject({ status: 'completed', event_count: 2 })
  expect(session.first_record_at).toBeTruthy()
  expect(service.activeCount).toBe(0)
})
it('fails closed on HTTP/content type and stops idempotently', async () => {
  const service = new SseConnectionService(db, { emit: () => {} })
  await expect(service.start(draft('/sse/http-400'), []).result).rejects.toMatchObject({ code: 'sse_http_error' })
  await expect(service.start(draft('/sse/wrong-content-type'), []).result).rejects.toMatchObject({
    code: 'sse_invalid_content_type',
  })
  const idle = service.start(draft('/sse/idle', { idleTimeoutMs: 1000 }), [])
  expect(service.stop(idle.connectionId)).toBe(true)
  expect(service.stop(idle.connectionId)).toBe(false)
  await idle.result
  expect(service.activeCount).toBe(0)
})
