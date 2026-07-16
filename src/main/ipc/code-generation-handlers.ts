import { ipcMain } from 'electron'
import { z } from 'zod'
import type { SavedRequestAssetRow } from '../../shared/assets/request-asset-mapper'
import { mapSavedRequestToExportAsset } from '../../shared/assets/request-export'
import { generateCode } from '../../shared/codegen/code-generation'
import type { Repository } from '../repository'
import { validate } from './validate'

const inputSchema = z.object({
  workspaceId: z.string().min(1),
  requestId: z.string().min(1),
  language: z.enum(['javascript-fetch', 'python-requests']),
}).strict()

const failure = (code: string, message: string) => ({
  ok: false as const,
  error: { code, category: 'code-generation' as const, message, retryable: false as const },
})

export function registerCodeGenerationHandlers(repo: Repository): void {
  ipcMain.handle('code-generation:preview', (_event, input) => {
    const checked = validate(inputSchema, input)
    if (!checked.ok) return checked
    const row = repo.getSavedRequestForExport(checked.data.requestId, checked.data.workspaceId)
    if (!row) return failure('REQUEST_NOT_FOUND', 'Saved request is not available.')
    try {
      return {
        ok: true as const,
        data: generateCode(
          mapSavedRequestToExportAsset(row as SavedRequestAssetRow),
          checked.data.language,
        ),
      }
    } catch {
      return failure('GENERATION_FAILED', 'Code could not be generated.')
    }
  })
}
