import { expect, it } from 'vitest'
import { buildRequest } from './request-builder'

it('builds URL, auth, headers and JSON with explicit header precedence',()=>{
 const built=buildRequest({savedRequestId:'r',workspaceId:'w',name:'Post',method:'POST',url:'http://localhost/x?old=1',params:[{id:'1',enabled:true,key:'q',value:'a b'}],headers:[{id:'2',enabled:true,key:'Authorization',value:'Custom'}],auth:{type:'bearer',token:'secret'},body:{type:'json',content:'{"name":"{{NAME}}"}'},settings:{timeoutMs:1000}},[{key:'NAME',value:'A \\"B',isSecret:false}])
 expect(built.url).toBe('http://localhost/x?old=1&q=a+b')
 expect(built.headers.authorization).toBe('Custom')
 expect(built.headers['content-type']).toBe('application/json')
 expect(JSON.parse(built.body as string).name).toBe('A "B')
})
