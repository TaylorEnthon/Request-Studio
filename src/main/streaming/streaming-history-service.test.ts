import { expect, it } from 'vitest'
import { createDatabase } from '../database/database'
import { StreamingHistoryService } from './streaming-history-service'
it('persists ordered bounded session records and keeps sessions after request deletion', () => {
  const db = createDatabase(':memory:')
  db.prepare("insert into workspaces values('w','W','x','x')").run()
  db.prepare("insert into collections values('c','w','C','x','x')").run()
  db.prepare(
    "insert into saved_requests(id,workspace_id,collection_id,name,protocol,method,url,description,created_at,updated_at) values('r','w','c','R','websocket',null,'','','x','x')",
  ).run()
  const history = new StreamingHistoryService(db),
    session = history.createSession({
      workspaceId: 'w',
      savedRequestId: 'r',
      protocol: 'websocket',
      requestName: 'R',
      snapshot: { safe: true },
    })
  const one = history.appendRecord(session.id, {
      direction: 'outbound',
      recordType: 'message',
      dataKind: 'text',
      byteLength: 2,
      textPreview: 'hi',
      outcome: 'sent',
    }),
    two = history.appendRecord(session.id, {
      direction: 'inbound',
      recordType: 'message',
      dataKind: 'json',
      byteLength: 7,
      textPreview: '{"x":1}',
      jsonText: '{"x":1}',
      outcome: 'received',
    })
  expect([one.sequence, two.sequence]).toEqual([1, 2])
  history.finalize(session.id, { status: 'closed', closeCode: 1000, closeReason: 'done' })
  db.prepare("delete from saved_requests where id='r'").run()
  expect((history.get(session.id, 'w') as any).saved_request_id).toBeNull()
  expect(history.records(session.id)).toHaveLength(2)
  db.close()
})
