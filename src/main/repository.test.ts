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

it('persists independent environment selections and clears stale values', () => {
  const db=createDatabase(':memory:');databases.push(db);const repo=new Repository(db)
  repo.setting('selectedEnvironment:w1','e1');repo.setting('selectedEnvironment:w2','e2')
  expect(repo.getSetting('selectedEnvironment:w1')).toBe('e1')
  expect(repo.getSetting('selectedEnvironment:w2')).toBe('e2')
  repo.clearSetting('selectedEnvironment:w1')
  expect(repo.getSetting('selectedEnvironment:w1')).toBeNull()
})

it('updates a variable while preserving its environment', () => {
  const db=createDatabase(':memory:');databases.push(db);const repo=new Repository(db)
  repo.create('workspaces',{id:'w',name:'W'});repo.create('environments',{id:'e',workspace_id:'w',name:'Local'})
  const variable=repo.create('environment_variables',{environment_id:'e',key:'TOKEN',value:'old',is_secret:0,description:''}) as {id:string}
  const updated=repo.updateVariable(variable.id,'e',{key:'API_TOKEN',value:'new',is_secret:1,description:'auth'}) as any
  expect(updated).toMatchObject({environment_id:'e',key:'API_TOKEN',value:'new',is_secret:1,description:'auth'})
})

it('renames an environment only inside its workspace', () => {
  const db=createDatabase(':memory:');databases.push(db);const repo=new Repository(db)
  repo.create('workspaces',{id:'w1',name:'One'});repo.create('workspaces',{id:'w2',name:'Two'});repo.create('environments',{id:'e',workspace_id:'w1',name:'Local'})
  expect(repo.renameEnvironment('e','w2','Wrong')).toBeUndefined()
  expect(repo.renameEnvironment('e','w1','Test')).toMatchObject({name:'Test',workspace_id:'w1'})
})
