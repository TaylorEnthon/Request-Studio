import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

const now = () => new Date().toISOString()
const secretKey = /authorization|cookie|token|password|api.?key|secret/i
const variableOnly = /^(?:\s*\{\{[A-Za-z_][A-Za-z0-9_.-]*\}\}\s*)+$/
const redact = (value: unknown, key = ''): unknown => {
  if (secretKey.test(key)) return typeof value === 'string' && variableOnly.test(value) ? value : '[REDACTED]'
  if (Array.isArray(value)) return value.map((item) => redact(item))
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redact(child, childKey)]))
  return value
}
const parse = (value: unknown, fallback: unknown) => {
  try { return JSON.parse(String(value)) } catch { return fallback }
}
const redactEntries = (entries: unknown) => Array.isArray(entries)
  ? entries.map((entry) => entry && typeof entry === 'object' && 'key' in entry && secretKey.test(String(entry.key))
    ? { ...entry, value: redact((entry as any).value, String(entry.key)) }
    : redact(entry))
  : []
const sanitizeSnapshot = (snapshot: any) => ({ ...(redact(snapshot) as Record<string, unknown>), params: redactEntries(snapshot?.params), headers: redactEntries(snapshot?.headers) })
const label = (position: number) => `Run ${position < 26 ? String.fromCharCode(65 + position) : position + 1}`

type CreateInput = { workspaceId: string; savedRequestId: string; name: string; description?: string }
type RunRow = { id: string; request_snapshot_json: string; environment_snapshot_json: string }

export class ExperimentRepository {
  constructor(private db: Database.Database) {}

