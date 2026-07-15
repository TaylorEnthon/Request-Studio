import type Database from 'better-sqlite3'
import { dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { httpRequestDraftSchema } from '../../shared/schemas/http'
import { HttpExecutionService } from '../http/http-execution-service'
import { FileRegistry } from '../files/file-registry'
import { HistoryRepository } from '../history/history-repository'
import { ResponseResourceRegistry } from '../response/response-resource-registry'
import { registerResponseResourceHandlers } from './response-resource-handlers'

const id = z.string().min(1),
  fail = (message: string) => ({
    ok: false,
    error: { code: 'INVALID_INPUT', category: 'validation', message, retryable: false },
  })
export function registerHttpHandlers(db: Database.Database, responseDir: string, extraResourceRoots: string[] = []) {
  const files = new FileRegistry(),
    resources = new ResponseResourceRegistry([responseDir, ...extraResourceRoots], db),
    service = new HttpExecutionService(db, { responseDir, resources, resolveFile: (ref: string) => files.read(ref) }),
    history = new HistoryRepository(db, responseDir)
  void resources.recover().then(() => resources.cleanupOrphans())
  registerResponseResourceHandlers(db, resources, responseDir)
  const variables = (workspaceId: string) => {
    const selected = (
      db.prepare('SELECT value FROM app_settings WHERE key=?').get(`selectedEnvironment:${workspaceId}`) as
        { value: string } | undefined
    )?.value
    return selected
      ? db
          .prepare('SELECT key,value,is_secret FROM environment_variables WHERE environment_id=?')
          .all(selected)
          .map((v: any) => ({ key: v.key, value: v.value, isSecret: Boolean(v.is_secret) }))
      : []
  }
  const launch = (event: any, draft: any) => {
    try {
      const pending = service.start(draft, variables(draft.workspaceId))
      void pending.result
        .then((data) =>
          event.sender.send('http:execution-event', {
            type: 'completed',
            executionId: pending.executionId,
            requestId: draft.savedRequestId,
            data,
          }),
        )
        .catch((error) =>
          event.sender.send('http:execution-event', {
            type: error.code === 'request_cancelled' ? 'cancelled' : 'failed',
            executionId: pending.executionId,
            requestId: draft.savedRequestId,
            error: {
              code: error.code || 'network_failure',
              category: error.category || 'network',
              message: error.message,
              retryable: Boolean(error.retryable),
            },
          }),
        )
      return { ok: true, data: { executionId: pending.executionId } }
    } catch (error: any) {
      return {
        ok: false,
        error: {
          code: error.code || 'network_failure',
          category: error.category || 'network',
          message: error.message,
          retryable: false,
        },
      }
    }
  }
  ipcMain.handle('http:execute', (event, input) => {
    const parsed = httpRequestDraftSchema.safeParse(input)
    return parsed.success ? launch(event, parsed.data) : fail('Check the HTTP request configuration.')
  })
  ipcMain.handle('http:cancel', (_e, input) => {
    const parsed = z.object({ executionId: id }).strict().safeParse(input)
    return parsed.success ? { ok: true, data: service.cancel(parsed.data.executionId) } : fail('Invalid execution.')
  })
  ipcMain.handle('files:select-request-file', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile'] })
    return { ok: true, data: result.canceled ? null : files.register(result.filePaths[0]) }
  })
  const safeHistory = (row: any) => {
    const safe = { ...row }
    delete safe.response_file_path
    const resource = db
      .prepare(
        "SELECT id,kind,declared_mime_type as declaredMimeType,detected_mime_type as detectedMimeType,effective_mime_type as effectiveMimeType,byte_length as byteLength,suggested_filename as suggestedFilename,warnings_json FROM response_resources WHERE history_id=? AND source='managed-response-file'",
      )
      .get(row.id) as any
    return {
      ...safe,
      resource: resource
        ? { ...resource, warnings: JSON.parse(resource.warnings_json), warnings_json: undefined }
        : null,
    }
  }
  ipcMain.handle('history:list', (_e, input) => {
    const parsed = z.object({ workspaceId: id }).strict().safeParse(input)
    return parsed.success
      ? { ok: true, data: history.list(parsed.data.workspaceId).map(safeHistory) }
      : fail('Invalid workspace.')
  })
  ipcMain.handle('history:delete', (_e, input) => {
    const parsed = z.object({ id, workspaceId: id }).strict().safeParse(input)
    return parsed.success
      ? { ok: true, data: history.delete(parsed.data.id, parsed.data.workspaceId) }
      : fail('Invalid history.')
  })
  ipcMain.handle('history:clear', (_e, input) => {
    const parsed = z.object({ workspaceId: id }).strict().safeParse(input)
    return parsed.success ? { ok: true, data: history.clear(parsed.data.workspaceId) } : fail('Invalid workspace.')
  })
  ipcMain.handle('history:create-request', (_e, input) => {
    const parsed = z.object({ id, workspaceId: id, collectionId: id }).strict().safeParse(input)
    return parsed.success
      ? { ok: true, data: history.createRequest(parsed.data.id, parsed.data.workspaceId, parsed.data.collectionId) }
      : fail('Invalid history request.')
  })
  ipcMain.handle('history:rerun', (event, input) => {
    const parsed = z.object({ id, workspaceId: id }).strict().safeParse(input)
    if (!parsed.success) return fail('Invalid history request.')
    const row = history.get(parsed.data.id, parsed.data.workspaceId) as any
    if (!row) return fail('History not found.')
    if (row.request_snapshot_json.includes('[REDACTED]'))
      return fail('This history contains redacted credentials. Create a saved request and enter the credentials again.')
    const draft = httpRequestDraftSchema.safeParse(JSON.parse(row.request_snapshot_json))
    return draft.success ? launch(event, draft.data) : fail('This history snapshot cannot be rerun safely.')
  })
  return {
    cancelAll: () => service.cancelAll(),
    service,
    resources,
    files,
    cleanupWorkspace: (workspaceId: string) => history.clear(workspaceId),
  }
}
