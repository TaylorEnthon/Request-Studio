import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { CurlImportSavePlan } from '../shared/curl/curl-import-save'
import type { WorkspaceExportSource, WorkspaceExportV1 } from '../shared/assets/workspace-export'
import {
  mapWorkspaceImportRequestValues,
  prepareWorkspaceImportApply,
  workspaceImportApplyFailure,
  workspaceImportApplySuccess,
  type WorkspaceImportApplyRequest,
  type WorkspaceImportApplyResult,
} from '../shared/assets/workspace-import-apply'
import {
  createWorkspaceImportDryRun,
  parseWorkspaceImportSource,
  type WorkspaceImportMode,
  type WorkspaceImportTargetSnapshot,
} from '../shared/assets/workspace-import'

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
  getSavedRequestForExport(id: string, workspaceId: string) {
    return this.db.prepare('SELECT * FROM saved_requests WHERE id=? AND workspace_id=?').get(id, workspaceId)
  }
  importCurl(plan: CurlImportSavePlan) {
    if (!this.db.prepare('SELECT 1 FROM collections WHERE id=? AND workspace_id=?').get(plan.collectionId,plan.workspaceId)) throw new Error('Collection not found in workspace.')
    if (plan.variables.some(value=>!this.db.prepare('SELECT 1 FROM environments WHERE id=? AND workspace_id=?').get(value.environmentId,plan.workspaceId))) throw new Error('Environment not found in workspace.')
    try {
      return this.db.transaction(()=>{
        const variables=plan.variables.map(value=>this.create('environment_variables',{environment_id:value.environmentId,key:value.key,value:'',is_secret:1,description:value.description}))
        const request=this.create('saved_requests',{workspace_id:plan.workspaceId,collection_id:plan.collectionId,name:plan.name,protocol:'http',method:plan.request.method,url:plan.request.url,description:plan.description,params_json:JSON.stringify(plan.request.params),headers_json:JSON.stringify(plan.request.headers),auth_json:JSON.stringify(plan.request.auth),body_json:JSON.stringify(plan.request.body),settings_json:JSON.stringify(plan.request.settings),stream_config_json:'{}'})
        return {request,variables}
      })()
    } catch { throw new Error('cURL import could not be saved.') }
  }
  getWorkspaceExportSource(workspaceId: string): WorkspaceExportSource | undefined {
    const workspace=this.db.prepare('SELECT id,name FROM workspaces WHERE id=?').get(workspaceId) as WorkspaceExportSource['workspace']|undefined
    if(!workspace)return undefined
    return {
      workspace,
      collections:this.db.prepare('SELECT id,workspace_id,name FROM collections WHERE workspace_id=? ORDER BY name,id').all(workspaceId) as WorkspaceExportSource['collections'],
      requests:this.db.prepare(`SELECT id,workspace_id,collection_id,name,description,protocol,method,url,params_json,headers_json,auth_json,body_json,settings_json,stream_config_json
        FROM saved_requests WHERE workspace_id=? ORDER BY name,id`).all(workspaceId) as WorkspaceExportSource['requests'],
      environments:this.db.prepare('SELECT id,workspace_id,name FROM environments WHERE workspace_id=? ORDER BY name,id').all(workspaceId) as WorkspaceExportSource['environments'],
      variables:this.db.prepare(`SELECT v.id,v.environment_id,v.key,v.value,v.is_secret,v.description FROM environment_variables v
        JOIN environments e ON e.id=v.environment_id WHERE e.workspace_id=? ORDER BY v.key,v.id`).all(workspaceId) as WorkspaceExportSource['variables'],
    }
  }
  private analyzeWorkspaceImport(bundle: WorkspaceExportV1, mode: WorkspaceImportMode, targetWorkspaceId?: string) {
    if(mode==='create-workspace'){
      const existingWorkspaceNames=(this.db.prepare('SELECT name FROM workspaces ORDER BY name,id').all() as {name:string}[]).map(({name})=>name)
      return createWorkspaceImportDryRun(bundle,{mode,existingWorkspaceNames})
    }
    if(!targetWorkspaceId)return createWorkspaceImportDryRun(bundle,{mode,target:null})
    const workspace=this.db.prepare('SELECT name FROM workspaces WHERE id=?').get(targetWorkspaceId) as {name:string}|undefined
    if(!workspace)return createWorkspaceImportDryRun(bundle,{mode,target:null})
    const collections=this.db.prepare('SELECT id,name FROM collections WHERE workspace_id=? ORDER BY name,id').all(targetWorkspaceId) as {id:string;name:string}[]
    const environments=this.db.prepare('SELECT id,name FROM environments WHERE workspace_id=? ORDER BY name,id').all(targetWorkspaceId) as {id:string;name:string}[]
    const requests=this.db.prepare('SELECT collection_id,name FROM saved_requests WHERE workspace_id=? ORDER BY name,id').all(targetWorkspaceId) as {collection_id:string;name:string}[]
    const variables=this.db.prepare(`SELECT v.environment_id,v.key FROM environment_variables v JOIN environments e ON e.id=v.environment_id
      WHERE e.workspace_id=? ORDER BY v.key,v.id`).all(targetWorkspaceId) as {environment_id:string;key:string}[]
    const target:WorkspaceImportTargetSnapshot={
      workspaceName:workspace.name,
      collections:collections.map(({id,name})=>({name,requests:requests.filter((request)=>request.collection_id===id).map((request)=>request.name)})),
      environments:environments.map(({id,name})=>({name,variables:variables.filter((variable)=>variable.environment_id===id).map((variable)=>variable.key)})),
    }
    return createWorkspaceImportDryRun(bundle,{mode,target})
  }
  previewWorkspaceImport(source: unknown, mode: WorkspaceImportMode, targetWorkspaceId?: string) {
    const parsed=parseWorkspaceImportSource(source)
    if(!parsed.ok)return parsed
    const dryRun=this.analyzeWorkspaceImport(parsed.bundle,mode,targetWorkspaceId)
    if(!dryRun.ok)return dryRun
    const safe=prepareWorkspaceImportApply(parsed.bundle,dryRun.dryRun)
    return safe.ok?dryRun:safe
  }
  applyWorkspaceImport(input: WorkspaceImportApplyRequest | unknown): WorkspaceImportApplyResult {
    try {
      return this.db.transaction((): WorkspaceImportApplyResult => {
        if(!input||typeof input!=='object'||Array.isArray(input))return workspaceImportApplyFailure('INVALID_PLAN')
        const request=input as WorkspaceImportApplyRequest
        const parsed=parseWorkspaceImportSource(request.source)
        if(!parsed.ok)return parsed
        if(request.mode!=='create-workspace'&&request.mode!=='merge-into-workspace')return workspaceImportApplyFailure('INVALID_PLAN')
        if(request.resolutions!==undefined&&!Array.isArray(request.resolutions))return workspaceImportApplyFailure('INVALID_PLAN')

        let targetWorkspaceId:string|undefined
        if(request.mode==='merge-into-workspace'){
          targetWorkspaceId=request.targetWorkspaceId
          if(typeof targetWorkspaceId!=='string'||!targetWorkspaceId)return workspaceImportApplyFailure('INVALID_PLAN')
        }

        const dryRun=this.analyzeWorkspaceImport(parsed.bundle,request.mode,targetWorkspaceId)
        if(!dryRun.ok)return dryRun
        const prepared=prepareWorkspaceImportApply(parsed.bundle,dryRun.dryRun,request.resolutions)
        if(!prepared.ok)return prepared
        const finalDryRun=this.analyzeWorkspaceImport(prepared.bundle,request.mode,targetWorkspaceId)
        if(!finalDryRun.ok)return finalDryRun
        if(finalDryRun.dryRun.conflicts.length||finalDryRun.dryRun.operations.some(({status})=>status==='blocked'))return workspaceImportApplyFailure('IMPORT_CONFLICT')

        const workspaceIds=new Map<string,string>()
        const collectionIds=new Map<string,string>()
        const environmentIds=new Map<string,string>()
        if(targetWorkspaceId)workspaceIds.set('workspace',targetWorkspaceId)
        for(const operation of finalDryRun.dryRun.operations){
          if(operation.kind==='create-workspace'){
            const row=this.create('workspaces',{name:prepared.bundle.workspace.name}) as {id:string}
            workspaceIds.set(operation.sourceRef,row.id)
          }else if(operation.kind==='create-collection'){
            const collection=prepared.bundle.collections.find(({ref})=>ref===operation.sourceRef)
            const workspaceId=workspaceIds.get(operation.parentSourceRef!)
            if(!collection||!workspaceId)throw new Error('Invalid apply plan')
            const row=this.create('collections',{workspace_id:workspaceId,name:collection.name}) as {id:string}
            collectionIds.set(operation.sourceRef,row.id)
          }else if(operation.kind==='create-environment'){
            const match=/^environment-(\d+)$/.exec(operation.sourceRef),environment=match&&prepared.bundle.environments[Number(match[1])-1]
            const workspaceId=workspaceIds.get(operation.parentSourceRef!)
            if(!environment||!workspaceId)throw new Error('Invalid apply plan')
            const row=this.create('environments',{workspace_id:workspaceId,name:environment.name}) as {id:string}
            environmentIds.set(operation.sourceRef,row.id)
          }else if(operation.kind==='create-variable'){
            const match=/^environment-(\d+)-variable-(\d+)$/.exec(operation.sourceRef)
            const variable=match&&prepared.bundle.environments[Number(match[1])-1]?.variables[Number(match[2])-1]
            const environmentId=environmentIds.get(operation.parentSourceRef!)
            if(!variable||!environmentId)throw new Error('Invalid apply plan')
            this.create('environment_variables',{environment_id:environmentId,key:variable.key,value:variable.isSecret?'':variable.value,is_secret:variable.isSecret?1:0,description:variable.description})
          }else if(operation.kind==='create-request'){
            const match=/^request-(\d+)$/.exec(operation.sourceRef),request=match&&prepared.bundle.requests[Number(match[1])-1]
            const workspaceId=workspaceIds.get('workspace'),collectionId=collectionIds.get(operation.parentSourceRef!)
            if(!request||!workspaceId||!collectionId)throw new Error('Invalid apply plan')
            this.create('saved_requests',{workspace_id:workspaceId,collection_id:collectionId,...mapWorkspaceImportRequestValues(request.asset)})
          }else throw new Error('Invalid apply plan')
        }
        return workspaceImportApplySuccess(request.mode,prepared.bundle)
      })()
    }catch{return workspaceImportApplyFailure('TRANSACTION_FAILED')}
  }
  deleteWorkspace(id: string) {
    this.db.transaction(()=>{this.clearSetting(`selectedEnvironment:${id}`);this.db.prepare('DELETE FROM workspaces WHERE id=?').run(id)})()
  }
}
