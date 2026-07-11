import type { ResponseBodyKind,ResponseClassification } from '../../shared/response/response-contracts'
import { detectFileSignature } from './file-signatures'
export function normalizeContentType(value:string|null){if(!value)return {mimeType:null,charset:null};const [raw,...params]=value.split(';'),mimeType=raw.trim().toLowerCase()||null,charset=params.map(v=>v.trim()).find(v=>v.toLowerCase().startsWith('charset='))?.slice(8).replace(/^['"]|['"]$/g,'').toLowerCase()??null;return {mimeType,charset}}
const declaredKind=(m:string|null):ResponseBodyKind|null=>!m?null:m==='application/json'||m.endsWith('+json')?'json':m==='text/html'?'html':m==='application/xml'||m==='text/xml'||m.endsWith('+xml')?'xml':m.startsWith('image/')&&m!=='image/svg+xml'?'image':m.startsWith('audio/')?'audio':m.startsWith('video/')?'video':m==='application/pdf'?'pdf':m.startsWith('text/')?'text':null
export function classifyResponse(declared:string|null,prefix:Buffer):ResponseClassification{
 const declaredMimeType=normalizeContentType(declared).mimeType;if(!prefix.length)return {kind:'empty',declaredMimeType,detectedMimeType:null,effectiveMimeType:declaredMimeType,source:'fallback',warnings:[]}
 const signature=detectFileSignature(prefix),dk=declaredKind(declaredMimeType),warnings:string[]=[]
 if(signature){if(declaredMimeType&&declaredMimeType!==signature.mimeType)warnings.push(`Server declared ${declaredMimeType}, but the file signature indicates ${signature.mimeType}.`);return {kind:signature.kind,declaredMimeType,detectedMimeType:signature.mimeType,effectiveMimeType:signature.mimeType,source:'signature',warnings}}
 const sample=prefix.subarray(0,4096),decoded=sample.toString('utf8'),text=!decoded.includes('\ufffd')&&![...decoded].some(c=>{const n=c.charCodeAt(0);return n<9||(n>13&&n<32)})
 if(dk&&['image','pdf'].includes(dk)&&text){warnings.push(`Server declared ${declaredMimeType}, but the content appears to be plain text.`);return {kind:'text',declaredMimeType,detectedMimeType:'text/plain',effectiveMimeType:'text/plain',source:'sniffed',warnings}}
 if(dk)return {kind:dk,declaredMimeType,detectedMimeType:null,effectiveMimeType:declaredMimeType,source:'declared',warnings}
 return {kind:text?'text':'binary',declaredMimeType,detectedMimeType:null,effectiveMimeType:text?'text/plain':declaredMimeType||'application/octet-stream',source:text?'sniffed':'fallback',warnings}
}
