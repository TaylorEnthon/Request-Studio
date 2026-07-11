import { expect, it } from 'vitest'
import { httpRequestDraftSchema } from './http'

it('accepts supported HTTP configuration and rejects timeout/body violations',()=>{
 const base={savedRequestId:'r',workspaceId:'w',name:'GET JSON',method:'GET',url:'http://127.0.0.1/json',params:[],headers:[],auth:{type:'none'},body:{type:'none'},settings:{timeoutMs:30000}}
 expect(httpRequestDraftSchema.parse(base)).toMatchObject(base)
 expect(httpRequestDraftSchema.safeParse({...base,method:'TRACE'}).success).toBe(false)
 expect(httpRequestDraftSchema.safeParse({...base,settings:{timeoutMs:0}}).success).toBe(false)
 expect(httpRequestDraftSchema.safeParse({...base,body:{type:'text',content:'bad'}}).success).toBe(false)
})
