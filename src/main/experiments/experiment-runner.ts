import type Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { HttpExecutionService } from '../http/http-execution-service'
import type { ResponseResourceRegistry } from '../response/response-resource-registry'
import type { WebSocketConnectionService } from '../websocket/websocket-connection-service'
import type { SseConnectionService } from '../sse/sse-connection-service'

const now = () => new Date().toISOString()
const digestFile = (path: string) => new Promise<string>((resolve, reject) => {
  const hash = createHash('sha256'), stream = createReadStream(path)
  stream.on('data', (chunk) => hash.update(chunk)).on('error', reject).on('end', () => resolve(hash.digest('hex')))
})

export class ExperimentRunner {
  private active = new Map<string, { protocol: 'http' | 'websocket' | 'sse'; id: string }>()
  constructor(private db: Database.Database, private http: HttpExecutionService, private resources: ResponseResourceRegistry, private assetRoot: string, private ws?: WebSocketConnectionService, private sse?: SseConnectionService) {}

  async execute(runId: string, workspaceId: string, environmentId?: string | null) {
    const row = this.db.prepare(`SELECT r.*,e.workspace_id,e.protocol,e.id experiment_id FROM experiment_runs r
      JOIN experiments e ON e.id=r.experiment_id WHERE r.id=? AND e.workspace_id=?`).get(runId, workspaceId) as any
    if (!row) throw new Error('Run not found.')
    if (row.status !== 'draft') throw new Error('Only draft Runs can be executed.')
    if (row.request_snapshot_json.includes('[REDACTED]')) throw new Error('This Run needs credentials. Use Environment variables and create a new Run.')
    const snapshot = JSON.parse(row.request_snapshot_json), variables = this.variables(workspaceId, environmentId)
    const environmentSnapshot = JSON.stringify(Object.fromEntries(variables.map((variable) => [variable.key, variable.isSecret ? '[REDACTED]' : variable.value])))
    const startedAt = now()
    this.db.prepare("UPDATE experiment_runs SET status='running',environment_snapshot_json=?,started_at=?,completed_at=NULL,error_json=NULL,updated_at=? WHERE id=?")
      .run(environmentSnapshot, startedAt, startedAt, runId)
    try {
      let response: any
      if (row.protocol === 'http') {
        const pending = this.http.start({ ...snapshot, savedRequestId: runId, workspaceId }, variables)
        this.active.set(runId, { protocol: 'http', id: pending.executionId })
        response = await this.captureResource((await pending.result).response, row)
      } else response = await this.executeStreaming(row.protocol, snapshot, row, variables)
      const completedAt = now()
      const status = response.status === 'stopped' ? 'cancelled' : 'completed'
      this.db.prepare('UPDATE experiment_runs SET status=?,result_snapshot_json=?,completed_at=?,duration_ms=?,updated_at=? WHERE id=?')
        .run(status, JSON.stringify(response), completedAt, response.durationMs ?? null, completedAt, runId)
      return response
    } catch (error: any) {
      const completedAt = now(), status = error?.code === 'request_cancelled' ? 'cancelled' : 'failed'
      this.db.prepare('UPDATE experiment_runs SET status=?,completed_at=?,error_json=?,updated_at=? WHERE id=?')
        .run(status, completedAt, JSON.stringify({ code: error?.code || 'experiment_run_failed', message: error instanceof Error ? error.message : 'Run failed.' }), completedAt, runId)
      throw error
    } finally { this.active.delete(runId) }
  }

  cancel(runId: string) {
    const active = this.active.get(runId)
    if (!active) return false
    if (active.protocol === 'http') return this.http.cancel(active.id)
    if (active.protocol === 'websocket') return this.ws?.disconnect(active.id) ?? false
    return this.sse?.stop(active.id) ?? false
  }

  async send(runId: string, kind: 'text' | 'json' | 'binary' | 'file', value: string) {
    const active = this.active.get(runId)
    if (!active || active.protocol !== 'websocket' || !this.ws) throw new Error('WebSocket Run is not open.')
    if (kind === 'text') return this.ws.sendText(active.id, value)
    if (kind === 'json') return this.ws.sendJson(active.id, value)
    if (kind === 'binary') return this.ws.sendBinary(active.id, value)
    return this.ws.sendFile(active.id, value)
  }

