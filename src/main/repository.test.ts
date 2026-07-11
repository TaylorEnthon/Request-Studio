import { afterEach, expect, it } from 'vitest'
import { createDatabase } from './database/database'
import { Repository } from './repository'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(() => databases.splice(0).forEach((db) => db.close()))
it('creates, updates, lists, and deletes a workspace', () => {
  const db=createDatabase(':memory:');databases.push(db);const repo=new Repository(db)
  const created=repo.create('workspaces',{name:'One'}) as {id:string}
  expect(repo.list('workspaces')).toHaveLength(1)
  expect(repo.update('workspaces',created.id,{name:'Two'})).toMatchObject({name:'Two'})
  repo.delete('workspaces',created.id)
  expect(repo.list('workspaces')).toHaveLength(0)
})
