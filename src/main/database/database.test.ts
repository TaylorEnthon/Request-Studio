import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase } from './database'
import Database from 'better-sqlite3'
import { mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('database', () => {
  const open: ReturnType<typeof createDatabase>[] = []
  afterEach(() => open.splice(0).forEach((db) => db.close()))
  it('migrates once to schema version 1', () => {
    const db = createDatabase(':memory:'); open.push(db)
    expect(db.pragma('user_version', { simple: true })).toBe(2)
    expect(db.prepare('select count(*) count from schema_migrations').get()).toEqual({ count: 2 })
  })
  it('cascades workspace data', () => {
    const db = createDatabase(':memory:'); open.push(db)
    db.prepare("insert into workspaces values ('w','Work','2026','2026')").run()
    db.prepare("insert into collections values ('c','w','Group','2026','2026')").run()
    db.prepare("delete from workspaces where id='w'").run()
    expect(db.prepare('select count(*) count from collections').get()).toEqual({ count: 0 })
  })
  it('preserves version 1 data while adding HTTP config and history',()=>{
    const db=createDatabase(':memory:');open.push(db)
    expect(db.prepare("select name from pragma_table_info('saved_requests') where name='params_json'").get()).toEqual({name:'params_json'})
    expect(db.prepare("select name from sqlite_master where type='table' and name='request_history'").get()).toEqual({name:'request_history'})
  })
  it('upgrades an existing version 1 file without losing saved requests',()=>{const dir=mkdtempSync(join(tmpdir(),'request-studio-v1-')),file=join(dir,'v1.db');try{const old=new Database(file);old.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);CREATE TABLE workspaces(id TEXT PRIMARY KEY,name TEXT,created_at TEXT,updated_at TEXT);CREATE TABLE saved_requests(id TEXT PRIMARY KEY,workspace_id TEXT REFERENCES workspaces(id),collection_id TEXT,name TEXT,protocol TEXT,method TEXT,url TEXT,description TEXT,created_at TEXT,updated_at TEXT);INSERT INTO schema_migrations VALUES(1,'x');INSERT INTO workspaces VALUES('w','W','x','x');INSERT INTO saved_requests VALUES('r','w',NULL,'R','http','GET','http://localhost','','x','x');PRAGMA user_version=1");old.close();const upgraded=createDatabase(file);expect(upgraded.pragma('user_version',{simple:true})).toBe(2);expect(upgraded.prepare("select name,params_json from saved_requests where id='r'").get()).toEqual({name:'R',params_json:'[]'});upgraded.close()}finally{rmSync(dir,{recursive:true,force:true})}})
})
