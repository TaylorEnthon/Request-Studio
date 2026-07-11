import { classifyResponse } from './response-classifier'
const MAX_INPUT=70*1024*1024,MAX_BYTES=50*1024*1024
const fail=(message:string)=>Object.assign(new Error(message),{code:'invalid_base64'})
export function inspectBase64(input:string){
 if(input.length>MAX_INPUT)throw fail('Base64 input is too large.')
 const data=/^data:([^;,]+)?;base64,(.*)$/is.exec(input);if(input.startsWith('data:')&&!data)throw fail('Base64 Data URL is invalid.')
 const declaredMimeType=data?.[1]?.toLowerCase()||null,clean=(data?.[2]??input).replace(/[\t\n\r ]/g,'')
 if(!clean||!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)||clean.includes('=')&&clean.indexOf('=')<clean.length-2||clean.length%4===1)throw fail('Base64 value is invalid.')
 const padded=clean+'='.repeat((4-clean.length%4)%4),padding=(padded.match(/=+$/)?.[0].length??0),estimated=Math.floor(padded.length*3/4)-padding
 if(estimated>MAX_BYTES)throw fail('Decoded Base64 is too large.')
 const bytes=Buffer.from(padded,'base64');if(bytes.length!==estimated)throw fail('Base64 value is invalid.')
 return {declaredMimeType,byteLength:bytes.length,bytes,classification:classifyResponse(declaredMimeType,bytes.subarray(0,4096))}
}
export const base64Limits={maximumInputCharacters:MAX_INPUT,maximumDecodedBytes:MAX_BYTES,minimumSuggestedLength:16}
