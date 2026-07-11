import { afterEach,describe,expect,it } from 'vitest'
import { mkdtempSync,mkdirSync,rmSync,writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ResponseResourceRegistry } from './response-resource-registry'
const roots:string[]=[]
afterEach(()=>roots.splice(0).forEach(v=>rmSync(v,{recursive:true,force:true})))
describe('ResponseResourceRegistry',()=>{
 it('registers only managed files and returns bounded previews',async()=>{const root=mkdtempSync(join(tmpdir(),'rs-resource-'));roots.push(root);mkdirSync(join(root,'h'));const path=join(root,'h','a.bin');writeFileSync(path,Buffer.from('abcdef'));const registry=new ResponseResourceRegistry([root]);const d=await registry.register({historyId:'h',source:'managed-response-file',kind:'binary',declaredMimeType:null,detectedMimeType:null,effectiveMimeType:'application/octet-stream',byteLength:6,suggestedFilename:'a.bin',warnings:[],path});expect(await registry.readPreview(d.id,1,3)).toEqual(Buffer.from('bcd'));await expect(registry.readPreview(d.id,0,16385)).rejects.toThrow(/preview/i)})
 it('rejects unknown IDs and files outside managed roots',async()=>{const root=mkdtempSync(join(tmpdir(),'rs-resource-'));roots.push(root);const registry=new ResponseResourceRegistry([root]);await expect(registry.readPreview('unknown',0,1)).rejects.toThrow(/not available/i);await expect(registry.register({historyId:'h',source:'managed-response-file',kind:'binary',declaredMimeType:null,detectedMimeType:null,effectiveMimeType:null,byteLength:0,suggestedFilename:'x',warnings:[],path:join(root,'..','x')})).rejects.toThrow(/managed/i)})
})
