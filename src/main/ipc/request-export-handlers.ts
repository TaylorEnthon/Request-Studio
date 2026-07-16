import { randomUUID } from 'node:crypto'
import { dialog, ipcMain } from 'electron'
import { z } from 'zod'
import type { SavedRequestAssetRow } from '../../shared/assets/request-asset-mapper'
import {
  createRequestExportPreview,
  type RequestExportPreview,
} from '../../shared/assets/request-export-preview'
import type { Repository } from '../repository'
import { sanitizeExportFilename, writeExportFileAtomic } from '../export/request-export-file'
import { validate } from './validate'

const previewInput = z
  .object({
    workspaceId: z.string().min(1),
    requestId: z.string().min(1),
    format: z.enum(['curl', 'request-json']),
  })
  .strict()
const saveInput = z.object({ previewId: z.string().uuid() }).strict()
const failure = (code: string, message: string) => ({
  ok: false as const,
  error: { code, category: 'export' as const, message, retryable: false as const },
})

export function registerRequestExportHandlers(repo: Repository, userData: string): void {
  const previews = new WeakMap<object, { id: string; preview: RequestExportPreview }>()
  const saving = new WeakSet<object>()

  ipcMain.handle('request-export:preview', (event, input) => {
    previews.delete(event.sender)
    const checked = validate(previewInput, input)
    if (!checked.ok) return checked
    const row = repo.getSavedRequestForExport(checked.data.requestId, checked.data.workspaceId)
    if (!row) return failure('REQUEST_NOT_FOUND', 'Saved request is not available.')
    try {
      const latest = {
        id: randomUUID(),
        preview: createRequestExportPreview(row as SavedRequestAssetRow, checked.data.format),
      }
      previews.set(event.sender, latest)
      return { ok: true as const, data: { previewId: latest.id, preview: latest.preview } }
    } catch {
      return failure('PREVIEW_FAILED', 'Request export could not be previewed.')
    }
  })

  ipcMain.handle('request-export:save', async (event, input) => {
    const checked = validate(saveInput, input)
    if (!checked.ok) return checked
    const latest = previews.get(event.sender)
    if (!latest || latest.id !== checked.data.previewId) {
      return failure('PREVIEW_EXPIRED', 'Preview the request again before saving.')
    }
    if (saving.has(event.sender)) {
      return failure('SAVE_IN_PROGRESS', 'A request export is already being saved.')
    }
    saving.add(event.sender)
    try {
      const result = await dialog.showSaveDialog({
        defaultPath: sanitizeExportFilename(latest.preview.filenameSuggestion),
      })
      if (result.canceled || !result.filePath) return { ok: true as const, data: { saved: false } }
      await writeExportFileAtomic(result.filePath, latest.preview.content, userData)
      previews.delete(event.sender)
      return { ok: true as const, data: { saved: true } }
    } catch {
      return failure('SAVE_FAILED', 'Request export could not be saved.')
    } finally {
      saving.delete(event.sender)
    }
  })
}
