import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase } from './database'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('database', () => {
  const open: ReturnType<typeof createDatabase>[] = []
  afterEach(() => open.splice(0).forEach((db) => db.close()))
  it('migrates once to schema version 5', () => {
    const db = createDatabase(':memory:')
    open.push(db)
    expect(db.pragma('user_version', { simple: true })).toBe(5)
    expect(db.prepare('select count(*) count from schema_migrations').get()).toEqual({ count: 5 })
  })
  it('cascades workspace data', () => {
    const db = createDatabase(':memory:')
    open.push(db)
    db.prepare("insert into workspaces values ('w','Work','2026','2026')").run()
    db.prepare("insert into collections values ('c','w','Group','2026','2026')").run()
    db.prepare("delete from workspaces where id='w'").run()
    expect(db.prepare('select count(*) count from collections').get()).toEqual({ count: 0 })
  })
  it('preserves version 1 data while adding HTTP config and history', () => {
    const db = createDatabase(':memory:')
    open.push(db)
    expect(db.prepare("select name from pragma_table_info('saved_requests') where name='params_json'").get()).toEqual({
      name: 'params_json',
    })
    expect(db.prepare("select name from sqlite_master where type='table' and name='request_history'").get()).toEqual({
      name: 'request_history',
    })
  })
  it('adds streaming sessions, records, templates and resources', () => {
    const db = createDatabase(':memory:')
    open.push(db)
    for (const name of ['stream_sessions', 'stream_records', 'stream_message_templates', 'stream_resources'])
      expect(db.prepare("select name from sqlite_master where type='table' and name=?").get(name)).toEqual({ name })
    expect(
      db.prepare("select name from pragma_table_info('saved_requests') where name='stream_config_json'").get(),
    ).toEqual({ name: 'stream_config_json' })
  })
  it('adds experiments with cascading runs, records, and resources', () => {
    const db = createDatabase(':memory:')
    open.push(db)
    for (const name of ['experiments', 'experiment_runs', 'experiment_run_records', 'experiment_resources'])
      expect(db.prepare("select name from sqlite_master where type='table' and name=?").get(name)).toEqual({ name })
    db.prepare("insert into workspaces values ('w','Work','2026','2026')").run()
    db.prepare("insert into experiments values ('e','w','Test','', 'http','2026','2026')").run()
    db.prepare("insert into experiment_runs(id,experiment_id,label,position,status,snapshot_version,request_snapshot_json,environment_snapshot_json,created_at,updated_at) values ('r','e','Run A',0,'draft',1,'{}','{}','2026','2026')").run()
    db.prepare("insert into experiment_run_records(id,run_id,sequence,direction,record_type,data_kind,relative_time_ms,byte_length,created_at) values ('record','r',0,'inbound','message','text',0,1,'2026')").run()
    db.prepare("insert into experiment_resources(id,run_id,source,kind,path,byte_length,suggested_filename,warnings_json,created_at) values ('asset','r','response','binary','managed.bin',1,'response.bin','[]','2026')").run()
    db.prepare("delete from experiments where id='e'").run()
    for (const name of ['experiment_runs', 'experiment_run_records', 'experiment_resources'])
      expect(db.prepare(`select count(*) count from ${name}`).get()).toEqual({ count: 0 })
  })
  it('upgrades an existing version 1 file without losing saved requests', () => {
    const dir = mkdtempSync(join(tmpdir(), 'request-studio-v1-')),
      file = join(dir, 'v1.db')
    let upgraded: ReturnType<typeof createDatabase> | undefined
    try {
      const old = new Database(file)
      old.exec(
        "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);CREATE TABLE workspaces(id TEXT PRIMARY KEY,name TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE saved_requests(id TEXT PRIMARY KEY,workspace_id TEXT REFERENCES workspaces(id),collection_id TEXT,name TEXT,protocol TEXT,method TEXT,url TEXT,description TEXT,created_at TEXT,updated_at TEXT);INSERT INTO schema_migrations VALUES(1,'x');INSERT INTO workspaces VALUES('w','W','x','x');INSERT INTO saved_requests VALUES('r','w',NULL,'R','http','GET','http://localhost','','x','x');PRAGMA user_version=1",
      )
      old.close()
      upgraded = createDatabase(file)
      expect(upgraded.pragma('user_version', { simple: true })).toBe(5)
      expect(
        upgraded.prepare("select name,params_json,stream_config_json from saved_requests where id='r'").get(),
      ).toEqual({ name: 'R', params_json: '[]', stream_config_json: '{}' })
      expect(upgraded.prepare("select name from sqlite_master where name='stream_sessions'").get()).toEqual({
        name: 'stream_sessions',
      })
    } finally {
      upgraded?.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
