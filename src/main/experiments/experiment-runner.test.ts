import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startMockServer } from '../../test/mock-http-server'
import { createDatabase } from '../database/database'
import { HttpExecutionService } from '../http/http-execution-service'
import { ResponseResourceRegistry } from '../response/response-resource-registry'
import { ExperimentRunner } from './experiment-runner'
import { startMockStreamingServer } from '../../test/mock-streaming-server'
import { SseConnectionService } from '../sse/sse-connection-service'
import { WebSocketConnectionService } from '../websocket/websocket-connection-service'
import { defaultSseConfig, defaultWebSocketConfig } from '../../shared/streaming/streaming-schemas'

let server: Awaited<ReturnType<typeof startMockServer>>, db: ReturnType<typeof createDatabase>, root: string
beforeEach(async () => {
  server = await startMockServer(); db = createDatabase(':memory:'); root = mkdtempSync(join(tmpdir(), 'request-studio-experiment-'))
  db.prepare("insert into workspaces values ('w','Workspace','x','x')").run()
  db.prepare("insert into experiments values ('e','w','Test','','http','x','x')").run()
})
afterEach(async () => { db.close(); await server.close(); rmSync(root, { recursive: true, force: true }) })

const addRun = (id: string, path: string, position = 0) => db.prepare(`insert into experiment_runs
  (id,experiment_id,label,position,status,snapshot_version,request_snapshot_json,environment_snapshot_json,created_at,updated_at)
  values (?,?,?,?,?,?,?,?,?,?)`).run(id, 'e', `Run ${position + 1}`, position, 'draft', 1, JSON.stringify({
    version: 1, protocol: 'http', name: 'Test', method: 'GET', url: server.baseUrl + path,
    params: [], headers: [], auth: { type: 'none' }, body: { type: 'none' }, settings: { timeoutMs: 1000 },
  }), '{}', 'x', 'x')

it('executes an HTTP Run and persists an immutable result snapshot', async () => {
  addRun('run-json', '/json')
  const historyRoot = join(root, 'history'), experimentRoot = join(root, 'experiments')
  const resources = new ResponseResourceRegistry([historyRoot, experimentRoot], db)
  const service = new HttpExecutionService(db, { responseDir: historyRoot, resources })
  const runner = new ExperimentRunner(db, service, resources, experimentRoot)
  const result = await runner.execute('run-json', 'w')
  expect(result).toMatchObject({ status: 200, kind: 'json' })
  const row = db.prepare("select status,result_snapshot_json from experiment_runs where id='run-json'").get() as any
  expect(row.status).toBe('completed')
  expect(JSON.parse(row.result_snapshot_json)).toMatchObject({ status: 200, kind: 'json', text: '{"ok":true,"query":[]}' })
})

it('copies managed media into Experiment ownership', async () => {
  addRun('run-image', '/image/png')
  const historyRoot = join(root, 'history'), experimentRoot = join(root, 'experiments')
  const resources = new ResponseResourceRegistry([historyRoot, experimentRoot], db)
  const runner = new ExperimentRunner(db, new HttpExecutionService(db, { responseDir: historyRoot, resources }), resources, experimentRoot)
  const result = await runner.execute('run-image', 'w')
  expect(result.resource).toMatchObject({ kind: 'image' })
  const asset = db.prepare("select path from experiment_resources where run_id='run-image'").get() as any
  expect(asset.path).toContain(experimentRoot)
  db.prepare('delete from request_history').run()
  expect(await resources.readPreview(result.resource.id, 0, 8)).toHaveLength(8)
})

it('rejects a managed response when the workspace Experiment quota is exhausted', async () => {
  addRun('run-quota', '/image/png')
  db.prepare("insert into experiment_resources(id,run_id,source,kind,path,byte_length,suggested_filename,warnings_json,created_at) values ('used','run-quota','response','binary','used.bin',2147483648,'used.bin','[]','x')").run()
  const historyRoot = join(root, 'history'), experimentRoot = join(root, 'experiments'), resources = new ResponseResourceRegistry([historyRoot, experimentRoot], db)
  const runner = new ExperimentRunner(db, new HttpExecutionService(db, { responseDir: historyRoot, resources }), resources, experimentRoot)
  await expect(runner.execute('run-quota', 'w')).rejects.toThrow('Experiment storage quota exceeded.')
})

it('copies file-backed text independently from HTTP History', async () => {
  addRun('run-large-text', '/large/64')
  const historyRoot = join(root, 'history'), experimentRoot = join(root, 'experiments'), resources = new ResponseResourceRegistry([historyRoot, experimentRoot], db)
  const runner = new ExperimentRunner(db, new HttpExecutionService(db, { responseDir: historyRoot, resources, memoryThreshold: 16 }), resources, experimentRoot)
  const result = await runner.execute('run-large-text', 'w')
  expect(result).toMatchObject({ storedToFile: true, resource: { source: 'experiment-response' } })
  db.prepare('delete from request_history').run()
  expect(await resources.readPreview(result.resource.id, 0, 8)).toEqual(Buffer.from('AAAAAAAA'))
})

