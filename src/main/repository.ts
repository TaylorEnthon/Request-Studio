import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'

const now = () => new Date().toISOString()
export class Repository {
  constructor(private db: Database.Database) {}
  list(table: string, where = '', value?: string) { return this.db.prepare(`SELECT * FROM ${table}${where ? ` WHERE ${where} = ?` : ''} ORDER BY created_at`).all(...(value ? [value] : [])) }
  create(table: string, values: Record<string, unknown>) { const row = { id: randomUUID(), ...values, created_at: now(), updated_at: now() }; const keys = Object.keys(row); this.db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => row[k as keyof typeof row])); return row }
  update(table: string, id: string, values: Record<string, unknown>) { const row = { ...values, updated_at: now() }; const keys = Object.keys(row); this.db.prepare(`UPDATE ${table} SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map((k) => row[k as keyof typeof row]), id); return this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) }
  delete(table: string, id: string) { this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id) }
  setting(key: string, value?: string) { if (value === undefined) return this.db.prepare('SELECT value FROM app_settings WHERE key=?').get(key); this.db.prepare('INSERT INTO app_settings VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(key,value,now()) }
  getSetting(key: string) { return (this.db.prepare('SELECT value FROM app_settings WHERE key=?').get(key) as {value:string}|undefined)?.value ?? null }
  clearSetting(key: string) { this.db.prepare('DELETE FROM app_settings WHERE key=?').run(key) }
  updateVariable(id: string, environmentId: string, values: {key:string;value:string;is_secret:number;description:string}) {
    this.db.prepare('UPDATE environment_variables SET key=?,value=?,is_secret=?,description=?,updated_at=? WHERE id=? AND environment_id=?').run(values.key,values.value,values.is_secret,values.description,now(),id,environmentId)
    return this.db.prepare('SELECT * FROM environment_variables WHERE id=? AND environment_id=?').get(id,environmentId)
  }
  renameEnvironment(id: string, workspaceId: string, name: string) {
    const result=this.db.prepare('UPDATE environments SET name=?,updated_at=? WHERE id=? AND workspace_id=?').run(name,now(),id,workspaceId)
    return result.changes ? this.db.prepare('SELECT * FROM environments WHERE id=? AND workspace_id=?').get(id,workspaceId) : undefined
  }
  selectEnvironment(workspaceId: string, environmentId: string | null) {
    const key=`selectedEnvironment:${workspaceId}`
    if (!environmentId) { this.clearSetting(key); return null }
    const exists=this.db.prepare('SELECT 1 FROM environments WHERE id=? AND workspace_id=?').get(environmentId,workspaceId)
    if (!exists) return this.resolveSelectedEnvironment(workspaceId)
    this.setting(key,environmentId); return environmentId
  }
  resolveSelectedEnvironment(workspaceId: string) {
    const key=`selectedEnvironment:${workspaceId}`,selected=this.getSetting(key)
    if (selected && this.db.prepare('SELECT 1 FROM environments WHERE id=? AND workspace_id=?').get(selected,workspaceId)) return selected
    const fallback=(this.db.prepare('SELECT id FROM environments WHERE workspace_id=? ORDER BY created_at LIMIT 1').get(workspaceId) as {id:string}|undefined)?.id ?? null
    if (fallback) this.setting(key,fallback); else this.clearSetting(key)
    return fallback
  }
  deleteWorkspace(id: string) {
    this.db.transaction(()=>{this.clearSetting(`selectedEnvironment:${id}`);this.db.prepare('DELETE FROM workspaces WHERE id=?').run(id)})()
  }
}
