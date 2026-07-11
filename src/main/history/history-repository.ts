import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { unlinkSync } from 'node:fs'
import { isAbsolute,relative,resolve } from 'node:path'
export class HistoryRepository{
 constructor(private db:Database.Database,private responseDir?:string){}
 list(workspaceId:string){return this.db.prepare('SELECT * FROM request_history WHERE workspace_id=? ORDER BY created_at DESC LIMIT 500').all(workspaceId)}
 get(id:string,workspaceId:string){return this.db.prepare('SELECT * FROM request_history WHERE id=? AND workspace_id=?').get(id,workspaceId)}
 private removeManaged(path:string|null){if(!path||!this.responseDir)return;const rel=relative(resolve(this.responseDir),resolve(path));if(rel.startsWith('..')||isAbsolute(rel))return;try{unlinkSync(path)}catch{/* already absent or locked; DB deletion still succeeds */}}
 delete(id:string,workspaceId:string){const row=this.get(id,workspaceId) as any;const changed=this.db.prepare('DELETE FROM request_history WHERE id=? AND workspace_id=?').run(id,workspaceId).changes>0;if(changed)this.removeManaged(row?.response_file_path);return changed}
 clear(workspaceId:string){const rows=this.list(workspaceId) as any[],changes=this.db.prepare('DELETE FROM request_history WHERE workspace_id=?').run(workspaceId).changes;for(const row of rows)this.removeManaged(row.response_file_path);return changes}
 createRequest(id:string,workspaceId:string,collectionId:string){const row=this.get(id,workspaceId) as any;if(!row)return undefined;const snapshot=JSON.parse(row.request_snapshot_json),now=new Date().toISOString(),requestId=randomUUID();this.db.prepare('INSERT INTO saved_requests(id,workspace_id,collection_id,name,protocol,method,url,description,params_json,headers_json,auth_json,body_json,settings_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(requestId,workspaceId,collectionId,`${row.request_name} Copy`,'http',row.method,row.url_template,'Created from history',JSON.stringify(snapshot.params),JSON.stringify(snapshot.headers),JSON.stringify(snapshot.auth),JSON.stringify(snapshot.body),JSON.stringify(snapshot.settings),now,now);return this.db.prepare('SELECT * FROM saved_requests WHERE id=?').get(requestId)}
}
