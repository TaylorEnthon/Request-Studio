import { ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Repository } from '../repository'
import { previewCurlImport, type CurlImportPreview } from '../../shared/curl/curl-import-preview'
import { mapCurlImportSave } from '../../shared/curl/curl-import-save'
import { validate } from './validate'

const previewInputSchema = z
  .object({
    source: z.string().min(1),
    dialect: z.enum(['auto', 'posix', 'powershell', 'cmd']),
  })
  .strict()

const saveInputSchema = z
  .object({
    previewId: z.string().uuid(),
    workspaceId: z.string().min(1),
    collectionId: z.string().min(1),
    environmentId: z.string().min(1).optional(),
    name: z.string().trim().min(1).max(100),
    variableMappings: z.array(
      z
        .object({
          placeholder: z.string().min(1),
          variableName: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/),
        })
        .strict(),
    ),
  })
  .strict()

const error = (code: string, message: string) => ({
  ok: false as const,
  error: { code, category: 'validation' as const, message, retryable: false as const },
})

export const registerCurlImportHandlers = (repo: Repository) => {
  const previews = new WeakMap<object, { id: string; preview: CurlImportPreview }>()

  ipcMain.handle('curl-import:preview', (event, input) => {
    previews.delete(event.sender)
    const checked = validate(previewInputSchema, input)
    if (!checked.ok) return checked
    const result = previewCurlImport(checked.data.source, checked.data.dialect)
    if (!result.ok) {
      const issue = result.issues[0]
      return error(issue?.code ?? 'PREVIEW_FAILED', issue?.message ?? 'The cURL command could not be previewed.')
    }
    const latest = { id: randomUUID(), preview: result.preview }
    previews.set(event.sender, latest)
    return { ok: true, data: { previewId: latest.id, preview: latest.preview } }
  })

  ipcMain.handle('curl-import:save', (event, input) => {
    const checked = validate(saveInputSchema, input)
    if (!checked.ok) return checked
    const latest = previews.get(event.sender)
    if (!latest || latest.id !== checked.data.previewId) {
      return error('PREVIEW_EXPIRED', 'Preview the cURL command again before importing.')
    }
    try {
      const data = repo.importCurl(
        mapCurlImportSave({ ...checked.data, preview: latest.preview }),
      )
      previews.delete(event.sender)
      return { ok: true, data }
    } catch {
      return error('IMPORT_FAILED', 'The cURL request could not be imported.')
    }
  })
}
