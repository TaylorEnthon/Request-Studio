import type Database from 'better-sqlite3'
import { ipcMain } from 'electron'
import { z } from 'zod'
import { open } from 'node:fs/promises'
import { ExperimentRepository } from '../experiments/experiment-repository'
import type { ExperimentRunner } from '../experiments/experiment-runner'
import {
  compareRunsInputSchema, createExperimentInputSchema, createRunInputSchema, experimentInputSchema, listExperimentsInputSchema,
  executeRunInputSchema, renameExperimentInputSchema, runInputSchema, sendRunInputSchema, updateRunInputSchema,
} from '../../shared/experiments/experiment-schemas'

const fail = (code: string, message: string, category = 'validation') => ({ ok: false, error: { code, category, message, retryable: false } })
const parse = <T>(schema: z.ZodType<T>, input: unknown) => {
  const result = schema.safeParse(input)
  return result.success ? result.data : null
}

export function registerExperimentHandlers(db: Database.Database, runner?: ExperimentRunner) {
  const experiments = new ExperimentRepository(db)
  const recoveredAt = new Date().toISOString()
  db.prepare("UPDATE experiment_runs SET status='failed',completed_at=?,error_json=?,updated_at=? WHERE status IN ('queued','running')")
    .run(recoveredAt, JSON.stringify({ code: 'run_interrupted', message: 'The application closed before this Run completed.' }), recoveredAt)
  ipcMain.handle('experiments:list', (_event, input) => {
    const checked = parse(listExperimentsInputSchema, input)
    return checked ? { ok: true, data: experiments.list(checked.workspaceId, checked.limit, checked.offset) } : fail('invalid_experiment_query', 'Invalid Experiment query.')
  })
  ipcMain.handle('experiments:get', (_event, input) => {
    const checked = parse(experimentInputSchema, input), data = checked && experiments.get(checked.id, checked.workspaceId)
    return data ? { ok: true, data } : fail('experiment_not_found', 'Experiment not found.', 'database')
  })
  ipcMain.handle('experiments:create', (_event, input) => {
    const checked = parse(createExperimentInputSchema, input)
    if (!checked) return fail('invalid_experiment', 'Invalid Experiment.')
    try { return { ok: true, data: experiments.createFromRequest(checked) } }
    catch (error) { return fail('experiment_create_failed', error instanceof Error ? error.message : 'Experiment could not be created.', 'database') }
  })
  ipcMain.handle('experiments:rename', (_event, input) => {
    const checked = parse(renameExperimentInputSchema, input)
    if (!checked) return fail('invalid_experiment', 'Invalid Experiment.')
    try { const data = experiments.rename(checked.id, checked.workspaceId, checked.name); return data ? { ok: true, data } : fail('experiment_not_found', 'Experiment not found.', 'database') }
    catch { return fail('duplicate_experiment_name', 'An Experiment with this name already exists.', 'database') }
  })
  ipcMain.handle('experiments:duplicate', (_event, input) => {
    const checked = parse(experimentInputSchema, input)
    if (!checked) return fail('invalid_experiment', 'Invalid Experiment.')
    try { return { ok: true, data: experiments.duplicate(checked.id, checked.workspaceId) } }
    catch (error) { return fail('experiment_duplicate_failed', error instanceof Error ? error.message : 'Experiment could not be duplicated.', 'database') }
  })
  ipcMain.handle('experiments:delete', async (_event, input) => {
    const checked = parse(experimentInputSchema, input)
    if (!checked || !experiments.delete(checked.id, checked.workspaceId)) return fail('experiment_not_found', 'Experiment not found.', 'database')
    await runner?.deleteExperimentAssets(checked.workspaceId, checked.id)
    return { ok: true, data: null }
  })
  ipcMain.handle('experiment-runs:create', (_event, input) => {
    const checked = parse(createRunInputSchema, input)
    if (!checked) return fail('invalid_run', 'Invalid Run.')
    try { return { ok: true, data: experiments.createRun(checked.experimentId, checked.workspaceId, checked.sourceRunId) } }
    catch (error) { return fail('run_create_failed', error instanceof Error ? error.message : 'Run could not be created.', 'database') }
  })
  ipcMain.handle('experiment-runs:update', (_event, input) => {
    const checked = parse(updateRunInputSchema, input)
    if (!checked) return fail('invalid_run', 'Invalid Run.')
    try { return { ok: true, data: experiments.updateDraft(checked.runId, checked.workspaceId, checked.snapshotJson) } }
    catch (error) { return fail('run_update_failed', error instanceof Error ? error.message : 'Run could not be updated.', 'database') }
  })
  ipcMain.handle('experiment-runs:delete', async (_event, input) => {
    const checked = parse(runInputSchema, input)
    const owned = checked && db.prepare('SELECT r.experiment_id FROM experiment_runs r JOIN experiments e ON e.id=r.experiment_id WHERE r.id=? AND e.workspace_id=?').get(checked.runId, checked.workspaceId) as any
    if (!checked || !owned || !experiments.deleteRun(checked.runId, checked.workspaceId)) return fail('run_not_found', 'Run not found.', 'database')
    await runner?.deleteRunAssets(checked.workspaceId, owned.experiment_id, checked.runId)
    return { ok: true, data: null }
  })
  ipcMain.handle('experiment-runs:execute', async (_event, input) => {
    const checked = parse(executeRunInputSchema, input)
    if (!checked || !runner) return fail('invalid_run', 'Invalid Run.')
    try { return { ok: true, data: await runner.execute(checked.runId, checked.workspaceId, checked.environmentId) } }
    catch (error) { return fail('run_execution_failed', error instanceof Error ? error.message : 'Run failed.', 'network') }
  })
  ipcMain.handle('experiment-runs:cancel', (_event, input) => {
    const checked = parse(runInputSchema, input)
    const owned = checked && db.prepare('SELECT 1 FROM experiment_runs r JOIN experiments e ON e.id=r.experiment_id WHERE r.id=? AND e.workspace_id=?').get(checked.runId, checked.workspaceId)
    return owned && runner ? { ok: true, data: runner.cancel(checked!.runId) } : fail('invalid_run', 'Invalid Run.')
  })
  ipcMain.handle('experiment-runs:send', async (_event, input) => {
    const checked = parse(sendRunInputSchema, input)
    const owned = checked && db.prepare('SELECT 1 FROM experiment_runs r JOIN experiments e ON e.id=r.experiment_id WHERE r.id=? AND e.workspace_id=?').get(checked.runId, checked.workspaceId)
    if (!owned || !runner) return fail('invalid_run', 'Invalid Run.')
    try { await runner.send(checked!.runId, checked!.kind, checked!.value); return { ok: true, data: null } }
    catch (error) { return fail('run_send_failed', error instanceof Error ? error.message : 'Message could not be sent.', 'network') }
  })
  ipcMain.handle('experiment-runs:compare-data', async (_event, input) => {
    const checked = parse(compareRunsInputSchema, input)
    if (!checked) return fail('invalid_compare', 'Select two different Runs.')
    const get = async (id: string) => {
      const run = db.prepare(`SELECT r.*,e.workspace_id,e.protocol FROM experiment_runs r JOIN experiments e ON e.id=r.experiment_id
        WHERE r.id=? AND e.workspace_id=?`).get(id, checked.workspaceId) as any
      if (!run) return undefined
      const records = db.prepare('SELECT sequence,direction,record_type,data_kind,relative_time_ms,byte_length,text_preview,json_text,event_name,event_id,retry_ms,outcome,resource_id FROM experiment_run_records WHERE run_id=? ORDER BY sequence LIMIT 10001').all(id)
      const resources = db.prepare(`SELECT id,run_id as historyId,source,kind,declared_mime_type as declaredMimeType,
        detected_mime_type as detectedMimeType,effective_mime_type as effectiveMimeType,byte_length as byteLength,
        suggested_filename as suggestedFilename,warnings_json,digest FROM experiment_resources WHERE run_id=?`).all(id).map((resource: any) => ({ ...resource, warnings: JSON.parse(resource.warnings_json), warnings_json: undefined, storageMode: 'managed-resource' }))
      const result = JSON.parse(run.result_snapshot_json || 'null')
      if (result?.externalBodyKind && result.resource?.id) {
        const asset = db.prepare('SELECT path,byte_length FROM experiment_resources WHERE id=? AND run_id=?').get(result.resource.id, id) as any
        if (asset?.byte_length > 2 * 1024 * 1024) result.compareSkippedReason = 'Diff skipped: content exceeds limit.'
        else if (asset) try { const handle = await open(asset.path, 'r'); try { const bytes = Buffer.alloc(asset.byte_length), read = await handle.read(bytes, 0, bytes.length, 0); result.text = bytes.subarray(0, read.bytesRead).toString('utf8') } finally { await handle.close() } }
        catch { result.compareSkippedReason = 'Diff skipped: managed content is unavailable.' }
      }
      return { run, request: JSON.parse(run.request_snapshot_json), result, records, resources }
    }
    const [left, right] = await Promise.all([get(checked.leftRunId), get(checked.rightRunId)])
    if (!left || !right || left.run.experiment_id !== right.run.experiment_id || left.run.status !== 'completed' || right.run.status !== 'completed')
      return fail('invalid_compare', 'Only two completed Runs from the same Experiment can be compared.')
    return { ok: true, data: { left, right } }
  })
  return experiments
}
