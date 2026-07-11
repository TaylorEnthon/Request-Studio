import { randomUUID } from 'node:crypto'
import { lstat,readFile } from 'node:fs/promises'
import { basename } from 'node:path'
export class FileRegistry{
 private files=new Map<string,string>()
 register(path:string){const ref=randomUUID();this.files.set(ref,path);return {fileRef:ref,name:basename(path)}}
 async read(ref:string){const path=this.files.get(ref);if(!path)throw Object.assign(new Error('Select the file again.'),{code:'file_not_found'});const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw Object.assign(new Error('The selected file is not available.'),{code:'file_not_found'});if(stat.size>100*1024*1024)throw Object.assign(new Error('The selected file is too large.'),{code:'file_too_large'});return {bytes:await readFile(path),filename:basename(path)}}
}
