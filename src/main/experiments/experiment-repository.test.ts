import { afterEach, expect, it } from 'vitest'
import { createDatabase } from '../database/database'
import { Repository } from '../repository'
import { ExperimentRepository } from './experiment-repository'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(() => databases.splice(0).forEach((db) => db.close()))

const setup = () => {
  const db = createDatabase(':memory:')
  databases.push(db)
  const repo = new Repository(db)
  repo.create('workspaces', { id: 'w', name: 'Workspace' })
  repo.create('collections', { id: 'c', workspace_id: 'w', name: 'API' })
  repo.create('saved_requests', {
    id: 'request', workspace_id: 'w', collection_id: 'c', name: 'Prompt', protocol: 'http', method: 'POST',
    url: 'https://example.test', description: '', params_json: '[]',
    headers_json: JSON.stringify([{ id: 'h', key: 'Authorization', value: 'Bearer secret', enabled: true }]),
    auth_json: JSON.stringify({ type: 'bearer', token: 'secret' }), body_json: JSON.stringify({ type: 'json', content: '{"temperature":0.2}' }),
    settings_json: JSON.stringify({ timeoutMs: 30000 }), stream_config_json: '{}',
  })
  return { db, experiments: new ExperimentRepository(db) }
}

it('creates an independent redacted run snapshot from a saved request', () => {
  const { db, experiments } = setup()
  const created = experiments.createFromRequest({ workspaceId: 'w', savedRequestId: 'request', name: 'Prompt Test' })
  db.prepare("delete from saved_requests where id='request'").run()
  const detail = experiments.get(created.id, 'w')!
  expect(detail.experiment).toMatchObject({ name: 'Prompt Test', protocol: 'http' })
  expect(detail.runs).toHaveLength(1)
  expect(detail.runs[0]).toMatchObject({ label: 'Run A', status: 'draft', position: 0 })
  expect(detail.runs[0].request_snapshot_json).not.toContain('Bearer secret')
  expect(detail.runs[0].request_snapshot_json).not.toContain('"token":"secret"')
  expect(detail.runs[0].request_snapshot_json).toContain('[REDACTED]')
})

it('clones only draft snapshots and enforces the 100 run ceiling', () => {
  const { db, experiments } = setup()
  const created = experiments.createFromRequest({ workspaceId: 'w', savedRequestId: 'request', name: 'Prompt Test' })
  const source = experiments.get(created.id, 'w')!.runs[0]
  db.prepare("update experiment_runs set status='completed' where id=?").run(source.id)
  expect(() => experiments.updateDraft(source.id, 'w', '{}')).toThrow('Only draft Runs can be edited.')
  for (let index = 1; index < 100; index++) experiments.createRun(created.id, 'w', source.id)
  expect(() => experiments.createRun(created.id, 'w', source.id)).toThrow('An Experiment can contain up to 100 Runs.')
})

it('rejects cross-workspace access', () => {
  const { experiments } = setup()
  const created = experiments.createFromRequest({ workspaceId: 'w', savedRequestId: 'request', name: 'Prompt Test' })
  expect(experiments.get(created.id, 'other')).toBeUndefined()
  expect(() => experiments.createRun(created.id, 'other')).toThrow('Experiment not found.')
})

it('preserves Environment placeholders while redacting literal credentials', () => {
  const { db, experiments } = setup()
  db.prepare("update saved_requests set auth_json=? where id='request'").run(JSON.stringify({type:'bearer',token:'{{TOKEN}}'}))
  const created = experiments.createFromRequest({ workspaceId: 'w', savedRequestId: 'request', name: 'Environment Test' })
  expect(experiments.get(created.id, 'w')!.runs[0].request_snapshot_json).toContain('{{TOKEN}}')
})

it('appends after the highest Run position when a middle Run was deleted', () => {
  const { experiments } = setup()
  const created = experiments.createFromRequest({ workspaceId: 'w', savedRequestId: 'request', name: 'Position Test' })
  const second = experiments.createRun(created.id, 'w') as any, third = experiments.createRun(created.id, 'w') as any
  experiments.deleteRun(second.id, 'w')
  expect(experiments.createRun(created.id, 'w', third.id)).toMatchObject({ position: 3, label: 'Run D' })
})

it('renames and duplicates Run configurations without copying results', () => {
  const { db, experiments } = setup()
  const created = experiments.createFromRequest({ workspaceId: 'w', savedRequestId: 'request', name: 'Original' })
  const source = experiments.get(created.id, 'w')!.runs[0]
  db.prepare("update experiment_runs set status='completed',result_snapshot_json='{}' where id=?").run(source.id)
  expect(experiments.rename(created.id, 'w', 'Renamed')).toMatchObject({ name: 'Renamed' })
  const copy = experiments.duplicate(created.id, 'w') as any, detail = experiments.get(copy.id, 'w')! as any
  expect(detail.experiment.name).toBe('Renamed Copy')
  expect(detail.runs[0]).toMatchObject({ label: 'Run A', status: 'draft', result_snapshot_json: null })
})

it('redacts credentials added while editing a draft Run', () => {
  const { experiments } = setup()
  const created = experiments.createFromRequest({ workspaceId: 'w', savedRequestId: 'request', name: 'Edited Secret' }), run = experiments.get(created.id, 'w')!.runs[0]
  const updated = experiments.updateDraft(run.id, 'w', JSON.stringify({ protocol: 'http', headers: [{ key: 'Authorization', value: 'new secret' }], auth: { type: 'bearer', token: 'new secret' } })) as any
  expect(updated.request_snapshot_json).not.toContain('new secret')
  expect(updated.request_snapshot_json).toContain('[REDACTED]')
})
