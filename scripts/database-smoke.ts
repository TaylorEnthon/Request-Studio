import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase } from '../src/main/database/database'
import { Repository } from '../src/main/repository'

const dir=mkdtempSync(join(tmpdir(),'request-studio-smoke-')),file=join(dir,'smoke.db')
try {
  let db=createDatabase(file),repo=new Repository(db)
  repo.create('workspaces',{id:'w',name:'Smoke'});repo.create('environments',{id:'e',workspace_id:'w',name:'Local'});repo.selectEnvironment('w','e');db.close()
  db=createDatabase(file);repo=new Repository(db)
  if(db.pragma('user_version',{simple:true})!==2||repo.resolveSelectedEnvironment('w')!=='e'||repo.list('workspaces').length!==1)throw new Error('Persistence smoke failed')
  db.close();console.log('database smoke passed')
} finally { rmSync(dir,{recursive:true,force:true}) }
