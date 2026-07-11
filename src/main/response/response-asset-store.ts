import { mkdir,rm,writeFile } from 'node:fs/promises'
import { join } from 'node:path'
export class ResponseAssetStore{
 constructor(readonly root:string){}
 directory(workspaceId:string,historyId:string){return join(this.root,workspaceId,historyId)}
 responsePath(workspaceId:string,historyId:string){return join(this.directory(workspaceId,historyId),'response.bin')}
 async write(workspaceId:string,historyId:string,name:string,bytes:Buffer){const dir=this.directory(workspaceId,historyId);await mkdir(dir,{recursive:true});const path=join(dir,name);await writeFile(path,bytes);return path}
 async remove(workspaceId:string,historyId:string){await rm(this.directory(workspaceId,historyId),{recursive:true,force:true})}
 async clearWorkspace(workspaceId:string){await rm(join(this.root,workspaceId),{recursive:true,force:true})}
}
