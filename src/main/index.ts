import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { createDatabase } from './database/database'
import { Repository } from './repository'
import { z } from 'zod'
import { validate } from './ipc/validate'

let db: ReturnType<typeof createDatabase>
const tableByDomain: Record<string,string> = { workspaces:'workspaces',collections:'collections',environments:'environments',variables:'environment_variables',requests:'saved_requests' }
function registerIpc(repo: Repository) {
  const createSchemas: Record<string,z.ZodType> = {
    workspaces:z.object({name:z.string().trim().min(1).max(100)}),
    collections:z.object({workspace_id:z.string().min(1),name:z.string().trim().min(1).max(100)}),
    environments:z.object({workspace_id:z.string().min(1),name:z.string().trim().min(1).max(100)}),
    variables:z.object({environment_id:z.string().min(1),key:z.string().trim().min(1),value:z.string(),is_secret:z.union([z.boolean(),z.number()]).default(0),description:z.string().default('')}),
    requests:z.object({workspace_id:z.string().min(1),collection_id:z.string().min(1),name:z.string().trim().min(1),protocol:z.enum(['http','websocket','sse']),method:z.string().nullable(),url:z.string(),description:z.string()})
  }
  for (const [domain, table] of Object.entries(tableByDomain)) {
    ipcMain.handle(`${domain}:list`, (_e, input = {}) => ({ ok:true, data: repo.list(table, domain === 'collections'||domain === 'environments'||domain === 'requests' ? 'workspace_id' : domain === 'variables' ? 'environment_id' : '', input.workspaceId || input.environmentId) }))
    ipcMain.handle(`${domain}:create`, (_e, input) => { const checked=validate(createSchemas[domain],input);if(!checked.ok)return checked;try { return { ok:true, data:repo.create(table, checked.data as Record<string,unknown>) } } catch { return { ok:false,error:{code:'DB_WRITE_FAILED',category:'database',message:'Could not save the item.',retryable:true} } } })
    ipcMain.handle(`${domain}:rename`, (_e, input) => ({ ok:true,data:repo.update(table,input.id,{name:input.name}) }))
    ipcMain.handle(`${domain}:update`, (_e, input) => { const { id,...values }=input; return { ok:true,data:repo.update(table,id,values) } })
    ipcMain.handle(`${domain}:delete`, (_e, input) => { repo.delete(table,input.id); return { ok:true,data:null } })
  }
  ipcMain.handle('workspaces:select', (_e,input) => { repo.setting('currentWorkspaceId',input.id); return {ok:true,data:null} })
  ipcMain.handle('requests:duplicate', (_e,input) => { const source = db.prepare('SELECT workspace_id,collection_id,name,protocol,method,url,description FROM saved_requests WHERE id=?').get(input.id) as Record<string,unknown>; return {ok:true,data:repo.create('saved_requests',{...source,name:`${source.name} Copy`})} })
}
function createWindow() { return new BrowserWindow({ width: 1280,height:800,minWidth:900,minHeight:600,webPreferences:{ preload:path.join(__dirname,'../preload/index.mjs'),contextIsolation:true,nodeIntegration:false,sandbox:true } }) }
app.whenReady().then(() => { db=createDatabase(path.join(app.getPath('userData'),'request-studio.db')); registerIpc(new Repository(db)); const window=createWindow(); if (process.env.ELECTRON_RENDERER_URL) window.loadURL(process.env.ELECTRON_RENDERER_URL); else window.loadFile(path.join(__dirname,'../renderer/index.html')) })
app.on('window-all-closed',()=>{ db?.close(); if(process.platform!=='darwin') app.quit() })
