import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase } from './database'

describe('database', () => {
  const open: ReturnType<typeof createDatabase>[] = []
  afterEach(() => open.splice(0).forEach((db) => db.close()))
  it('migrates once to schema version 1', () => {
    const db = createDatabase(':memory:'); open.push(db)
    expect(db.pragma('user_version', { simple: true })).toBe(1)
    expect(db.prepare('select count(*) count from schema_migrations').get()).toEqual({ count: 1 })
  })
  it('cascades workspace data', () => {
    const db = createDatabase(':memory:'); open.push(db)
    db.prepare("insert into workspaces values ('w','Work','2026','2026')").run()
    db.prepare("insert into collections values ('c','w','Group','2026','2026')").run()
    db.prepare("delete from workspaces where id='w'").run()
    expect(db.prepare('select count(*) count from collections').get()).toEqual({ count: 0 })
  })
})
