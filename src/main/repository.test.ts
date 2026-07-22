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

const workspaceImportBundle = () => ({
  format: 'request-studio.workspace', version: 1,
  workspace: { name: 'Imported Workspace' },
  collections: [{ ref: 'collection-1', name: 'API' }],
  requests: [{
    collectionRef: 'collection-1',
    asset: {
      format: 'request-studio.request', version: 1, protocol: 'http', name: 'Users', description: '',
      request: { method: 'GET', url: 'https://api.example.test/users', params: [], headers: [], auth: { type: 'none' }, body: { type: 'none' }, settings: { timeoutMs: 30000 } },
    },
  }],
  environments: [{ name: 'Local', variables: [{ key: 'TOKEN', value: '', isSecret: true, description: '' }] }],
})

const setupWorkspaceImport = () => {
  const db=createDatabase(':memory:');databases.push(db);const repo=new Repository(db)
  return {db,repo,source:JSON.stringify(workspaceImportBundle())}
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

it('applies a clean Workspace bundle atomically with private sourceRef mappings', () => {
  const {db,repo,source}=setupWorkspaceImport()
  const first=repo.applyWorkspaceImport({source,mode:'create-workspace'})
  expect(first).toEqual({ok:true,apply:{format:'request-studio.workspace-import-apply',version:1,mode:'create-workspace',summary:{collectionCount:1,requestCount:1,environmentCount:1,variableCount:1}}})
  expect(db.prepare('SELECT name FROM workspaces').all()).toEqual([{name:'Imported Workspace'}])
  expect(db.prepare('SELECT c.name collection_name,r.name request_name FROM saved_requests r JOIN collections c ON c.id=r.collection_id').all()).toEqual([{collection_name:'API',request_name:'Users'}])
  expect(db.prepare('SELECT e.name environment_name,v.key,v.value,v.is_secret FROM environment_variables v JOIN environments e ON e.id=v.environment_id').all()).toEqual([{environment_name:'Local',key:'TOKEN',value:'',is_secret:1}])
  expect(JSON.stringify(first)).not.toMatch(/workspace_id|collection_id|environment_id|fixture-secret-value/)
})

it('merges only after an explicit supported rename and leaves existing rows unchanged', () => {
  const {db,repo,source}=setupWorkspaceImport()
  repo.create('workspaces',{id:'target',name:'Target'})
  repo.create('collections',{id:'existing-c',workspace_id:'target',name:'API'})
  repo.create('environments',{id:'existing-e',workspace_id:'target',name:'Local'})
  const result=repo.applyWorkspaceImport({source,mode:'merge-into-workspace',targetWorkspaceId:'target',resolutions:[
    {sourceRef:'collection-1',strategy:'rename',name:'Imported API'},
    {sourceRef:'environment-1',strategy:'rename',name:'Imported Local'},
  ]})
  expect(result).toMatchObject({ok:true,apply:{mode:'merge-into-workspace'}})
  expect(db.prepare('SELECT name FROM collections ORDER BY name').all()).toEqual([{name:'API'},{name:'Imported API'}])
  expect(db.prepare('SELECT name FROM environments ORDER BY name').all()).toEqual([{name:'Imported Local'},{name:'Local'}])
})

it('rejects unresolved, blocked, unsupported, and multiple conflicts before writing', () => {
  const {db,repo,source}=setupWorkspaceImport()
  repo.create('workspaces',{id:'target',name:'Target'})
  repo.create('collections',{id:'existing-c',workspace_id:'target',name:'API'})
  repo.create('environments',{id:'existing-e',workspace_id:'target',name:'Local'})
  expect(repo.applyWorkspaceImport({source,mode:'merge-into-workspace',targetWorkspaceId:'target'})).toMatchObject({ok:false,error:{code:'IMPORT_CONFLICT'}})
  expect(repo.applyWorkspaceImport({source,mode:'merge-into-workspace',targetWorkspaceId:'target',resolutions:[{sourceRef:'collection-1',strategy:'merge'}]})).toMatchObject({ok:false,error:{code:'UNSUPPORTED_STRATEGY'}})
  expect(db.prepare("SELECT count(*) count FROM collections WHERE name='Imported API'").get()).toEqual({count:0})
})

it.each([
  ['workspace', "CREATE TRIGGER reject_workspace BEFORE INSERT ON workspaces BEGIN SELECT RAISE(ABORT, 'fixture-secret-value'); END"],
  ['request', "CREATE TRIGGER reject_request BEFORE INSERT ON saved_requests BEGIN SELECT RAISE(ABORT, 'fixture-secret-value'); END"],
  ['variable', "CREATE TRIGGER reject_variable BEFORE INSERT ON environment_variables BEGIN SELECT RAISE(ABORT, 'fixture-secret-value'); END"],
])('rolls back every imported row when %s creation fails', (_label, trigger) => {
  const {db,repo,source}=setupWorkspaceImport();db.exec(trigger)
  const result=repo.applyWorkspaceImport({source,mode:'create-workspace'})
  expect(result).toEqual({ok:false,error:{code:'TRANSACTION_FAILED',message:'Workspace import transaction failed.'}})
  expect(db.prepare('SELECT count(*) count FROM workspaces').get()).toEqual({count:0})
  expect(db.prepare('SELECT count(*) count FROM collections').get()).toEqual({count:0})
  expect(db.prepare('SELECT count(*) count FROM saved_requests').get()).toEqual({count:0})
  expect(db.prepare('SELECT count(*) count FROM environments').get()).toEqual({count:0})
  expect(db.prepare('SELECT count(*) count FROM environment_variables').get()).toEqual({count:0})
  expect(JSON.stringify(result)).not.toMatch(/fixture-secret-value|CREATE TRIGGER|saved_requests/)
})

it('rejects unsafe paths and invalid target Workspaces without writing or leaking input', () => {
  const {db,repo}=setupWorkspaceImport(), unsafe=workspaceImportBundle()
  unsafe.workspace.name='C:\\Users\\Example\\secret.txt'
  const path=repo.applyWorkspaceImport({source:JSON.stringify(unsafe),mode:'create-workspace'})
  expect(path).toMatchObject({ok:false,error:{code:'UNSAFE_IMPORT_CONTENT'}})
  expect(JSON.stringify(path)).not.toMatch(/Users|secret\.txt|file:\/\/\//)
  expect(repo.applyWorkspaceImport({source:JSON.stringify(workspaceImportBundle()),mode:'merge-into-workspace',targetWorkspaceId:'missing'})).toMatchObject({ok:false,error:{code:'TARGET_WORKSPACE_NOT_FOUND'}})
  expect(db.prepare('SELECT count(*) count FROM workspaces').get()).toEqual({count:0})
})

it('rejects malformed apply contracts with a fixed error', () => {
  const {repo,source}=setupWorkspaceImport()
  expect(repo.applyWorkspaceImport(null)).toMatchObject({ok:false,error:{code:'INVALID_PLAN'}})
  expect(repo.applyWorkspaceImport({source,mode:'merge-into-workspace',targetWorkspaceId:''})).toMatchObject({ok:false,error:{code:'INVALID_PLAN'}})
  expect(repo.applyWorkspaceImport({source,mode:'create-workspace',resolutions:'rename'})).toMatchObject({ok:false,error:{code:'INVALID_PLAN'}})
})
