import { randomUUID } from 'node:crypto'
import { open, stat } from 'node:fs/promises'
import { dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { WORKSPACE_IMPORT_LIMITS, type WorkspaceImportMode } from '../../shared/assets/workspace-import'
import type { Repository } from '../repository'
import { validate } from './validate'

const previewInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('create-workspace') }).strict(),
  z.object({ mode: z.literal('merge-into-workspace'), targetWorkspaceId: z.string().min(1) }).strict(),
])
const applyInput = z.object({ previewId: z.string().uuid() }).strict()
const failure = (code: string, message: string) => ({
  ok: false as const,
  error: { code, category: 'import' as const, message, retryable: false as const },
})

const readBounded = async (filePath: string): Promise<string | null> => {
  const metadata = await stat(filePath)
  if (!metadata.isFile() || metadata.size > WORKSPACE_IMPORT_LIMITS.maxSourceBytes) return null
  const file = await open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(WORKSPACE_IMPORT_LIMITS.maxSourceBytes + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    return bytesRead > WORKSPACE_IMPORT_LIMITS.maxSourceBytes ? null : buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await file.close()
  }
}

export function registerWorkspaceImportHandlers(repo: Repository): void {
  const previews = new WeakMap<object, {
    id: string
    source: string
    mode: WorkspaceImportMode
    targetWorkspaceId?: string
  }>()
  const applying = new WeakSet<object>()

  ipcMain.handle('workspace-import:preview', async (event, input) => {
    previews.delete(event.sender)
    const checked = validate(previewInput, input)
    if (!checked.ok) return checked
    try {
      const selected = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Request Studio Workspace', extensions: ['json'] }],
      })
      if (selected.canceled || selected.filePaths.length !== 1) {
        return { ok: true as const, data: { selected: false as const } }
      }
      const source = await readBounded(selected.filePaths[0])
      if (source === null) return failure('INPUT_TOO_LARGE', 'Workspace import source exceeds the size limit.')
      const targetWorkspaceId = checked.data.mode === 'merge-into-workspace'
        ? checked.data.targetWorkspaceId
        : undefined
      const result = repo.previewWorkspaceImport(source, checked.data.mode, targetWorkspaceId)
      if (!result.ok) return failure(result.error.code, result.error.message)
      const latest = { id: randomUUID(), source, mode: checked.data.mode, targetWorkspaceId }
      previews.set(event.sender, latest)
      const { bundle, dryRun } = result
      return {
        ok: true as const,
        data: {
          selected: true as const,
          previewId: latest.id,
          preview: {
            format: bundle.format,
            version: bundle.version,
            workspaceName: bundle.workspace.name,
            counts: {
              collections: dryRun.summary.collectionCount,
              requests: dryRun.summary.requestCount,
              environments: dryRun.summary.environmentCount,
              variables: dryRun.summary.variableCount,
            },
            warnings: dryRun.warnings,
            conflicts: dryRun.conflicts.map(({ code, entityType, displayName }) => ({
              code,
              entity: entityType,
              name: displayName,
            })),
            blockedOperationCount: dryRun.operations.filter(({ status }) => status === 'blocked').length,
          },
        },
      }
    } catch {
      return failure('FILE_READ_FAILED', 'Workspace import file could not be read.')
    }
  })

  ipcMain.handle('workspace-import:apply', async (event, input) => {
    const checked = validate(applyInput, input)
    if (!checked.ok) return checked
    const latest = previews.get(event.sender)
    if (!latest || latest.id !== checked.data.previewId) {
      return failure('PREVIEW_EXPIRED', 'Select and preview the Workspace file again before importing.')
    }
    if (applying.has(event.sender)) {
      return failure('IMPORT_IN_PROGRESS', 'A Workspace import is already in progress.')
    }
    applying.add(event.sender)
    try {
      const result = await Promise.resolve(repo.applyWorkspaceImport(latest.mode === 'merge-into-workspace'
        ? { source: latest.source, mode: latest.mode, targetWorkspaceId: latest.targetWorkspaceId! }
        : { source: latest.source, mode: latest.mode }))
      if (!result.ok) return failure(result.error.code, result.error.message)
      previews.delete(event.sender)
      return {
        ok: true as const,
        data: {
          mode: result.apply.mode,
          counts: {
            collections: result.apply.summary.collectionCount,
            requests: result.apply.summary.requestCount,
            environments: result.apply.summary.environmentCount,
            variables: result.apply.summary.variableCount,
          },
        },
      }
    } catch {
      return failure('TRANSACTION_FAILED', 'Workspace import transaction failed.')
    } finally {
      applying.delete(event.sender)
    }
  })
}