it('captures an SSE session and its ordered events into Experiment ownership', async () => {
  const streaming = await startMockStreamingServer()
  try {
    db.prepare("update experiments set protocol='sse' where id='e'").run()
    db.prepare(`insert into experiment_runs(id,experiment_id,label,position,status,snapshot_version,request_snapshot_json,environment_snapshot_json,created_at,updated_at)
      values ('run-sse','e','Run A',0,'draft',1,?,'{}','x','x')`).run(JSON.stringify({ version: 1, protocol: 'sse', name: 'Events', url: streaming.httpUrl + '/sse/chunked', params: [], headers: [], auth: { type: 'none' }, streamConfig: defaultSseConfig }))
    const historyRoot = join(root, 'history'), streamRoot = join(root, 'stream'), experimentRoot = join(root, 'experiments')
    const resources = new ResponseResourceRegistry([historyRoot, streamRoot, experimentRoot], db)
    const ws = new WebSocketConnectionService(db, { assetRoot: streamRoot, resources, emit: () => {} })
    const sse = new SseConnectionService(db, { emit: () => {} })
    const runner = new ExperimentRunner(db, new HttpExecutionService(db, { responseDir: historyRoot, resources }), resources, experimentRoot, ws, sse)
    const result = await runner.execute('run-sse', 'w')
    expect(result).toMatchObject({ protocol: 'sse', eventCount: 2 })
    expect(db.prepare("select sequence,text_preview from experiment_run_records where run_id='run-sse' order by sequence").all()).toEqual([
      { sequence: 1, text_preview: '你好' }, { sequence: 2, text_preview: '{"x":1}' },
    ])
  } finally { await streaming.close() }
})

it('sends and captures WebSocket messages through the active Run', async () => {
  const streaming = await startMockStreamingServer()
  try {
    db.prepare("update experiments set protocol='websocket' where id='e'").run()
    db.prepare(`insert into experiment_runs(id,experiment_id,label,position,status,snapshot_version,request_snapshot_json,environment_snapshot_json,created_at,updated_at)
      values ('run-ws','e','Run A',0,'draft',1,?,'{}','x','x')`).run(JSON.stringify({ version: 1, protocol: 'websocket', name: 'Echo', url: streaming.wsUrl + '/ws/echo', params: [], headers: [], auth: { type: 'none' }, streamConfig: defaultWebSocketConfig }))
    const historyRoot = join(root, 'history'), streamRoot = join(root, 'stream'), experimentRoot = join(root, 'experiments')
    const resources = new ResponseResourceRegistry([historyRoot, streamRoot, experimentRoot], db)
    const ws = new WebSocketConnectionService(db, { assetRoot: streamRoot, resources, emit: () => {} }), sse = new SseConnectionService(db, { emit: () => {} })
    const runner = new ExperimentRunner(db, new HttpExecutionService(db, { responseDir: historyRoot, resources }), resources, experimentRoot, ws, sse)
    const completed = runner.execute('run-ws', 'w')
    for (let attempt = 0; attempt < 100 && !(db.prepare("select 1 from stream_sessions where status='open'").get()); attempt++) await new Promise((resolve) => setTimeout(resolve, 10))
    await runner.send('run-ws', 'text', 'hello')
    for (let attempt = 0; attempt < 100 && (db.prepare('select count(*) count from stream_records').get() as any).count < 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(runner.cancel('run-ws')).toBe(true)
    expect(await completed).toMatchObject({ protocol: 'websocket', status: 'stopped', recordCount: 2 })
  } finally { await streaming.close() }
})

it('copies WebSocket binary records into Experiment resources', async () => {
  const streaming = await startMockStreamingServer()
  try {
    db.prepare("update experiments set protocol='websocket' where id='e'").run()
    db.prepare(`insert into experiment_runs(id,experiment_id,label,position,status,snapshot_version,request_snapshot_json,environment_snapshot_json,created_at,updated_at)
      values ('run-binary','e','Run A',0,'draft',1,?,'{}','x','x')`).run(JSON.stringify({ version: 1, protocol: 'websocket', name: 'Binary', url: streaming.wsUrl + '/ws/binary', params: [], headers: [], auth: { type: 'none' }, streamConfig: defaultWebSocketConfig }))
    const historyRoot = join(root, 'history'), streamRoot = join(root, 'stream'), experimentRoot = join(root, 'experiments'), resources = new ResponseResourceRegistry([historyRoot, streamRoot, experimentRoot], db)
    const ws = new WebSocketConnectionService(db, { assetRoot: streamRoot, resources, emit: () => {} }), runner = new ExperimentRunner(db, new HttpExecutionService(db, { responseDir: historyRoot, resources }), resources, experimentRoot, ws, new SseConnectionService(db, { emit: () => {} }))
    const completed = runner.execute('run-binary', 'w')
    for (let attempt = 0; attempt < 100 && !(db.prepare('select 1 from stream_resources').get()); attempt++) await new Promise((resolve) => setTimeout(resolve, 10))
    runner.cancel('run-binary'); await completed
    expect(db.prepare("select count(*) count from experiment_resources where run_id='run-binary'").get()).toEqual({ count: 1 })
    expect(db.prepare("select resource_id from experiment_run_records where run_id='run-binary'").get()).toMatchObject({ resource_id: expect.any(String) })
  } finally { await streaming.close() }
})
