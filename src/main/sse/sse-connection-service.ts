/* eslint-disable no-useless-assignment */
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { SseDraft } from '../../shared/streaming/streaming-schemas'
import type { StreamingEvent } from '../../shared/streaming/streaming-contracts'
import type { EnvironmentValue } from '../http/variable-resolver'
import { buildSseRequest } from '../streaming/stream-request-builder'
import { safeSnapshot } from '../streaming/streaming-redaction'
import { redactStreamingValue } from '../streaming/streaming-redaction'
import { StreamingHistoryService } from '../streaming/streaming-history-service'
import { SseParser } from './sse-parser'
type Active = {
  controller: AbortController
  sessionId: string
  requestId: string
  variables: EnvironmentValue[]
  manual: boolean
  timers: Set<ReturnType<typeof setTimeout>>
}
const failure = (code: string, message: string) =>
  Object.assign(new Error(message), { code, category: 'sse', retryable: false })
export class SseConnectionService {
  private active = new Map<string, Active>()
  private history: StreamingHistoryService
  constructor(
    private db: Database.Database,
    private options: { emit: (event: StreamingEvent) => void },
  ) {
    this.history = new StreamingHistoryService(db)
  }
  get activeCount() {
    return this.active.size
  }
  start(draft: SseDraft, variables: EnvironmentValue[]) {
    const connectionId = randomUUID(),
      built = buildSseRequest(draft, variables),
      session = this.history.createSession({
        workspaceId: draft.workspaceId,
        savedRequestId: draft.savedRequestId,
        protocol: 'sse',
        requestName: draft.name,
        snapshot: safeSnapshot(draft, built.secretValues),
      }),
      active: Active = {
        controller: new AbortController(),
        sessionId: session.id,
        requestId: draft.savedRequestId,
        variables,
        manual: false,
        timers: new Set(),
      }
    this.active.set(connectionId, active)
    const result = this.run(connectionId, draft, built, active)
    return { connectionId, sessionId: session.id, result }
  }
  stop(connectionId: string) {
    const a = this.active.get(connectionId)
    if (!a || a.controller.signal.aborted) return false
    a.manual = true
    a.controller.abort()
    return true
  }
  stopAll() {
    for (const id of [...this.active.keys()]) this.stop(id)
  }
  private life(connectionId: string, a: Active, state: any, metrics?: Record<string, any>) {
    this.options.emit({
      type: 'lifecycle',
      protocol: 'sse',
      connectionId,
      sessionId: a.sessionId,
      requestId: a.requestId,
      state,
      timestamp: Date.now(),
      metrics,
    })
  }
  private async run(connectionId: string, draft: SseDraft, built: ReturnType<typeof buildSseRequest>, a: Active) {
    let received = 0,
      firstAt = 0,
      lastId = '',
      retry: number | null = null,
      events = 0,
      connected = 0
    const timer = (ms: number, code: string) => {
      if (!ms) return
      const t = setTimeout(() => a.controller.abort(code), ms)
      a.timers.add(t)
    }
    try {
      this.life(connectionId, a, 'connecting')
      timer(draft.connectTimeoutMs, 'connect')
      const response = await fetch(built.url, {
        method: built.method,
        headers: built.headers,
        body: built.body,
        signal: a.controller.signal,
      })
      for (const t of a.timers) clearTimeout(t)
      a.timers.clear()
      if (!response.ok) throw failure('sse_http_error', `SSE server returned HTTP ${response.status}.`)
      if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream'))
        throw failure('sse_invalid_content_type', 'SSE response must use text/event-stream.')
      connected = Date.now()
      this.db
        .prepare("UPDATE stream_sessions SET status='streaming',connected_at=? WHERE id=?")
        .run(new Date(connected).toISOString(), a.sessionId)
      this.life(connectionId, a, 'streaming')
      timer(draft.maxSessionDurationMs, 'session')
      let idle: ReturnType<typeof setTimeout> | undefined
      const resetIdle = () => {
        if (idle) clearTimeout(idle)
        if (draft.idleTimeoutMs) idle = setTimeout(() => a.controller.abort('idle'), draft.idleTimeoutMs)
      }
      resetIdle()
      const decoder = new TextDecoder(),
        parser = new SseParser((event) => {
          const bytes = Buffer.byteLength(event.data)
          if (bytes > draft.maxEventBytes) {
            a.controller.abort('event-too-large')
            return
          }
          events++
          if (!firstAt) firstAt = Date.now()
          lastId = event.lastEventId
          retry = event.retryMs
          const preview = redactStreamingValue(
              event.data,
              a.variables.filter((v) => v.isSecret).map((v) => v.value),
            ),
            parsed = (() => {
              try {
                return JSON.stringify(JSON.parse(preview))
              } catch {
                return undefined
              }
            })(),
            row = this.history.appendRecord(a.sessionId, {
              direction: 'inbound',
              recordType: 'event',
              dataKind: parsed ? 'json' : 'text',
              byteLength: bytes,
              textPreview: preview,
              jsonText: parsed,
              eventName: event.event,
              eventId: event.lastEventId,
              retryMs: event.retryMs,
              outcome: 'received',
            })
          this.options.emit({
            type: 'record',
            protocol: 'sse',
            connectionId,
            sessionId: a.sessionId,
            requestId: a.requestId,
            record: {
              id: row.id,
              sequence: row.sequence,
              direction: 'inbound',
              recordType: 'event',
              dataKind: parsed ? 'json' : 'text',
              timestamp: row.timestamp,
              byteLength: bytes,
              preview: preview.slice(0, 2048),
              eventName: event.event,
              eventId: event.lastEventId,
              retryMs: event.retryMs,
              outcome: 'received',
            },
          })
        }, draft.maxEventBytes)
      if (response.body)
        for await (const chunk of response.body as any) {
          if (a.controller.signal.aborted) break
          const bytes = chunk as Uint8Array
          received += bytes.byteLength
          resetIdle()
          parser.push(decoder.decode(bytes, { stream: true }))
        }
      parser.push(decoder.decode())
      parser.finish()
      if (idle) clearTimeout(idle)
      this.history.finalize(a.sessionId, {
        status: a.manual ? 'stopped' : 'completed',
        closeReason: a.manual ? 'user' : 'remote-complete',
      })
      this.life(connectionId, a, a.manual ? 'stopped' : 'completed', {
        receivedBytes: received,
        eventCount: events,
        timeToFirstEventMs: firstAt ? firstAt - connected : null,
        lastEventId: lastId,
        retryMs: retry,
      })
    } catch (error: any) {
      if (a.manual) {
        this.history.finalize(a.sessionId, { status: 'stopped', closeReason: 'user' })
        this.life(connectionId, a, 'stopped')
        return
      }
      const reason = a.controller.signal.reason,
        err =
          reason === 'connect'
            ? failure('sse_connect_timeout', 'SSE connection timed out.')
            : reason === 'idle'
              ? failure('sse_idle_timeout', 'SSE stream was idle too long.')
              : reason === 'session'
                ? failure('sse_session_timeout', 'SSE session reached its time limit.')
                : reason === 'event-too-large'
                  ? failure('sse_event_too_large', 'SSE event exceeded the maximum size.')
                  : error?.code
                    ? error
                    : failure('sse_stream_failed', 'SSE stream failed.')
      this.history.finalize(a.sessionId, { status: 'failed', error: { code: err.code, message: err.message } })
      this.life(connectionId, a, 'failed')
      throw err
    } finally {
      for (const t of a.timers) clearTimeout(t)
      this.active.delete(connectionId)
    }
  }
}
