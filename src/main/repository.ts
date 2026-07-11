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
}
