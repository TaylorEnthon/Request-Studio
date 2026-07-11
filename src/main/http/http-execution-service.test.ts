import { afterEach, beforeEach, expect, it } from 'vitest'
import { createDatabase } from '../database/database'
import { startMockServer } from '../../test/mock-http-server'
import { HttpExecutionService } from './http-execution-service'
import { mkdtempSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let server:Awaited<ReturnType<typeof startMockServer>>,db:ReturnType<typeof createDatabase>
beforeEach(async()=>{server=await startMockServer();db=createDatabase(':memory:');db.prepare("insert into workspaces values ('w','W','x','x')").run();db.prepare("insert into collections values ('c','w','C','x','x')").run();db.prepare("insert into saved_requests(id,workspace_id,collection_id,name,protocol,method,url,description,created_at,updated_at) values('r','w','c','R','http','GET','','','x','x')").run()})
afterEach(async()=>{db.close();await server.close()})
const draft=(path:string,timeoutMs=1000)=>({savedRequestId:'r',workspaceId:'w',name:'R',method:'GET' as const,url:server.baseUrl+path,params:[],headers:[],auth:{type:'none' as const},body:{type:'none' as const},settings:{timeoutMs}})
it('executes JSON and treats 500 as a response while persisting history',async()=>{const service=new HttpExecutionService(db);const ok=await service.execute(draft('/json'),[]);expect(ok.response).toMatchObject({status:200,kind:'json'});const failure=await service.execute(draft('/status/500'),[]);expect(failure.response.status).toBe(500);expect(db.prepare('select count(*) count from request_history').get()).toEqual({count:2});expect(service.activeCount).toBe(0)})
it('distinguishes timeout and enforces response maximum',async()=>{const service=new HttpExecutionService(db,{maximumBytes:32});await expect(service.execute(draft('/delay/100',20),[])).rejects.toMatchObject({code:'request_timeout'});await expect(service.execute(draft('/large/64'),[])).rejects.toMatchObject({code:'response_too_large'});expect(service.activeCount).toBe(0)})
it('cancels an active execution and rejects duplicate cancellation',async()=>{const service=new HttpExecutionService(db),pending=service.start(draft('/delay/200'),[]),rejection=expect(pending.result).rejects.toMatchObject({code:'request_cancelled'});expect(service.cancel(pending.executionId)).toBe(true);expect(service.cancel(pending.executionId)).toBe(false);await rejection})
it('classifies text, HTML, XML, binary, empty and 400 responses',async()=>{const service=new HttpExecutionService(db);for(const [path,kind] of [['/text','text'],['/html','html'],['/xml','xml'],['/binary','binary'],['/empty','empty']] as const)expect((await service.execute(draft(path),[])).response.kind).toBe(kind);expect((await service.execute(draft('/status/400'),[])).response.status).toBe(400)})
it('stores responses above the memory threshold in a managed file',async()=>{const dir=mkdtempSync(join(tmpdir(),'request-studio-response-'));try{const service=new HttpExecutionService(db,{memoryThreshold:16,maximumBytes:128,responseDir:dir});const result=await service.execute(draft('/large/64'),[]);expect(result.response).toMatchObject({storedToFile:true,sizeBytes:64});expect((db.prepare('select response_file_path from request_history order by created_at desc').get() as any).response_file_path).toContain(dir)}finally{rmSync(dir,{recursive:true,force:true})}})
