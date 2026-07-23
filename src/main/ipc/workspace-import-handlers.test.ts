import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase } from '../database/database'
import { Repository } from '../repository'

const handlers = new Map<string, (event: any, input: unknown) => any>()
const showOpenDialog = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: any) => handlers.set(channel, handler) },
  dialog: { showOpenDialog },
}))
import { registerWorkspaceImportHandlers } from './workspace-import-handlers'

const roots: string[] = []
const owner = { sender: {} }
const bundle = () => ({
  format: 'request-studio.workspace', version: 1,
  workspace: { name: 'Imported Workspace' },
  collections: [{ ref: 'collection-1', name: 'API' }],
  requests: [{
    collectionRef: 'collection-1',
    asset: {
      format: 'request-studio.request', version: 1, protocol: 'http', name: 'Users', description: '',
      request: { method: 'GET', url: 'https://api.example.test/users', params: [], headers: [], auth: { type: 'none' }, body: { type: 'none' }, settings: { timeoutMs: 30000 } },
    },
  }],
  environments: [{ name: 'Local', variables: [{ key: 'TOKEN', value: '', isSecret: true, description: '' }] }],
})

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'request-studio-workspace-import-ipc-'))
  roots.push(root)
  const file = join(root, 'workspace.json')
  writeFileSync(file, JSON.stringify(bundle()))
  const db = createDatabase(':memory:')
  const repo = new Repository(db)
  registerWorkspaceImportHandlers(repo)
  return { db, repo, file, root }
}
const preview = (input: unknown, event = owner) => handlers.get('workspace-import:preview')!(event, input)
const apply = (previewId: string, event = owner) => handlers.get('workspace-import:apply')!(event, { previewId })

beforeEach(() => {
  handlers.clear()
  showOpenDialog.mockReset()
})
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('previews safe Workspace metadata from a Main-owned file capability', async () => {
  const { db, file } = setup()
  showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [file] })
  const result = await preview({ mode: 'create-workspace' })
  expect(result).toMatchObject({
    ok: true,
    data: {
      selected: true,
      preview: {
        format: 'request-studio.workspace', version: 1, workspaceName: 'Imported Workspace',
        counts: { collections: 1, requests: 1, environments: 1, variables: 1 },
        warnings: [], conflicts: [], blockedOperationCount: 0,
      },
    },
  })
  expect(result.data.previewId).toMatch(/^[0-9a-f-]{36}$/)
  expect(JSON.stringify(result)).not.toMatch(/workspace\.json|request-studio-workspace-import-ipc|collection-1|sourceRef|TOKEN/)
  expect(db.prepare('SELECT count(*) count FROM workspaces').get()).toEqual({ count: 0 })
  db.close()
})

it('reports cancellation and fixed file or input failures without local paths', async () => {
  const { db, root } = setup()
  showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
  expect(await preview({ mode: 'create-workspace' })).toEqual({ ok: true, data: { selected: false } })
  expect(await preview({ mode: 'merge-into-workspace' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
  const missing = join(root, 'private-missing.json')
  showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [missing] })
  const failed = await preview({ mode: 'create-workspace' })
  expect(failed).toMatchObject({ ok: false, error: { code: 'FILE_READ_FAILED' } })
  expect(JSON.stringify(failed)).not.toMatch(/private-missing|request-studio-workspace-import-ipc/)
  db.close()
})

it('rejects oversized and unsafe bundles before returning imported text', async () => {
  const { db, file, root } = setup()
  const oversized = join(root, 'oversized.json')
  writeFileSync(oversized, Buffer.alloc(16 * 1024 * 1024 + 1))
  showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [oversized] })
  expect(await preview({ mode: 'create-workspace' })).toMatchObject({ ok: false, error: { code: 'INPUT_TOO_LARGE' } })

  const unsafe = bundle()
  unsafe.workspace.name = 'C:\\Users\\Example\\private.json'
  writeFileSync(file, JSON.stringify(unsafe))
  showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [file] })
  const failed = await preview({ mode: 'create-workspace' })
  expect(failed).toMatchObject({ ok: false, error: { code: 'UNSAFE_IMPORT_CONTENT' } })
  expect(JSON.stringify(failed)).not.toMatch(/Users|private\.json/)
  db.close()
})

it('returns safe conflicts and blocks cross-sender or repeated apply', async () => {
  const { db, repo, file } = setup()
  repo.create('workspaces', { id: 'target-db-id', name: 'Target' })
  repo.create('collections', { id: 'collection-db-id', workspace_id: 'target-db-id', name: 'API' })
  showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [file] })
  const conflicted = await preview({ mode: 'merge-into-workspace', targetWorkspaceId: 'target-db-id' })
  expect(conflicted).toMatchObject({
    ok: true,
    data: { preview: { conflicts: [{ code: 'COLLECTION_NAME_CONFLICT', entity: 'collection', name: 'API' }], blockedOperationCount: 2 } },
  })
  expect(JSON.stringify(conflicted)).not.toMatch(/target-db-id|collection-db-id|sourceRef/)

  const cleanOwner = { sender: {} }
  const other = { sender: {} }
  const clean = await preview({ mode: 'create-workspace' }, cleanOwner)
  expect(await apply(clean.data.previewId, other)).toMatchObject({ ok: false, error: { code: 'PREVIEW_EXPIRED' } })
  expect(await apply(clean.data.previewId, cleanOwner)).toMatchObject({ ok: true, data: { mode: 'create-workspace' } })
  expect(await apply(clean.data.previewId, cleanOwner)).toMatchObject({ ok: false, error: { code: 'PREVIEW_EXPIRED' } })
  db.close()
})

it('keeps the preview available after a fixed transaction failure', async () => {
  const { db, file } = setup()
  db.exec("CREATE TRIGGER reject_workspace BEFORE INSERT ON workspaces BEGIN SELECT RAISE(ABORT, 'C:\\private-secret.json'); END")
  showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [file] })
  const selected = await preview({ mode: 'create-workspace' })
  const failed = await apply(selected.data.previewId)
  expect(failed).toMatchObject({ ok: false, error: { code: 'TRANSACTION_FAILED' } })
  expect(JSON.stringify(failed)).not.toMatch(/private-secret|CREATE TRIGGER/)
  expect(await apply(selected.data.previewId)).toMatchObject({ ok: false, error: { code: 'TRANSACTION_FAILED' } })
  db.close()
})
