import type { HttpRequestDraft } from '../../shared/schemas/http'
import { resolveTemplate,type EnvironmentValue } from './variable-resolver'

export function buildRequest(draft:HttpRequestDraft,variables:EnvironmentValue[]){
 const resolve=(value:string)=>resolveTemplate(value,variables).value,url=new URL(resolve(draft.url))
 for(const entry of draft.params)if(entry.enabled){if(!entry.key.trim())throw new Error('Enabled query parameter key is required');url.searchParams.append(resolve(entry.key),resolve(entry.value))}
 const headers:Record<string,string>={},set=(key:string,value:string)=>{headers[key.toLowerCase()]=value}
 let body:BodyInit|undefined
 if(draft.body.type==='json'){const resolved=resolve(draft.body.content);JSON.parse(resolved);body=resolved;set('content-type','application/json')}
 if(draft.body.type==='text'){body=resolve(draft.body.content);set('content-type',draft.body.contentType||'text/plain; charset=utf-8')}
 if(draft.body.type==='form-urlencoded'){const form=new URLSearchParams();for(const e of draft.body.entries)if(e.enabled)form.append(resolve(e.key),resolve(e.value));body=form;set('content-type','application/x-www-form-urlencoded')}
 if(draft.auth.type==='bearer'){const token=resolve(draft.auth.token);if(!token)throw new Error('Bearer token is required');set('authorization',`Bearer ${token}`)}
 if(draft.auth.type==='basic')set('authorization',`Basic ${Buffer.from(`${resolve(draft.auth.username)}:${resolve(draft.auth.password)}`,'utf8').toString('base64')}`)
 if(draft.auth.type==='api-key'){const key=resolve(draft.auth.key);if(!key)throw new Error('API key name is required');const value=resolve(draft.auth.value);if(draft.auth.placement==='query')url.searchParams.append(key,value);else set(key,value)}
 for(const entry of draft.headers)if(entry.enabled){if(!entry.key.trim())throw new Error('Enabled header name is required');set(resolve(entry.key),resolve(entry.value))}
 return {url:url.toString(),method:draft.method,headers,body}
}
