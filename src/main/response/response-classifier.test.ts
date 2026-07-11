import { describe,expect,it } from 'vitest'
import { classifyResponse,normalizeContentType } from './response-classifier'
import { detectFileSignature } from './file-signatures'

const b=(hex:string)=>Buffer.from(hex.replaceAll(' ',''),'hex')
describe('response classification',()=>{
 it('normalizes MIME parameters and structured suffixes',()=>{
  expect(normalizeContentType(' Audio/MPEG; charset=binary ')).toEqual({mimeType:'audio/mpeg',charset:'binary'})
  expect(classifyResponse('application/problem+json',Buffer.from('{}')).kind).toBe('json')
  expect(classifyResponse('application/atom+xml',Buffer.from('<x/>')).kind).toBe('xml')
 })
 it.each([
  ['image','image/png',b('89504e470d0a1a0a')],['image','image/jpeg',b('ffd8ffe0')],['image','image/gif',Buffer.from('GIF89a')],
  ['image','image/webp',Buffer.from('RIFF0000WEBP')],['audio','audio/wav',Buffer.from('RIFF0000WAVE')],['audio','audio/mpeg',b('49443304')],
  ['audio','audio/ogg',Buffer.from('OggS')],['audio','audio/flac',Buffer.from('fLaC')],['video','video/mp4',b('000000186674797069736f6d')],
  ['video','video/webm',b('1a45dfa3')],['pdf','application/pdf',Buffer.from('%PDF-1.7')],['binary','application/zip',b('504b0304')],
  ['binary','application/vnd.microsoft.portable-executable',Buffer.from('MZ')]
 ] as const)('detects %s %s', (kind,mime,prefix)=>{expect(detectFileSignature(prefix)).toMatchObject({kind,mimeType:mime})})
 it('uses signature over unsafe declared MIME and warns',()=>{
  const value=classifyResponse('text/plain; charset=utf-8',b('89504e470d0a1a0a'))
  expect(value).toMatchObject({kind:'image',detectedMimeType:'image/png',source:'signature'})
  expect(value.warnings).toHaveLength(1)
 })
 it('does not treat clearly textual bytes as a declared image',()=>{const value=classifyResponse('image/png',Buffer.from('plain text response'));expect(value.kind).toBe('text');expect(value.warnings).toHaveLength(1)})
 it('falls back conservatively for empty, short and unknown bytes',()=>{
  expect(classifyResponse(null,Buffer.alloc(0)).kind).toBe('empty')
  expect(detectFileSignature(b('8950'))).toBeNull()
  expect(classifyResponse(null,b('00010203')).kind).toBe('binary')
  expect(classifyResponse(null,Buffer.from('plain text')).kind).toBe('text')
 })
})
