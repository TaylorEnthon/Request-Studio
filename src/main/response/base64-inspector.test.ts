import { describe,expect,it } from 'vitest'
import { inspectBase64 } from './base64-inspector'
describe('inspectBase64',()=>{
 it('accepts plain Base64 and Data URLs then classifies decoded bytes',()=>{
  expect(inspectBase64(Buffer.from('%PDF-1.7').toString('base64'))).toMatchObject({classification:{kind:'pdf'},byteLength:8})
  const png='data:image/png;base64,'+Buffer.from('89504e470d0a1a0a','hex').toString('base64')
  expect(inspectBase64(png)).toMatchObject({declaredMimeType:'image/png',classification:{kind:'image'}})
 })
 it.each(['','@@@=','AAAA===','data:image/png,abc'])('rejects invalid input without echoing it',input=>{expect(()=>inspectBase64(input)).toThrow(/Base64/);try{inspectBase64(input)}catch(e){expect(String(e)).not.toContain(input||'secret-payload')}})
 it('rejects estimated decoded data before allocation',()=>expect(()=>inspectBase64('A'.repeat(70*1024*1024+1))).toThrow(/too large/i))
})
