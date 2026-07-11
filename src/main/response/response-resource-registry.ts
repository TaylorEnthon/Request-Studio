import { randomUUID } from 'node:crypto'
import { open,readdir,realpath,rm,stat } from 'node:fs/promises'
import { isAbsolute,relative,resolve } from 'node:path'
import type { ResponseResourceDescriptor } from '../../shared/response/response-contracts'
import type Database from 'better-sqlite3'
type Input=Omit<ResponseResourceDescriptor,'id'|'storageMode'> & {path:string}
export type ResourceRecord=ResponseResourceDescriptor&{path:string}
export class ResponseResourceRegistry{
 private records=new Map<string,ResourceRecord>()
 constructor(private roots:string[],private db?:Database.Database){}
 private async safe(path:string){let actual:string;try{actual=await realpath(path)}catch{throw new Error('Resource is not available in managed storage.')}const valid=await Promise.all(this.roots.map(async root=>{try{const rel=relative(await realpath(root),actual);return !rel.startsWith('..')&&!isAbsolute(rel)}catch{return false}}));if(!valid.some(Boolean))throw new Error('Resource is outside managed storage.');if(!(await stat(actual)).isFile())throw new Error('Resource is not available.');return actual}
 async register(input:Input,id=randomUUID(),digest:string|null=null){const path=await this.safe(input.path),descriptor:ResourceRecord={...input,id,path,storageMode:'managed-resource'};this.records.set(id,descriptor);this.db?.prepare('INSERT OR REPLACE INTO response_resources(id,history_id,source,kind,declared_mime_type,detected_mime_type,effective_mime_type,path,byte_length,suggested_filename,warnings_json,digest,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,input.historyId,input.source,input.kind,input.declaredMimeType,input.detectedMimeType,input.effectiveMimeType,path,input.byteLength,input.suggestedFilename,JSON.stringify(input.warnings),digest,new Date().toISOString());return this.public(descriptor)}
 async recover(){if(!this.db)return;for(const row of this.db.prepare('SELECT * FROM response_resources').all() as any[])try{await this.register({historyId:row.history_id,source:row.source,kind:row.kind,declaredMimeType:row.declared_mime_type,detectedMimeType:row.detected_mime_type,effectiveMimeType:row.effective_mime_type,byteLength:row.byte_length,suggestedFilename:row.suggested_filename,warnings:JSON.parse(row.warnings_json),path:row.path},row.id,row.digest)}catch{/* missing managed file stays unavailable */}}
 async cleanupOrphans(){if(!this.db)return;const valid=new Set((this.db.prepare('SELECT id FROM request_history').all() as {id:string}[]).map(v=>v.id));for(const root of this.roots)for(const workspace of await readdir(root,{withFileTypes:true}).catch(()=>[]))if(workspace.isDirectory())for(const history of await readdir(resolve(root,workspace.name),{withFileTypes:true}).catch(()=>[]))if(history.isDirectory()&&!valid.has(history.name))await rm(resolve(root,workspace.name,history.name),{recursive:true,force:true})}
 getRecord(id:string){const value=this.records.get(id);if(!value)throw new Error('Resource is not available.');return value}
 get(id:string){return this.public(this.getRecord(id))}
 delete(id:string){this.records.delete(id)}
 async readPreview(id:string,offset=0,length=4096){if(length<1||length>16384||offset<0)throw new Error('Invalid preview range.');const record=this.getRecord(id),handle=await open(await this.safe(record.path),'r');try{const output=Buffer.alloc(Math.min(length,Math.max(0,record.byteLength-offset))),{bytesRead}=await handle.read(output,0,output.length,offset);return output.subarray(0,bytesRead)}finally{await handle.close()}}
 private public(record:ResourceRecord):ResponseResourceDescriptor{const descriptor={...record};delete (descriptor as Partial<ResourceRecord>).path;return descriptor}
}
