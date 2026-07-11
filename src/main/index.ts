import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { createDatabase } from './database/database'
import { Repository } from './repository'
import { z } from 'zod'
import { validate } from './ipc/validate'
import { environmentRenameSchema, variableUpdateSchema } from '../shared/schemas/entities'
import { registerHttpHandlers } from './ipc/http-handlers'
import { savedRequestHttpUpdateSchema } from '../shared/schemas/http'

let db: ReturnType<typeof createDatabase>,httpService:ReturnType<typeof registerHttpHandlers>
const tableByDomain: Record<string,string> = { workspaces:'workspaces',collections:'collections',environments:'environments',variables:'environment_variables',requests:'saved_requests' }
function registerIpc(repo: Repository) {
  const invalid={ok:false,error:{code:'INVALID_INPUT',category:'validation',message:'Please check the highlighted input.',retryable:false}}
  const parse=(schema:z.ZodType,input:unknown)=>{const result=schema.safeParse(input);return result.success?result.data:null}
  const createSchemas: Record<string,z.ZodType> = {
    workspaces:z.object({name:z.string().trim().min(1).max(100)}),
    collections:z.object({workspace_id:z.string().min(1),name:z.string().trim().min(1).max(100)}),
    environments:z.object({workspace_id:z.string().min(1),name:z.string().trim().min(1).max(100)}),
    variables:z.object({environment_id:z.string().min(1),key:z.string().trim().min(1),value:z.string(),is_secret:z.union([z.boolean(),z.number()]).default(0),description:z.string().default('')}),
    requests:z.object({workspace_id:z.string().min(1),collection_id:z.string().min(1),name:z.string().trim().min(1),protocol:z.enum(['http','websocket','sse']),method:z.string().nullable(),url:z.string(),description:z.string()})
  }
  for (const [domain, table] of Object.entries(tableByDomain)) {
    ipcMain.handle(`${domain}:list`, (_e, input = {}) => {const needsWorkspace=domain==='collections'||domain==='environments'||domain==='requests',needsEnvironment=domain==='variables';const checked=parse(needsWorkspace?z.object({workspaceId:z.string().min(1)}):needsEnvironment?z.object({environmentId:z.string().min(1)}):z.object({}),input) as any;if(!checked)return invalid;return { ok:true, data: repo.list(table,needsWorkspace?'workspace_id':needsEnvironment?'environment_id':'',checked.workspaceId||checked.environmentId) }})
    ipcMain.handle(`${domain}:create`, (_e, input) => { const checked=validate(createSchemas[domain],input);if(!checked.ok)return checked;try { return { ok:true, data:repo.create(table, checked.data as Record<string,unknown>) } } catch { return { ok:false,error:{code:'DB_WRITE_FAILED',category:'database',message:'Could not save the item.',retryable:true} } } })
    ipcMain.handle(`${domain}:rename`, (_e, input) => {if(domain==='environments'){const checked=parse(environmentRenameSchema,input) as any;if(!checked)return invalid;const data=repo.renameEnvironment(checked.id,checked.workspaceId,checked.name);return data?{ok:true,data}:{ok:false,error:{code:'NOT_FOUND',category:'database',message:'Environment not found.',retryable:false}}}const checked=parse(z.object({id:z.string().min(1),name:z.string().trim().min(1).max(100)}),input) as any;return checked?{ok:true,data:repo.update(table,checked.id,{name:checked.name})}:invalid})
    ipcMain.handle(`${domain}:update`, (_e, input) => {if(domain==='variables'){const checked=parse(variableUpdateSchema,input) as any;if(!checked)return invalid;try{const data=repo.updateVariable(checked.id,checked.environmentId,{key:checked.key,value:checked.value,is_secret:checked.isSecret?1:0,description:checked.description});return data?{ok:true,data}:{ok:false,error:{code:'NOT_FOUND',category:'database',message:'Variable not found.',retryable:false}}}catch{return {ok:false,error:{code:'DUPLICATE_KEY',category:'database',message:'This variable key already exists.',retryable:false}}}}if(domain==='requests'){const checked=parse(savedRequestHttpUpdateSchema,input) as any;if(!checked)return invalid;return {ok:true,data:repo.update(table,checked.id,{name:checked.name,method:checked.method,url:checked.url,params_json:JSON.stringify(checked.params),headers_json:JSON.stringify(checked.headers),auth_json:JSON.stringify(checked.auth),body_json:JSON.stringify(checked.body),settings_json:JSON.stringify(checked.settings)})}}const checked=parse(z.object({id:z.string().min(1)}).passthrough(),input) as any;if(!checked)return invalid;const { id,...values }=checked; return { ok:true,data:repo.update(table,id,values) } })
    ipcMain.handle(`${domain}:delete`, (_e, input) => { const checked=parse(z.object({id:z.string().min(1)}),input) as any;if(!checked)return invalid;if(domain==='workspaces')repo.deleteWorkspace(checked.id);else repo.delete(table,checked.id); return { ok:true,data:null } })
  }
  ipcMain.handle('workspaces:select', (_e,input) => { const checked=parse(z.object({id:z.string().min(1)}),input) as any;if(!checked)return invalid;repo.setting('currentWorkspaceId',checked.id); return {ok:true,data:null} })
  ipcMain.handle('requests:duplicate', (_e,input) => { const checked=parse(z.object({id:z.string().min(1)}),input) as any;if(!checked)return invalid;const source = db.prepare('SELECT workspace_id,collection_id,name,protocol,method,url,description,params_json,headers_json,auth_json,body_json,settings_json FROM saved_requests WHERE id=?').get(checked.id) as Record<string,unknown>; return {ok:true,data:repo.create('saved_requests',{...source,name:`${source.name} Copy`})} })
  ipcMain.handle('environments:selected:get', (_e,input) => {const checked=parse(z.object({workspaceId:z.string().min(1)}),input) as any;return checked?{ok:true,data:repo.resolveSelectedEnvironment(checked.workspaceId)}:invalid})
  ipcMain.handle('environments:selected:set', (_e,input) => {const checked=parse(z.object({workspaceId:z.string().min(1),environmentId:z.string().min(1).nullable()}),input) as any;return checked?{ok:true,data:repo.selectEnvironment(checked.workspaceId,checked.environmentId)}:invalid})
}
function createWindow() { return new BrowserWindow({ width: 1280,height:800,minWidth:900,minHeight:600,webPreferences:{ preload:path.join(__dirname,'../preload/index.mjs'),contextIsolation:true,nodeIntegration:false,sandbox:true } }) }
app.whenReady().then(() => { const userData=app.getPath('userData');db=createDatabase(path.join(userData,'request-studio.db')); registerIpc(new Repository(db));httpService=registerHttpHandlers(db,path.join(userData,'responses')); const window=createWindow(); const loaded=process.env.ELECTRON_RENDERER_URL?window.loadURL(process.env.ELECTRON_RENDERER_URL):window.loadFile(path.join(__dirname,'../renderer/index.html'));if(process.env.REQUEST_STUDIO_SMOKE==='1')void loaded.then(()=>app.quit()) }).catch((error)=>{console.error('Request Studio failed to start:',error instanceof Error?error.message:'Unknown error');app.exit(1)})
app.on('before-quit',()=>httpService?.cancelAll())
app.on('window-all-closed',()=>{ db?.close(); if(process.platform!=='darwin') app.quit() })
