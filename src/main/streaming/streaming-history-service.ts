import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { STREAM_LIMITS } from '../../shared/streaming/streaming-constants'
const now = () => new Date().toISOString()
export class StreamingHistoryService {
  constructor(private db: Database.Database) {}
  createSession(input: {
    workspaceId: string
    savedRequestId: string | null
    protocol: 'websocket' | 'sse'
    requestName: string
    snapshot: unknown
  }) {
    const id = randomUUID(),
      created = now(),
      saved =
        input.savedRequestId &&
        this.db
          .prepare('SELECT 1 FROM saved_requests WHERE id=? AND workspace_id=?')
          .get(input.savedRequestId, input.workspaceId)
          ? input.savedRequestId
          : null
    this.db
      .prepare(
        'INSERT INTO stream_sessions(id,workspace_id,saved_request_id,protocol,request_name,status,started_at,request_snapshot_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        input.workspaceId,
        saved,
        input.protocol,
        input.requestName,
        'connecting',
        created,
        JSON.stringify(input.snapshot),
        created,
      )
    return this.get(id, input.workspaceId) as any
  }
  appendRecord(
    sessionId: string,
    input: {
      direction: 'system' | 'inbound' | 'outbound'
      recordType: 'lifecycle' | 'message' | 'event'
      dataKind: 'text' | 'json' | 'binary'
      byteLength: number
      textPreview?: string
      jsonText?: string
      resourceId?: string
      eventName?: string
      eventId?: string
      retryMs?: number | null
      outcome?: string
      metadata?: unknown
    },
  ) {
    return this.db.transaction(() => {
      const sequence =
          ((
            this.db
              .prepare('SELECT MAX(sequence) sequence FROM stream_records WHERE session_id=?')
              .get(sessionId) as any
          ).sequence ?? 0) + 1,
        id = randomUUID(),
        timestamp = Date.now(),
        created = now()
      this.db
        .prepare(
          'INSERT INTO stream_records(id,session_id,sequence,direction,record_type,data_kind,timestamp,byte_length,text_preview,json_text,resource_id,event_name,event_id,retry_ms,outcome,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          sessionId,
          sequence,
          input.direction,
          input.recordType,
          input.dataKind,
          timestamp,
          input.byteLength,
          input.textPreview?.slice(0, 2048) ?? null,
          input.jsonText ?? null,
          input.resourceId ?? null,
          input.eventName ?? null,
          input.eventId ?? null,
          input.retryMs ?? null,
          input.outcome ?? null,
          JSON.stringify(input.metadata ?? {}),
          created,
        )
      const inbound = input.direction === 'inbound' ? 1 : 0,
        outbound = input.direction === 'outbound' ? 1 : 0,
        event = input.recordType === 'event' ? 1 : 0
      this.db
        .prepare(
          'UPDATE stream_sessions SET inbound_count=inbound_count+?,outbound_count=outbound_count+?,event_count=event_count+?,inbound_bytes=inbound_bytes+?,outbound_bytes=outbound_bytes+?,first_record_at=COALESCE(first_record_at,?) WHERE id=?',
        )
        .run(
          inbound,
          outbound,
          event,
          inbound ? input.byteLength : 0,
          outbound ? input.byteLength : 0,
          created,
          sessionId,
        )
      const stale = this.db
        .prepare('SELECT id FROM stream_records WHERE session_id=? ORDER BY sequence DESC LIMIT -1 OFFSET ?')
        .all(sessionId, STREAM_LIMITS.dbRecords) as { id: string }[]
      for (const row of stale) this.db.prepare('DELETE FROM stream_records WHERE id=?').run(row.id)
      return this.db.prepare('SELECT * FROM stream_records WHERE id=?').get(id) as any
    })()
  }
  markConnected(id: string) {
    this.db
      .prepare("UPDATE stream_sessions SET status='open',connected_at=COALESCE(connected_at,?) WHERE id=?")
      .run(now(), id)
  }
  incrementReconnect(id: string) {
    this.db.prepare('UPDATE stream_sessions SET reconnect_count=reconnect_count+1 WHERE id=?').run(id)
  }
  finalize(id: string, input: { status: string; closeCode?: number; closeReason?: string; error?: unknown }) {
    const ended = now(),
      started = (this.db.prepare('SELECT started_at FROM stream_sessions WHERE id=?').get(id) as any)?.started_at
    this.db
      .prepare(
        'UPDATE stream_sessions SET status=?,ended_at=?,duration_ms=?,close_code=?,close_reason_redacted=?,error_json=? WHERE id=?',
      )
      .run(
        input.status,
        ended,
        started ? Date.now() - Date.parse(started) : null,
        input.closeCode ?? null,
        input.closeReason?.slice(0, 200) ?? null,
        input.error ? JSON.stringify(input.error) : null,
        id,
      )
  }
  list(workspaceId: string, protocol?: string) {
    return this.db
      .prepare(
        `SELECT * FROM stream_sessions WHERE workspace_id=?${protocol ? ' AND protocol=?' : ''} ORDER BY created_at DESC LIMIT ?`,
      )
      .all(
        ...(protocol
          ? [workspaceId, protocol, STREAM_LIMITS.sessionsPerWorkspace]
          : [workspaceId, STREAM_LIMITS.sessionsPerWorkspace]),
      )
  }
  get(id: string, workspaceId: string) {
    return this.db.prepare('SELECT * FROM stream_sessions WHERE id=? AND workspace_id=?').get(id, workspaceId)
  }
  records(sessionId: string, limit = STREAM_LIMITS.liveRecords) {
    return this.db
      .prepare('SELECT * FROM stream_records WHERE session_id=? ORDER BY sequence DESC LIMIT ?')
      .all(sessionId, limit)
      .reverse()
  }
  delete(id: string, workspaceId: string) {
    return this.db.prepare('DELETE FROM stream_sessions WHERE id=? AND workspace_id=?').run(id, workspaceId).changes > 0
  }
  clear(workspaceId: string, protocol?: string) {
    return this.db
      .prepare(`DELETE FROM stream_sessions WHERE workspace_id=?${protocol ? ' AND protocol=?' : ''}`)
      .run(...(protocol ? [workspaceId, protocol] : [workspaceId])).changes
  }
}
