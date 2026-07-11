import { expect,it } from 'vitest'
import { suggestFilename } from './suggested-filename'
it('prefers filename star and sanitizes Windows paths and reserved names',()=>{expect(suggestFilename("attachment; filename*=UTF-8''voice%20one.mp3",'http://x/fallback','audio/mpeg')).toBe('voice one.mp3');expect(suggestFilename('attachment; filename="../CON.exe"','http://x/fallback','application/octet-stream')).toBe('_CON.exe')})
it('uses URL then MIME fallback',()=>{expect(suggestFilename(null,'http://x/files/a.png?x=1','image/png')).toBe('a.png');expect(suggestFilename(null,'http://x/','application/pdf')).toMatch(/^response-.*\.pdf$/)})