  list(workspaceId: string, limit = 25, offset = 0) {
    return this.db.prepare(`SELECT e.*,(SELECT COUNT(*) FROM experiment_runs r WHERE r.experiment_id=e.id) run_count
      FROM experiments e WHERE workspace_id=? ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(workspaceId, Math.min(100, Math.max(1, limit)), Math.max(0, offset))
  }

  get(id: string, workspaceId: string) {
    const experiment = this.db.prepare('SELECT * FROM experiments WHERE id=? AND workspace_id=?').get(id, workspaceId)
    if (!experiment) return undefined
    return { experiment, runs: this.db.prepare('SELECT * FROM experiment_runs WHERE experiment_id=? ORDER BY position').all(id) as any[] }
  }

  createFromRequest(input: CreateInput) {
    const source = this.db.prepare('SELECT * FROM saved_requests WHERE id=? AND workspace_id=?').get(input.savedRequestId, input.workspaceId) as Record<string, unknown> | undefined
    if (!source) throw new Error('Saved request not found.')
    const timestamp = now(), experimentId = randomUUID(), runId = randomUUID()
    const requestSnapshot = sanitizeSnapshot({
      version: 1, protocol: source.protocol, name: source.name, method: source.method, url: source.url,
      params: parse(source.params_json, []), headers: parse(source.headers_json, []), auth: parse(source.auth_json, { type: 'none' }),
      body: parse(source.body_json, { type: 'none' }), settings: parse(source.settings_json, { timeoutMs: 30000 }),
      streamConfig: parse(source.stream_config_json, {}),
    })
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO experiments(id,workspace_id,name,description,protocol,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
        .run(experimentId, input.workspaceId, input.name.trim(), input.description?.trim() || '', source.protocol, timestamp, timestamp)
      this.db.prepare('INSERT INTO experiment_runs(id,experiment_id,label,position,status,snapshot_version,request_snapshot_json,environment_snapshot_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(runId, experimentId, 'Run A', 0, 'draft', 1, JSON.stringify(requestSnapshot), '{}', timestamp, timestamp)
    })()
    return this.get(experimentId, input.workspaceId)!.experiment as any
  }

  createRun(experimentId: string, workspaceId: string, sourceRunId?: string) {
    const detail = this.get(experimentId, workspaceId)
    if (!detail) throw new Error('Experiment not found.')
    if (detail.runs.length >= 100) throw new Error('An Experiment can contain up to 100 Runs.')
    const source = (sourceRunId ? detail.runs.find((run) => run.id === sourceRunId) : detail.runs.at(-1)) as RunRow | undefined
    if (!source) throw new Error('Source Run not found.')
    const timestamp = now(), position = Math.max(-1, ...detail.runs.map((run) => run.position)) + 1, id = randomUUID()
    this.db.prepare('INSERT INTO experiment_runs(id,experiment_id,label,position,status,snapshot_version,request_snapshot_json,environment_snapshot_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(id, experimentId, label(position), position, 'draft', 1, source.request_snapshot_json, source.environment_snapshot_json, timestamp, timestamp)
    this.db.prepare('UPDATE experiments SET updated_at=? WHERE id=?').run(timestamp, experimentId)
    return this.db.prepare('SELECT * FROM experiment_runs WHERE id=?').get(id)
  }

  rename(id: string, workspaceId: string, name: string) {
    const timestamp = now(), result = this.db.prepare('UPDATE experiments SET name=?,updated_at=? WHERE id=? AND workspace_id=?').run(name.trim(), timestamp, id, workspaceId)
    return result.changes ? this.db.prepare('SELECT * FROM experiments WHERE id=?').get(id) : undefined
  }

  duplicate(id: string, workspaceId: string) {
    const detail = this.get(id, workspaceId)
    if (!detail) throw new Error('Experiment not found.')
    const source = detail.experiment as any, timestamp = now(), duplicateId = randomUUID()
    let name = `${source.name} Copy`, suffix = 2
    while (this.db.prepare('SELECT 1 FROM experiments WHERE workspace_id=? AND name=? COLLATE NOCASE').get(workspaceId, name)) name = `${source.name} Copy ${suffix++}`
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO experiments(id,workspace_id,name,description,protocol,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(duplicateId, workspaceId, name, source.description, source.protocol, timestamp, timestamp)
      for (const run of detail.runs) this.db.prepare('INSERT INTO experiment_runs(id,experiment_id,label,position,status,snapshot_version,request_snapshot_json,environment_snapshot_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(randomUUID(), duplicateId, run.label, run.position, 'draft', run.snapshot_version, run.request_snapshot_json, run.environment_snapshot_json, timestamp, timestamp)
    })()
    return this.db.prepare('SELECT * FROM experiments WHERE id=?').get(duplicateId)
  }

  updateDraft(runId: string, workspaceId: string, snapshotJson: string) {
    const run = this.db.prepare(`SELECT r.* FROM experiment_runs r JOIN experiments e ON e.id=r.experiment_id
      WHERE r.id=? AND e.workspace_id=?`).get(runId, workspaceId) as any
    if (!run) throw new Error('Run not found.')
    if (run.status !== 'draft') throw new Error('Only draft Runs can be edited.')
    const rawSnapshot = parse(snapshotJson, null)
    if (!rawSnapshot || typeof rawSnapshot !== 'object') throw new Error('Invalid Run snapshot.')
    const snapshot = sanitizeSnapshot(rawSnapshot)
    const timestamp = now()
    this.db.prepare('UPDATE experiment_runs SET request_snapshot_json=?,updated_at=? WHERE id=?').run(JSON.stringify(snapshot), timestamp, runId)
    this.db.prepare('UPDATE experiments SET updated_at=? WHERE id=?').run(timestamp, run.experiment_id)
    return this.db.prepare('SELECT * FROM experiment_runs WHERE id=?').get(runId)
  }

  deleteRun(runId: string, workspaceId: string) {
    const result = this.db.prepare(`DELETE FROM experiment_runs WHERE id=? AND experiment_id IN
      (SELECT id FROM experiments WHERE workspace_id=?)`).run(runId, workspaceId)
    return result.changes > 0
  }

  delete(id: string, workspaceId: string) {
    return this.db.prepare('DELETE FROM experiments WHERE id=? AND workspace_id=?').run(id, workspaceId).changes > 0
  }
}
