import { randomUUID } from 'node:crypto'
import { dialog, ipcMain } from 'electron'
import { z } from 'zod'
import {
  mapWorkspaceExportV1,
  serializeWorkspaceExportV1Chunks,
  type WorkspaceExportV1,
} from '../../shared/assets/workspace-export'
import type { Repository } from '../repository'
import { sanitizeExportFilename, writeExportFileAtomic } from '../export/request-export-file'
import { validate } from './validate'

const PREVIEW_LIMIT_BYTES = 32 * 1024
const previewInput = z.object({ workspaceId: z.string().min(1) }).strict()
const saveInput = z.object({ previewId: z.string().uuid() }).strict()
const failure = (code: string, message: string) => ({
  ok: false as const,
  error: { code, category: 'export' as const, message, retryable: false as const },
})

const previewContent = (bundle: WorkspaceExportV1): { content: string; truncated: boolean } => {
  let content = ''
  let bytes = 0
  for (const chunk of serializeWorkspaceExportV1Chunks(bundle)) {
    const chunkBytes = Buffer.byteLength(chunk, 'utf8')
    if (bytes + chunkBytes <= PREVIEW_LIMIT_BYTES) {
      content += chunk
      bytes += chunkBytes
      continue
    }
    let remaining = PREVIEW_LIMIT_BYTES - bytes
    for (const character of chunk) {
      const characterBytes = Buffer.byteLength(character, 'utf8')
      if (characterBytes > remaining) break
      content += character
      remaining -= characterBytes
    }
    return { content, truncated: true }
  }
  return { content, truncated: false }
}

const createPreview = (bundle: WorkspaceExportV1) => {
  const bounded = previewContent(bundle)
  const sanitized = bundle.environments.some((environment) =>
    environment.variables.some((variable) => variable.isSecret),
  ) || bundle.requests.some((request) => JSON.stringify(request.asset).includes('[REDACTED]'))
  return {
    format: bundle.format,
    version: bundle.version,
    workspaceName: bundle.workspace.name,
    counts: {
      collections: bundle.collections.length,
      requests: bundle.requests.length,
      environments: bundle.environments.length,
    },
    warnings: [
      ...(sanitized
        ? [{ code: 'sanitized-values', message: 'Sensitive values and local file references were sanitized.' }]
        : []),
      ...(bounded.truncated
        ? [{ code: 'preview-truncated', message: 'Preview is truncated; the saved file contains the complete bundle.' }]
        : []),
    ],
    ...bounded,
  }
}

export function registerWorkspaceExportHandlers(repo: Repository, userData: string): void {
  const previews = new WeakMap<object, { id: string; bundle: WorkspaceExportV1; filename: string }>()
  const saving = new WeakSet<object>()

  ipcMain.handle('workspace-export:preview', (event, input) => {
    previews.delete(event.sender)
    const checked = validate(previewInput, input)
    if (!checked.ok) return checked
    const source = repo.getWorkspaceExportSource(checked.data.workspaceId)
    if (!source) return failure('WORKSPACE_NOT_FOUND', 'Workspace is not available.')
    try {
      const bundle = mapWorkspaceExportV1(source)
      const latest = {
        id: randomUUID(),
        bundle,
        filename: sanitizeExportFilename(`${bundle.workspace.name}.request-studio.workspace.json`),
      }
      previews.set(event.sender, latest)
      return { ok: true as const, data: { previewId: latest.id, preview: createPreview(bundle) } }
    } catch {
      return failure('WORKSPACE_NOT_FOUND', 'Workspace is not available.')
    }
  })

  ipcMain.handle('workspace-export:save', async (event, input) => {
    const checked = validate(saveInput, input)
    if (!checked.ok) return checked
    const latest = previews.get(event.sender)
    if (!latest || latest.id !== checked.data.previewId) {
      return failure('PREVIEW_EXPIRED', 'Preview the workspace again before saving.')
    }
    if (saving.has(event.sender)) {
      return failure('SAVE_IN_PROGRESS', 'A workspace export is already being saved.')
    }
    saving.add(event.sender)
    try {
      const result = await dialog.showSaveDialog({
        defaultPath: latest.filename,
        filters: [{ name: 'Request Studio Workspace', extensions: ['json'] }],
      })
      if (result.canceled || !result.filePath) return { ok: true as const, data: { saved: false } }
      await writeExportFileAtomic(
        result.filePath,
        serializeWorkspaceExportV1Chunks(latest.bundle),
        userData,
      )
      previews.delete(event.sender)
      return { ok: true as const, data: { saved: true } }
    } catch {
      return failure('SAVE_FAILED', 'Workspace export could not be saved.')
    } finally {
      saving.delete(event.sender)
    }
  })
}
