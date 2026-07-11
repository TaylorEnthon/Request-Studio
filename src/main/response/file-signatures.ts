import type { ResponseBodyKind } from '../../shared/response/response-contracts'
export type Signature={kind:Exclude<ResponseBodyKind,'empty'|'json'|'text'|'html'|'xml'>;mimeType:string;format:string;dangerous?:boolean}
const starts=(b:Buffer,s:number[]|string)=>typeof s==='string'?b.subarray(0,s.length).toString('latin1')===s:s.every((v,i)=>b[i]===v)
export function detectFileSignature(b:Buffer):Signature|null{
 if(starts(b,[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))return {kind:'image',mimeType:'image/png',format:'PNG'}
 if(starts(b,[0xff,0xd8,0xff]))return {kind:'image',mimeType:'image/jpeg',format:'JPEG'}
 if(starts(b,'GIF87a')||starts(b,'GIF89a'))return {kind:'image',mimeType:'image/gif',format:'GIF'}
 if(starts(b,'RIFF')&&b.subarray(8,12).toString()==='WEBP')return {kind:'image',mimeType:'image/webp',format:'WebP'}
 if(starts(b,'BM'))return {kind:'image',mimeType:'image/bmp',format:'BMP'}
 if(starts(b,[0,0,1,0]))return {kind:'image',mimeType:'image/x-icon',format:'ICO'}
 const text=b.subarray(0,64).toString('utf8').trimStart();if(text.startsWith('<svg')||/^<\?xml[^>]*>\s*<svg/i.test(text))return {kind:'binary',mimeType:'image/svg+xml',format:'SVG'}
 if(starts(b,'RIFF')&&b.subarray(8,12).toString()==='WAVE')return {kind:'audio',mimeType:'audio/wav',format:'WAV'}
 if(starts(b,'ID3')||(b.length>=2&&b[0]===0xff&&(b[1]&0xe0)===0xe0))return {kind:'audio',mimeType:'audio/mpeg',format:'MP3'}
 if(starts(b,'OggS'))return {kind:'audio',mimeType:'audio/ogg',format:'Ogg'}
 if(starts(b,'fLaC'))return {kind:'audio',mimeType:'audio/flac',format:'FLAC'}
 if(b.length>=2&&b[0]===0xff&&(b[1]&0xf6)===0xf0)return {kind:'audio',mimeType:'audio/aac',format:'AAC'}
 if(b.length>=12&&b.subarray(4,8).toString()==='ftyp'){const brand=b.subarray(8,12).toString();return /M4A|M4B|M4P|isom|mp42/.test(brand)?{kind:brand.startsWith('M4')?'audio':'video',mimeType:brand.startsWith('M4')?'audio/mp4':'video/mp4',format:brand.startsWith('M4')?'M4A':'MP4'}:{kind:'video',mimeType:'video/mp4',format:'MP4'}}
 if(starts(b,[0x1a,0x45,0xdf,0xa3]))return {kind:'video',mimeType:'video/webm',format:'WebM'}
 if(starts(b,'%PDF-'))return {kind:'pdf',mimeType:'application/pdf',format:'PDF'}
 if(starts(b,[0x50,0x4b,0x03,0x04]))return {kind:'binary',mimeType:'application/zip',format:'ZIP'}
 if(starts(b,[0x1f,0x8b]))return {kind:'binary',mimeType:'application/gzip',format:'GZIP'}
 if(starts(b,'Rar!'))return {kind:'binary',mimeType:'application/vnd.rar',format:'RAR'}
 if(starts(b,[0x37,0x7a,0xbc,0xaf,0x27,0x1c]))return {kind:'binary',mimeType:'application/x-7z-compressed',format:'7z'}
 if(starts(b,'MZ'))return {kind:'binary',mimeType:'application/vnd.microsoft.portable-executable',format:'PE',dangerous:true}
 if(starts(b,[0x7f,0x45,0x4c,0x46]))return {kind:'binary',mimeType:'application/x-elf',format:'ELF',dangerous:true}
 return null
}
