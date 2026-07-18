import { afterEach, expect, it } from 'vitest'
import { mapCurlImportSave } from '../shared/curl/curl-import-save'
import { previewCurlImport } from '../shared/curl/curl-import-preview'
import { createDatabase } from './database/database'
import { Repository } from './repository'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(() => databases.splice(0).forEach((db) => db.close()))

const setupCurlImport = () => {
  const db=createDatabase(':memory:');databases.push(db);const repo=new Repository(db)
  repo.create('workspaces',{id:'w',name:'Workspace'});repo.create('workspaces',{id:'other',name:'Other'})
  repo.create('collections',{id:'c',workspace_id:'w',name:'API'});repo.create('collections',{id:'other-c',workspace_id:'other',name:'Other API'})
  repo.create('environments',{id:'e',workspace_id:'w',name:'Local'});repo.create('environments',{id:'other-e',workspace_id:'other',name:'Other Local'})
  const result=previewCurlImport('curl -H "Authorization: Bearer credential-fixture" https://example.com')
  if(!result.ok)throw new Error('Expected preview')
  const plan=mapCurlImportSave({preview:result.preview,workspaceId:'w',collectionId:'c',environmentId:'e',name:'Imported',variableMappings:[{placeholder:'{{TOKEN}}',variableName:'SERVICE_TOKEN'}]})
  return {db,repo,plan}
}

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

it('deletes workspace data and its selected environment setting together', () => {
  const db=createDatabase(':memory:');databases.push(db);const repo=new Repository(db)
  repo.create('workspaces',{id:'w',name:'One'});repo.create('environments',{id:'e',workspace_id:'w',name:'Local'});repo.selectEnvironment('w','e')
  repo.deleteWorkspace('w')
  expect(repo.list('workspaces')).toHaveLength(0)
  expect(repo.getSetting('selectedEnvironment:w')).toBeNull()
})

it('imports a cURL plan atomically through scoped repositories', () => {
  const {db,repo,plan}=setupCurlImport()
  const result=repo.importCurl(plan) as any
  expect(result.request).toMatchObject({workspace_id:'w',collection_id:'c',name:'Imported',protocol:'http'})
  expect(JSON.parse(result.request.auth_json)).toEqual({type:'bearer',token:'{{SERVICE_TOKEN}}'})
  expect(result.variables).toEqual([expect.objectContaining({environment_id:'e',key:'SERVICE_TOKEN',value:'',is_secret:1})])
  expect(JSON.stringify(db.prepare('SELECT * FROM saved_requests').all())).not.toContain('credential-fixture')
  expect(JSON.stringify(db.prepare('SELECT * FROM environment_variables').all())).not.toContain('credential-fixture')
})

it('rejects cross-workspace collection and Environment ownership', () => {
  const {repo,plan}=setupCurlImport()
  expect(()=>repo.importCurl({...plan,collectionId:'other-c'})).toThrow('Collection not found in workspace.')
  expect(()=>repo.importCurl({...plan,variables:plan.variables.map(value=>({...value,environmentId:'other-e'}))})).toThrow('Environment not found in workspace.')
})

it('leaves no Saved Request when variable creation fails', () => {
  const {db,repo,plan}=setupCurlImport()
  repo.create('environment_variables',{environment_id:'e',key:'SERVICE_TOKEN',value:'',is_secret:1,description:''})
  expect(()=>repo.importCurl(plan)).toThrow('cURL import could not be saved.')
  expect(db.prepare('SELECT * FROM saved_requests').all()).toHaveLength(0)
})

it('rolls back variables when Saved Request creation fails', () => {
  const {db,repo,plan}=setupCurlImport()
  db.exec("CREATE TRIGGER reject_curl_import BEFORE INSERT ON saved_requests BEGIN SELECT RAISE(ABORT, 'rejected'); END")
  expect(()=>repo.importCurl(plan)).toThrow('cURL import could not be saved.')
  expect(db.prepare('SELECT * FROM environment_variables').all()).toHaveLength(0)
})

it('reads only the five allowed workspace export source groups', () => {
  const db=createDatabase(':memory:');databases.push(db);const repo=new Repository(db)
  repo.create('workspaces',{id:'w',name:'Workspace'})
  repo.create('collections',{id:'c',workspace_id:'w',name:'API'})
  repo.create('environments',{id:'e',workspace_id:'w',name:'Local'})
  repo.create('environment_variables',{id:'v',environment_id:'e',key:'TOKEN',value:'raw-secret',is_secret:1,description:''})
  repo.create('saved_requests',{id:'r',workspace_id:'w',collection_id:'c',name:'Users',protocol:'http',method:'GET',url:'https://example.test',description:''})
  db.prepare("INSERT INTO request_history(id,workspace_id,saved_request_id,request_name,method,url_template,resolved_url_redacted,started_at,request_snapshot_json,created_at) VALUES('history-id','w','r','Users','GET','','','x','{}','x')").run()
  db.prepare("INSERT INTO response_resources(id,history_id,source,kind,path,byte_length,suggested_filename,created_at) VALUES('resource-id','history-id','managed-response-file','binary','C:\\private.bin',1,'private.bin','x')").run()
  db.prepare("INSERT INTO experiments(id,workspace_id,name,description,protocol,created_at,updated_at) VALUES('experiment-id','w','Experiment','','http','x','x')").run()

  const result=repo.getWorkspaceExportSource('w')
  expect(result).toMatchObject({
    workspace:{id:'w',name:'Workspace'},
    collections:[{id:'c',workspace_id:'w',name:'API'}],
    environments:[{id:'e',workspace_id:'w',name:'Local'}],
    variables:[{id:'v',environment_id:'e',key:'TOKEN'}],
    requests:[{id:'r',workspace_id:'w',collection_id:'c',name:'Users'}],
  })
  expect(Object.keys(result!)).toEqual(['workspace','collections','requests','environments','variables'])
  expect(JSON.stringify(result)).not.toMatch(/history-id|resource-id|experiment-id|private\.bin|created_at|updated_at/)
  expect(repo.getWorkspaceExportSource('missing')).toBeUndefined()
})
