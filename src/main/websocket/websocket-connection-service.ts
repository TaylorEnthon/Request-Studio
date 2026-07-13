/* eslint-disable no-empty */
import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import WebSocket from 'ws'
import type { WebSocketDraft } from '../../shared/streaming/streaming-schemas'
import type { EnvironmentValue } from '../http/variable-resolver'
import type { StreamingEvent } from '../../shared/streaming/streaming-contracts'
import { buildWebSocketRequest } from '../streaming/stream-request-builder'
import { redactStreamingValue, safeSnapshot } from '../streaming/streaming-redaction'
import { StreamingHistoryService } from '../streaming/streaming-history-service'
import { inspectBase64 } from '../response/base64-inspector'
import { classifyResponse } from '../response/response-classifier'
import { ResponseResourceRegistry } from '../response/response-resource-registry'
type Active = {
  socket?: WebSocket
  sessionId: string
  requestId: string
  workspaceId: string
  draft: WebSocketDraft
  variables: EnvironmentValue[]
  state: string
  manual: boolean
  generation: number
  attempt: number
  timers: Set<ReturnType<typeof setTimeout>>
  openedResolve: () => void
  openedReject: (e: any) => void
  closedResolve: () => void
}
const fail = (code: string, message: string) =>
  Object.assign(new Error(message), { code, category: 'websocket', retryable: false })