  deleteRunAssets(workspaceId: string, experimentId: string, runId: string) { return rm(join(this.assetRoot, workspaceId, experimentId, runId), { recursive: true, force: true }) }
  deleteExperimentAssets(workspaceId: string, experimentId: string) { return rm(join(this.assetRoot, workspaceId, experimentId), { recursive: true, force: true }) }
  cleanupWorkspace(workspaceId: string) { return rm(join(this.assetRoot, workspaceId), { recursive: true, force: true }) }

  private variables(workspaceId: string, requested?: string | null) {
    const selected = requested ?? (this.db.prepare('SELECT value FROM app_settings WHERE key=?').get(`selectedEnvironment:${workspaceId}`) as any)?.value
    if (!selected) return []
    if (!this.db.prepare('SELECT 1 FROM environments WHERE id=? AND workspace_id=?').get(selected, workspaceId)) throw new Error('Environment not found.')
    return (this.db.prepare('SELECT key,value,is_secret FROM environment_variables WHERE environment_id=?').all(selected) as any[])
      .map((value) => ({ key: value.key, value: value.value, isSecret: Boolean(value.is_secret) }))
  }

  private async captureResource(response: any, run: any) {
    let source: any
    if (response.resource) source = this.resources.getRecord(response.resource.id)
    else if (response.storedToFile) {
      const stored = this.db.prepare('SELECT response_file_path FROM request_history WHERE id=?').get(response.historyId) as any
      if (stored?.response_file_path) source = { path: stored.response_file_path, kind: 'binary', declaredMimeType: response.classification?.declaredMimeType ?? response.contentType ?? null,
        detectedMimeType: response.classification?.detectedMimeType ?? null, effectiveMimeType: response.classification?.effectiveMimeType ?? response.contentType ?? 'application/octet-stream',
        byteLength: response.sizeBytes, suggestedFilename: response.kind === 'json' ? 'response.json' : 'response.txt', warnings: response.classification?.warnings ?? [] }
    }
    if (!source) return response
    const id = randomUUID()
    const used = (this.db.prepare(`SELECT COALESCE(SUM(er.byte_length),0) total FROM experiment_resources er
      JOIN experiment_runs r ON r.id=er.run_id JOIN experiments e ON e.id=r.experiment_id WHERE e.workspace_id=?`).get(run.workspace_id) as any).total
    if (used + source.byteLength > 2 * 1024 * 1024 * 1024) throw new Error('Experiment storage quota exceeded.')
    const path = join(this.assetRoot, run.workspace_id, run.experiment_id, run.id, `${id}.bin`)
    await mkdir(dirname(path), { recursive: true }); await copyFile(source.path, path)
    const digest = await digestFile(path), createdAt = now()
    this.db.prepare(`INSERT INTO experiment_resources(id,run_id,source,kind,declared_mime_type,detected_mime_type,effective_mime_type,path,byte_length,suggested_filename,warnings_json,digest,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, run.id, 'response', source.kind, source.declaredMimeType, source.detectedMimeType, source.effectiveMimeType, path, source.byteLength, source.suggestedFilename, JSON.stringify(source.warnings), digest, createdAt)
    const resource = await this.resources.register({ historyId: run.id, source: 'experiment-response', kind: source.kind,
      declaredMimeType: source.declaredMimeType, detectedMimeType: source.detectedMimeType, effectiveMimeType: source.effectiveMimeType,
      byteLength: source.byteLength, suggestedFilename: source.suggestedFilename, warnings: source.warnings, path }, id, digest, false)
    return { ...response, resource, externalBodyKind: response.kind }
  }

  private async executeStreaming(protocol: 'websocket' | 'sse', snapshot: any, run: any, variables: any[]) {
    const draft = { savedRequestId: run.id, workspaceId: run.workspace_id, name: snapshot.name, url: snapshot.url, params: snapshot.params ?? [], headers: snapshot.headers ?? [], auth: snapshot.auth ?? { type: 'none' }, ...(snapshot.streamConfig ?? {}) }
    let sessionId: string
    if (protocol === 'sse') {
      if (!this.sse) throw new Error('SSE service is not available.')
      const pending = this.sse.start(draft as any, variables); sessionId = pending.sessionId
      this.active.set(run.id, { protocol, id: pending.connectionId }); await pending.result
    } else {
      if (!this.ws) throw new Error('WebSocket service is not available.')
      const pending = this.ws.start(draft as any, variables); sessionId = pending.sessionId
      this.active.set(run.id, { protocol, id: pending.connectionId }); await pending.opened; await pending.closed
    }
    return this.captureSession(sessionId!, run, protocol)
  }

  private async captureSession(sessionId: string, run: any, protocol: 'websocket' | 'sse') {
    const session = this.db.prepare('SELECT * FROM stream_sessions WHERE id=?').get(sessionId) as any
    if (!session) throw new Error('Streaming session is not available.')
    const records = this.db.prepare('SELECT * FROM stream_records WHERE session_id=? ORDER BY sequence').all(sessionId) as any[]
    const resourceIds = new Map<string, string>()
    for (const record of records) if (record.resource_id && !resourceIds.has(record.resource_id)) {
      const source = this.db.prepare('SELECT * FROM stream_resources WHERE id=? AND session_id=?').get(record.resource_id, sessionId) as any
      if (source) resourceIds.set(record.resource_id, await this.copyStreamResource(source, run))
    }
    this.db.transaction(() => {
      for (const record of records) this.db.prepare(`INSERT INTO experiment_run_records
        (id,run_id,sequence,direction,record_type,data_kind,relative_time_ms,byte_length,text_preview,json_text,event_name,event_id,retry_ms,outcome,resource_id,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(randomUUID(), run.id, record.sequence, record.direction, record.record_type, record.data_kind,
          Math.max(0, record.timestamp - Date.parse(session.started_at)), record.byte_length, record.text_preview, record.json_text,
          record.event_name, record.event_id, record.retry_ms, record.outcome, resourceIds.get(record.resource_id) ?? null, record.created_at)
    })()
    return { protocol, status: session.close_reason_redacted === 'user' ? 'stopped' : session.status, durationMs: session.duration_ms, closeCode: session.close_code,
      closeReason: session.close_reason_redacted, inboundCount: session.inbound_count, outboundCount: session.outbound_count,
      eventCount: session.event_count, inboundBytes: session.inbound_bytes, outboundBytes: session.outbound_bytes,
      reconnectCount: session.reconnect_count, recordCount: records.length }
  }

