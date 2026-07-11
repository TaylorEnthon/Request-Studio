import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { parseRange } from './range-request'
import type { ResponseResourceRegistry } from './response-resource-registry'
export async function createResourceResponse(registry:ResponseResourceRegistry,request:Request){
 try{const url=new URL(request.url),match=/^\/resource\/([0-9a-f-]{36})$/i.exec(url.pathname);if(!match)return new Response('Not found',{status:404});const record=registry.getRecord(match[1]),size=(await stat(record.path)).size,range=parseRange(request.headers.get('range')??undefined,size);if(range.status===416)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`,'Accept-Ranges':'bytes'}});const headers:Record<string,string>={'Content-Type':record.effectiveMimeType||'application/octet-stream','Content-Length':String((range.end??size-1)-(range.start??0)+1),'Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"};if(range.status===206)headers['Content-Range']=`bytes ${range.start}-${range.end}/${size}`;const stream=createReadStream(record.path,{start:range.start,end:range.end});return new Response(Readable.toWeb(stream) as unknown as BodyInit,{status:range.status,headers})}catch{return new Response('Not found',{status:404})}
}
