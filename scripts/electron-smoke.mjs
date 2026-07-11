import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import electron from 'electron'

const dir=mkdtempSync(join(tmpdir(),'request-studio-electron-'))
try {
  const rebuilt=spawnSync(process.execPath,[resolve('node_modules','@electron','rebuild','lib','cli.js'),'-f','-w','better-sqlite3'],{stdio:'inherit'})
  if(rebuilt.error)throw rebuilt.error
  if(rebuilt.status!==0)throw new Error('Electron native rebuild failed')
  const child=spawn(electron,['out/main/index.js',`--user-data-dir=${dir}`],{stdio:['ignore','pipe','pipe'],env:{...process.env,REQUEST_STUDIO_SMOKE:'1'}})
  let output=''
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk)
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(`Electron did not exit after loading: ${output}`)),10000);child.once('exit',code=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error(`Electron exited (${code}): ${output}`))});child.once('error',reject)})
  console.log('electron main smoke passed')
} finally {
  spawnSync(process.execPath,[process.env.npm_execpath,'rebuild','better-sqlite3'],{stdio:'inherit'})
  rmSync(dir,{recursive:true,force:true})
}
