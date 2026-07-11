import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { appendFile,mkdir,unlink,writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { HttpRequestDraft } from '../../shared/schemas/http'
import { buildRequest } from './request-builder'
import type { EnvironmentValue } from './variable-resolver'

type Active={controller:AbortController;manual:boolean;timer:ReturnType<typeof setTimeout>}
type FileData={bytes:Buffer;filename:string}
type ServiceOptions={maximumBytes?:number;memoryThreshold?:number;responseDir?:string;resolveFile?:(ref:string)=>Promise<FileData>}
const error=(code:string,message:string,category='network')=>Object.assign(new Error(message),{code,category,retryable:code!=='request_cancelled'})
const safeDraft=(draft:HttpRequestDraft)=>({...draft,auth:draft.auth.type==='none'?draft.auth:{...draft.auth,...('token'in draft.auth?{token:'[REDACTED]'}:{}),...('password'in draft.auth?{password:'[REDACTED]'}:{}),...('value'in draft.auth?{value:'[REDACTED]'}:{})},headers:draft.headers.map(h=>/authorization|cookie|token|api.?key/i.test(h.key)?{...h,value:'[REDACTED]'}:h)})

export class HttpExecutionService{
 private active=new Map<string,Active>();private requestExecutions=new Map<string,string>();private maximumBytes:number
 private resolveFile?:ServiceOptions['resolveFile'];private memoryThreshold:number;private responseDir?:string
 constructor(private db:Database.Database,options:ServiceOptions={}){this.maximumBytes=options.maximumBytes??50*1024*1024;this.memoryThreshold=options.memoryThreshold??10*1024*1024;this.responseDir=options.responseDir;this.resolveFile=options.resolveFile}
 get activeCount(){return this.active.size}
 start(draft:HttpRequestDraft,variables:EnvironmentValue[]){
  if(this.active.size>=20)throw error('too_many_requests','Too many active requests.')
  if(this.requestExecutions.has(draft.savedRequestId))throw error('request_already_running','This request is already running.')
  const executionId=randomUUID(),controller=new AbortController(),active:Active={controller,manual:false,timer:setTimeout(()=>controller.abort('timeout'),draft.settings.timeoutMs)}
  this.active.set(executionId,active);this.requestExecutions.set(draft.savedRequestId,executionId)
  return {executionId,result:this.run(executionId,draft,variables)}
 }
 execute(draft:HttpRequestDraft,variables:EnvironmentValue[]){return this.start(draft,variables).result}
 cancel(executionId:string){const active=this.active.get(executionId);if(!active||active.controller.signal.aborted)return false;active.manual=true;active.controller.abort('cancelled');return true}
 cancelAll(){for(const id of [...this.active.keys()])this.cancel(id)}
 private async run(executionId:string,draft:HttpRequestDraft,variables:EnvironmentValue[]){
  const active=this.active.get(executionId)!,started=Date.now(),startedAt=new Date(started).toISOString();let responseData:any,errorData:any
  try{
   const built=buildRequest(draft,variables)
   if(draft.body.type==='binary'){if(!draft.body.fileRef||!this.resolveFile)throw error('file_not_found','Select a request file.','file');const file=await this.resolveFile(draft.body.fileRef);built.body=file.bytes as unknown as BodyInit;if(draft.body.contentType)built.headers['content-type']=draft.body.contentType}
   if(draft.body.type==='multipart'){if(!this.resolveFile)throw error('file_not_found','Select request files.','file');const form=new FormData();for(const entry of draft.body.entries)if(entry.enabled){if(!entry.key.trim())throw error('invalid_body','Multipart key is required.','validation');if(entry.kind==='text')form.append(entry.key,entry.textValue||'');else{if(!entry.fileRef)throw error('file_not_found','Select a request file.','file');const file=await this.resolveFile(entry.fileRef);form.append(entry.key,new Blob([file.bytes as unknown as BlobPart]),entry.filename||file.filename)}}built.body=form;delete built.headers['content-type']}
   const response=await fetch(built.url,{method:built.method,headers:built.headers,body:built.body,signal:active.controller.signal,redirect:'follow'}),chunks:Uint8Array[]=[];let size=0,filePath:string|undefined
   if(response.body)for await(const chunk of response.body){const bytes=chunk as Uint8Array;size+=bytes.byteLength;if(size>this.maximumBytes){if(filePath)await unlink(filePath).catch(()=>undefined);throw error('response_too_large','Response exceeded the maximum size.','response')}if(!filePath&&size>this.memoryThreshold&&this.responseDir){await mkdir(this.responseDir,{recursive:true});filePath=join(this.responseDir,`${randomUUID()}.response`);await writeFile(filePath,Buffer.concat([...chunks.map(v=>Buffer.from(v)),Buffer.from(bytes)]));chunks.length=0}else if(filePath)await appendFile(filePath,bytes);else chunks.push(bytes)}
   const bytes=filePath?Buffer.alloc(0):Buffer.concat(chunks.map(v=>Buffer.from(v))),contentType=response.headers.get('content-type')||'',kind=size===0?'empty':/json/i.test(contentType)?'json':/html/i.test(contentType)?'html':/xml/i.test(contentType)?'xml':/^text\//i.test(contentType)?'text':'binary',text=filePath||kind==='binary'?null:bytes.toString('utf8')
   if(kind==='json'&&text)JSON.parse(text)
   responseData={status:response.status,statusText:response.statusText,headers:Object.fromEntries(response.headers),kind,text,rawBase64:kind==='binary'&&!filePath?bytes.toString('base64'):null,sizeBytes:size,contentType,durationMs:Date.now()-started,filePath}
   const safeResponse={...responseData};delete safeResponse.filePath;return {executionId,response:{...safeResponse,storedToFile:Boolean(filePath)}}
  }catch(caught){
   if(active.controller.signal.aborted)errorData=active.manual?error('request_cancelled','Request cancelled.','cancelled'):error('request_timeout','Request timed out.','timeout');else errorData=caught&&typeof caught==='object'&&'code'in caught?caught:error('network_failure','The request could not be completed.')
   throw errorData
  }finally{
   clearTimeout(active.timer);this.active.delete(executionId);this.requestExecutions.delete(draft.savedRequestId)
   const completed=new Date().toISOString(),historyId=randomUUID(),safe=JSON.stringify(safeDraft(draft)),e=errorData?JSON.stringify({code:errorData.code,category:errorData.category,message:errorData.message}):null
   const savedRef=this.db.prepare('SELECT id FROM saved_requests WHERE id=? AND workspace_id=?').get(draft.savedRequestId,draft.workspaceId)?draft.savedRequestId:null
   this.db.prepare('INSERT INTO request_history(id,workspace_id,saved_request_id,request_name,method,url_template,resolved_url_redacted,started_at,completed_at,duration_ms,status_code,status_text,request_snapshot_json,response_headers_json,response_body_kind,response_body_text,response_file_path,response_size_bytes,content_type,error_json,was_cancelled,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(historyId,draft.workspaceId,savedRef,draft.name,draft.method,draft.url,'[REDACTED]',startedAt,completed,Date.now()-started,responseData?.status??null,responseData?.statusText??null,safe,JSON.stringify(responseData?.headers??{}),responseData?.kind??null,responseData?.text??null,responseData?.filePath??null,responseData?.sizeBytes??0,responseData?.contentType??null,e,errorData?.code==='request_cancelled'?1:0,completed)
   const stale=this.db.prepare('SELECT id,response_file_path FROM request_history WHERE workspace_id=? ORDER BY created_at DESC LIMIT -1 OFFSET 500').all(draft.workspaceId) as {id:string;response_file_path:string|null}[]
   if(stale.length){this.db.transaction(()=>{for(const row of stale)this.db.prepare('DELETE FROM request_history WHERE id=?').run(row.id)})();for(const row of stale)if(row.response_file_path)void unlink(row.response_file_path).catch(()=>undefined)}
  }
 }
}