export class WebSocketConnectionService {
  private active = new Map<string, Active>()
  private byRequest = new Map<string, string>()
  private history: StreamingHistoryService
  private resources: ResponseResourceRegistry
  constructor(
    private db: Database.Database,
    private options: {
      assetRoot: string
      emit: (event: StreamingEvent) => void
      resources?: ResponseResourceRegistry
      resolveFile?: (ref: string) => Promise<{ bytes: Buffer; filename: string }>
    },
  ) {
    this.history = new StreamingHistoryService(db)
    this.resources = options.resources ?? new ResponseResourceRegistry([options.assetRoot])
  }
  get activeCount() {
    return this.active.size
  }
  start(draft: WebSocketDraft, variables: EnvironmentValue[]) {
    if (this.byRequest.has(draft.savedRequestId))
      throw fail('websocket_already_connected', 'This request already has an active connection.')
    const built = buildWebSocketRequest(draft, variables),
      session = this.history.createSession({
        workspaceId: draft.workspaceId,
        savedRequestId: draft.savedRequestId,
        protocol: 'websocket',
        requestName: draft.name,
        snapshot: safeSnapshot(draft, built.secretValues),
      }),
      connectionId = randomUUID()
    let openedResolve!: () => void, openedReject!: (e: any) => void, closedResolve!: () => void
    const opened = new Promise<void>((r, j) => {
        openedResolve = r
        openedReject = j
      }),
      closed = new Promise<void>((r) => (closedResolve = r)),
      a: Active = {
        sessionId: session.id,
        requestId: draft.savedRequestId,
        workspaceId: draft.workspaceId,
        draft,
        variables,
        state: 'connecting',
        manual: false,
        generation: 0,
        attempt: 0,
        timers: new Set(),
        openedResolve,
        openedReject,
        closedResolve,
      }
    this.active.set(connectionId, a)
    this.byRequest.set(draft.savedRequestId, connectionId)
    this.connect(connectionId, a)
    return { connectionId, sessionId: session.id, opened, closed }
  }
  disconnect(id: string) {
    const a = this.active.get(id)
    if (!a || a.manual) return false
    a.manual = true
    a.state = 'closing'
    this.life(id, a, 'closing')
    a.socket?.close(1000, 'user')
    if (!a.socket || a.socket.readyState === WebSocket.CLOSED) this.finish(id, a, 1000, 'user')
    return true
  }
  disconnectAll() {
    for (const id of [...this.active.keys()]) {
      const a = this.active.get(id)!
      a.manual = true
      a.socket?.close(1001, 'shutdown')
      this.finish(id, a, 1001, 'shutdown')
    }
  }
  async sendText(id: string, text: string, variables?: EnvironmentValue[]) {
    const a = this.open(id),
      activeVariables = variables ?? a.variables,
      value = buildWebSocketRequest({ ...a.draft, url: a.draft.url }, activeVariables)
    void value
    const resolved = (await import('../http/variable-resolver')).resolveTemplate(text, activeVariables).value
    this.send(
      id,
      a,
      resolved,
      false,
      'text',
      redactStreamingValue(
        resolved,
        activeVariables.filter((v) => v.isSecret).map((v) => v.value),
      ),
    )
  }
  async sendJson(id: string, text: string, variables?: EnvironmentValue[]) {
    const a = this.open(id),
      activeVariables = variables ?? a.variables,
      resolved = (await import('../http/variable-resolver')).resolveTemplate(text, activeVariables).value
    JSON.parse(resolved)
    this.send(
      id,
      a,
      resolved,
      false,
      'json',
      redactStreamingValue(
        resolved,
        activeVariables.filter((v) => v.isSecret).map((v) => v.value),
      ),
    )
  }
  async sendBinary(id: string, base64: string) {
    const inspected = inspectBase64(base64),
      a = this.open(id)
    if (inspected.byteLength > a.draft.maxMessageBytes)
      throw fail('websocket_message_too_large', 'WebSocket message exceeded the maximum size.')
    this.send(id, a, inspected.bytes, true, 'binary', '[Binary]')
  }
  async sendFile(id: string, fileRef: string) {
    const a = this.open(id)
    if (!this.options.resolveFile) throw fail('websocket_file_not_found', 'Select the file again.')
    const file = await this.options.resolveFile(fileRef)
    if (file.bytes.length > a.draft.maxMessageBytes)
      throw fail('websocket_message_too_large', 'WebSocket file exceeded the maximum size.')
    this.send(id, a, file.bytes, true, 'binary', `[File: ${file.filename}]`)
  }
  private open(id: string) {
    const a = this.active.get(id)
    if (!a || a.state !== 'open' || !a.socket) throw fail('websocket_not_open', 'WebSocket is not open.')
    return a
  }
  private send(
    id: string,
    a: Active,
    data: WebSocket.Data,
    binary: boolean,
    kind: 'text' | 'json' | 'binary',
    preview: string,
  ) {
    const bytes = typeof data === 'string' ? Buffer.byteLength(data) : Buffer.byteLength(data as any)
    if (bytes > a.draft.maxMessageBytes)
      throw fail('websocket_message_too_large', 'WebSocket message exceeded the maximum size.')
    a.socket!.send(data, { binary })
    const row = this.history.appendRecord(a.sessionId, {
      direction: 'outbound',
      recordType: 'message',
      dataKind: kind,
      byteLength: bytes,
      textPreview: preview,
      jsonText: kind === 'json' ? preview : undefined,
      outcome: 'sent',
    })
    this.record(id, a, row, kind, preview, 'outbound', bytes)
  }
  private connect(id: string, a: Active) {
    const generation = ++a.generation,
      built = buildWebSocketRequest(a.draft, a.variables)
    a.state = a.attempt ? 'reconnecting' : 'connecting'
    this.life(id, a, a.state as any)
    const socket = new WebSocket(built.url, a.draft.subprotocols, {
      headers: built.headers,
      maxPayload: a.draft.maxMessageBytes,
      handshakeTimeout: a.draft.connectTimeoutMs,
    })
    a.socket = socket
    socket.on('open', () => {
      if (generation !== a.generation) return
      a.state = 'open'
      this.history.markConnected(a.sessionId)
      a.openedResolve()
      this.life(id, a, 'open', { negotiatedProtocol: socket.protocol || '' })
      if (a.draft.pingEnabled) {
        const timer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN)
            try {
              socket.ping()
            } catch {
              /* close handler owns failure */
            }
        }, a.draft.pingIntervalMs)
        a.timers.add(timer as any)
      }
    })
    socket.on('message', (data, binary) => {
      if (generation !== a.generation) return
      void this.inbound(id, a, Buffer.from(data as any), binary)
    })
    socket.on('error', () => {})
    socket.on('close', (code, reason) => {
      if (generation !== a.generation) return
      for (const t of a.timers) clearInterval(t as any)
      a.timers.clear()
      if (!a.manual && code !== 1000 && a.draft.autoReconnect && a.attempt < a.draft.maxReconnectAttempts) {
        a.attempt++
        a.generation++
        this.history.incrementReconnect(a.sessionId)
        a.state = 'reconnecting'
        this.life(id, a, 'reconnecting')
        const timer = setTimeout(() => this.connect(id, a), a.draft.reconnectDelayMs)
        a.timers.add(timer)
        return
      }
      this.finish(id, a, code, reason.toString())
    })
  }
  private async inbound(id: string, a: Active, bytes: Buffer, binary: boolean) {
    if (bytes.length > a.draft.maxMessageBytes) {
      a.socket?.terminate()
      return
    }
    if (!binary) {
      const text = bytes.toString('utf8')
      let kind: 'text' | 'json' = 'text'
      try {
        JSON.parse(text)
        kind = 'json'
      } catch {}
      const preview = redactStreamingValue(
          text,
          a.variables.filter((v) => v.isSecret).map((v) => v.value),
        ),
        row = this.history.appendRecord(a.sessionId, {
          direction: 'inbound',
          recordType: 'message',
          dataKind: kind,
          byteLength: bytes.length,
          textPreview: preview,
          jsonText: kind === 'json' ? preview : undefined,
          outcome: 'received',
        })
      this.record(id, a, row, kind, preview, 'inbound', bytes.length)
      return
    }
    const resourceId = randomUUID(),
      dir = join(this.options.assetRoot, a.workspaceId, a.sessionId)
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${resourceId}.bin`)
    await writeFile(path, bytes)
    const c = classifyResponse(null, bytes.subarray(0, 4096)),
      kind = c.kind === 'image' || c.kind === 'audio' || c.kind === 'video' || c.kind === 'pdf' ? c.kind : 'binary'
    await this.resources.register(
      {
        historyId: a.sessionId,
        source: 'stream-record',
        kind,
        declaredMimeType: null,
        detectedMimeType: c.detectedMimeType,
        effectiveMimeType: c.effectiveMimeType,
        byteLength: bytes.length,
        suggestedFilename: `message-${resourceId.slice(0, 8)}.bin`,
        warnings: c.warnings,
        path,
      },
      resourceId,
      null,
      false,
    )
    this.db
      .prepare(
        'INSERT INTO stream_resources(id,session_id,kind,mime_type,path,byte_length,suggested_filename,warnings_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      )
      .run(
        resourceId,
        a.sessionId,
        kind,
        c.effectiveMimeType,
        path,
        bytes.length,
        `message-${resourceId.slice(0, 8)}.bin`,
        JSON.stringify(c.warnings),
        new Date().toISOString(),
      )
    const row = this.history.appendRecord(a.sessionId, {
      direction: 'inbound',
      recordType: 'message',
      dataKind: 'binary',
      byteLength: bytes.length,
      textPreview: '[Binary]',
      resourceId,
      outcome: 'received',
    })
    this.record(id, a, row, 'binary', '[Binary]', 'inbound', bytes.length, resourceId)
  }
  private record(
    id: string,
    a: Active,
    row: any,
    kind: any,
    preview: string,
    direction: any,
    bytes: number,
    resourceId?: string,
  ) {
    this.options.emit({
      type: 'record',
      protocol: 'websocket',
      connectionId: id,
      sessionId: a.sessionId,
      requestId: a.requestId,
      record: {
        id: row.id,
        sequence: row.sequence,
        direction,
        recordType: 'message',
        dataKind: kind,
        timestamp: row.timestamp,
        byteLength: bytes,
        preview: preview.slice(0, 2048),
        resourceId,
        outcome: direction === 'outbound' ? 'sent' : 'received',
      },
    })
  }
  private life(id: string, a: Active, state: any, extra: any = {}) {
    this.options.emit({
      type: 'lifecycle',
      protocol: 'websocket',
      connectionId: id,
      sessionId: a.sessionId,
      requestId: a.requestId,
      state,
      timestamp: Date.now(),
      attempt: a.attempt,
      ...extra,
    })
  }
  private finish(id: string, a: Active, code: number, reason: string) {
    if (!this.active.has(id)) return
    a.state = code === 1000 || a.manual ? 'closed' : 'failed'
    this.history.finalize(a.sessionId, { status: a.state, closeCode: code, closeReason: reason.slice(0, 200) })
    this.life(id, a, a.state, { closeCode: code, reason: reason.slice(0, 200) })
    this.active.delete(id)
    this.byRequest.delete(a.requestId)
    if (a.state === 'failed') a.openedReject(fail('websocket_connection_failed', 'WebSocket connection failed.'))
    a.closedResolve()
  }
}