  private async copyStreamResource(source: any, run: any) {
    const used = (this.db.prepare(`SELECT COALESCE(SUM(er.byte_length),0) total FROM experiment_resources er
      JOIN experiment_runs r ON r.id=er.run_id JOIN experiments e ON e.id=r.experiment_id WHERE e.workspace_id=?`).get(run.workspace_id) as any).total
    if (used + source.byte_length > 2 * 1024 * 1024 * 1024) throw new Error('Experiment storage quota exceeded.')
    const id = randomUUID(), path = join(this.assetRoot, run.workspace_id, run.experiment_id, run.id, `${id}.bin`)
    await mkdir(dirname(path), { recursive: true }); await copyFile(source.path, path)
    const digest = await digestFile(path), warnings = JSON.parse(source.warnings_json || '[]')
    this.db.prepare(`INSERT INTO experiment_resources(id,run_id,source,kind,declared_mime_type,detected_mime_type,effective_mime_type,path,byte_length,suggested_filename,warnings_json,digest,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, run.id, 'stream-record', source.kind, null, source.mime_type, source.mime_type, path, source.byte_length, source.suggested_filename, JSON.stringify(warnings), digest, now())
    await this.resources.register({ historyId: run.id, source: 'experiment-response', kind: source.kind, declaredMimeType: null,
      detectedMimeType: source.mime_type, effectiveMimeType: source.mime_type, byteLength: source.byte_length,
      suggestedFilename: source.suggested_filename, warnings, path }, id, digest, false)
    return id
  }
}
