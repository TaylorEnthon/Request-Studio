import { beforeEach, expect, it, vi } from 'vitest'
import { createDatabase } from '../database/database'
import { Repository } from '../repository'

const handlers = new Map<string, (_event: unknown, input: unknown) => unknown>()
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: any) => handlers.set(channel, handler) } }))
import { registerExperimentHandlers } from './experiment-handlers'

beforeEach(() => handlers.clear())

it('registers named Experiment CRUD handlers with workspace ownership checks', async () => {
  const db = createDatabase(':memory:'), repo = new Repository(db)
  repo.create('workspaces', { id: 'w', name: 'Workspace' })
  repo.create('collections', { id: 'c', workspace_id: 'w', name: 'API' })
  const request = repo.create('saved_requests', { workspace_id: 'w', collection_id: 'c', name: 'Request', protocol: 'http', method: 'GET', url: 'https://example.test', description: '' }) as any
  const execute = vi.fn().mockResolvedValue({ status: 200 }), cancel = vi.fn().mockReturnValue(true), send = vi.fn().mockResolvedValue(undefined), deleteRunAssets = vi.fn().mockResolvedValue(undefined), deleteExperimentAssets = vi.fn().mockResolvedValue(undefined)
  registerExperimentHandlers(db, { execute, cancel, send, deleteRunAssets, deleteExperimentAssets } as any)
  const create = handlers.get('experiments:create')!, list = handlers.get('experiments:list')!, detail = handlers.get('experiments:get')!
  const created: any = await create(null, { workspaceId: 'w', savedRequestId: request.id, name: 'Compare' })
  expect(created.ok).toBe(true)
  expect((await list(null, { workspaceId: 'w' }) as any).data).toHaveLength(1)
  expect((await detail(null, { workspaceId: 'other', id: created.data.id }) as any).ok).toBe(false)
  const runId = (await detail(null, { workspaceId: 'w', id: created.data.id }) as any).data.runs[0].id
  expect((await handlers.get('experiment-runs:execute')!(null, { workspaceId: 'w', runId }) as any).ok).toBe(true)
  expect(execute).toHaveBeenCalledWith(runId, 'w', undefined)
  expect((await handlers.get('experiment-runs:send')!(null, { workspaceId: 'w', runId, kind: 'text', value: 'hello' }) as any).ok).toBe(true)
  expect(send).toHaveBeenCalledWith(runId, 'text', 'hello')
  const second: any = await handlers.get('experiment-runs:create')!(null, { workspaceId: 'w', experimentId: created.data.id, sourceRunId: runId })
  db.prepare("update experiment_runs set status='completed',result_snapshot_json='{}' where id in (?,?)").run(runId, second.data.id)
  const compared: any = await handlers.get('experiment-runs:compare-data')!(null, { workspaceId: 'w', leftRunId: runId, rightRunId: second.data.id })
  expect(compared.ok).toBe(true)
  expect(compared.data.left).not.toHaveProperty('path')
  expect((await handlers.get('experiments:rename')!(null, { workspaceId: 'w', id: created.data.id, name: 'Renamed' }) as any).data.name).toBe('Renamed')
  expect((await handlers.get('experiments:duplicate')!(null, { workspaceId: 'w', id: created.data.id }) as any).data.name).toBe('Renamed Copy')
  await handlers.get('experiment-runs:delete')!(null, { workspaceId: 'w', runId: second.data.id })
  expect(deleteRunAssets).toHaveBeenCalledWith('w', created.data.id, second.data.id)
  await handlers.get('experiments:delete')!(null, { workspaceId: 'w', id: created.data.id })
  expect(deleteExperimentAssets).toHaveBeenCalledWith('w', created.data.id)
  db.close()
})

it('recovers Runs interrupted by an application restart', () => {
  const db = createDatabase(':memory:')
  db.prepare("insert into workspaces values ('w','Workspace','x','x')").run()
  db.prepare("insert into experiments values ('e','w','Test','','http','x','x')").run()
  db.prepare("insert into experiment_runs(id,experiment_id,label,position,status,snapshot_version,request_snapshot_json,environment_snapshot_json,created_at,updated_at) values ('r','e','Run A',0,'running',1,'{}','{}','x','x')").run()
  registerExperimentHandlers(db)
  expect(db.prepare("select status,error_json from experiment_runs where id='r'").get()).toMatchObject({ status: 'failed', error_json: expect.stringContaining('run_interrupted') })
  db.close()
})
