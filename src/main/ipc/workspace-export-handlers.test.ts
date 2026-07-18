import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase } from '../database/database'
import { Repository } from '../repository'

const handlers = new Map<string, (event: any, input: unknown) => any>()
const showSaveDialog = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: any) => handlers.set(channel, handler) },
  dialog: { showSaveDialog },
}))
import { registerWorkspaceExportHandlers } from './workspace-export-handlers'

const roots: string[] = []
const owner = { sender: {} }
const websocketConfig = JSON.stringify({
  subprotocols: [],
  connectTimeoutMs: 10000,
  idleTimeoutMs: 0,
  pingEnabled: false,
  pingIntervalMs: 30000,
  autoReconnect: false,
  maxReconnectAttempts: 3,
  reconnectDelayMs: 1000,
  maxMessageBytes: 1048576,
})

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'request-studio-workspace-export-ipc-'))
  const userData = join(root, 'user-data')
  mkdirSync(userData)
  roots.push(root)
  const db = createDatabase(':memory:')
  const repo = new Repository(db)
  repo.create('workspaces', { id: 'workspace-a-db-id', name: 'Workspace A' })
  repo.create('workspaces', { id: 'workspace-b-db-id', name: 'Workspace B' })
  repo.create('collections', { id: 'collection-a-db-id', workspace_id: 'workspace-a-db-id', name: 'API' })
  repo.create('environments', { id: 'environment-a-db-id', workspace_id: 'workspace-a-db-id', name: 'Local' })
  repo.create('environment_variables', {
    id: 'variable-a-db-id',
    environment_id: 'environment-a-db-id',
    key: 'TOKEN',
    value: 'raw-workspace-secret',
    is_secret: 1,
    description: 'file=C:\\Users\\Alice\\private.txt',
  })
  repo.create('saved_requests', {
    id: 'request-a-db-id',
    workspace_id: 'workspace-a-db-id',
    collection_id: 'collection-a-db-id',
    name: 'Users',
    description: 'password=raw-description-secret',
    protocol: 'websocket',
    method: null,
    url: 'wss://api.example.test/events',
    params_json: '[]',
    headers_json: JSON.stringify([{ id: 'h1', enabled: true, key: 'Authorization', value: 'raw-header-secret' }]),
    auth_json: JSON.stringify({ type: 'bearer', token: 'raw-auth-secret' }),
    body_json: JSON.stringify({ type: 'none' }),
    settings_json: JSON.stringify({ timeoutMs: 30000 }),
    stream_config_json: websocketConfig,
  })
  registerWorkspaceExportHandlers(repo, userData)
  return { db, repo, root, userData }
}

const preview = (input: unknown, event = owner) => handlers.get('workspace-export:preview')!(event, input)
const save = (previewId: string, event = owner) => handlers.get('workspace-export:save')!(event, { previewId })

beforeEach(() => {
  handlers.clear()
  showSaveDialog.mockReset()
})
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('previews counts and atomically saves the exact sanitized workspace bundle', async () => {
  const { db, root } = setup()
  const result = await preview({ workspaceId: 'workspace-a-db-id' })
  expect(result).toMatchObject({
    ok: true,
    data: {
      preview: {
        format: 'request-studio.workspace',
        version: 1,
        workspaceName: 'Workspace A',
        counts: { collections: 1, requests: 1, environments: 1 },
        truncated: false,
      },
    },
  })
  expect(result.data.previewId).toMatch(/^[0-9a-f-]{36}$/)
  expect(result.data.preview.warnings).toContainEqual({
    code: 'sanitized-values',
    message: 'Sensitive values and local file references were sanitized.',
  })
  expect(JSON.stringify(result)).not.toMatch(
    /raw-(?:workspace|description|header|auth)-secret|workspace-a-db-id|collection-a-db-id|Users\\\\Alice/,
  )

  const destination = join(root, 'workspace.json')
  showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination })
  expect(await save(result.data.previewId)).toEqual({ ok: true, data: { saved: true } })
  const saved = JSON.parse(readFileSync(destination, 'utf8'))
  expect(saved).toMatchObject({ format: 'request-studio.workspace', version: 1, workspace: { name: 'Workspace A' } })
  expect(JSON.stringify(saved)).not.toMatch(/raw-(?:workspace|description|header|auth)-secret|Users\\\\Alice/)
  expect(await save(result.data.previewId)).toMatchObject({ ok: false, error: { code: 'PREVIEW_EXPIRED' } })
  db.close()
})

it('rejects invalid, missing, and invalidly related workspaces with fixed errors', async () => {
  const { db, repo } = setup()
  expect(await preview({ workspaceId: '' })).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
  expect(await preview({ workspaceId: 'missing' })).toMatchObject({ ok: false, error: { code: 'WORKSPACE_NOT_FOUND' } })
  const original = repo.getWorkspaceExportSource.bind(repo)
  vi.spyOn(repo, 'getWorkspaceExportSource').mockImplementation((id) => {
    const source = original(id)
    return source ? { ...source, collections: [{ ...source.collections[0], workspace_id: 'other' }] } : source
  })
  expect(await preview({ workspaceId: 'workspace-a-db-id' })).toMatchObject({
    ok: false,
    error: { code: 'WORKSPACE_NOT_FOUND' },
  })
  db.close()
})

it('keeps workspace data isolated and previews large bundles with a fixed bound', async () => {
  const { db, repo } = setup()
  repo.create('collections', { id: 'collection-b-db-id', workspace_id: 'workspace-b-db-id', name: 'Private B' })
  for (let index = 0; index < 100; index += 1) {
    repo.create('saved_requests', {
      id: `request-b-${index}`,
      workspace_id: 'workspace-b-db-id',
      collection_id: 'collection-b-db-id',
      name: `Request ${index}`,
      description: '🙂'.repeat(400),
      protocol: 'http', method: 'GET', url: 'https://example.test', params_json: '[]', headers_json: '[]',
      auth_json: '{"type":"none"}', body_json: '{"type":"none"}', settings_json: '{"timeoutMs":30000}', stream_config_json: '{}',
    })
  }
  const result = await preview({ workspaceId: 'workspace-b-db-id' })
  expect(result).toMatchObject({ ok: true, data: { preview: { workspaceName: 'Workspace B', counts: { collections: 1, requests: 100, environments: 0 }, truncated: true } } })
  expect(Buffer.byteLength(result.data.preview.content, 'utf8')).toBeLessThanOrEqual(32 * 1024)
  expect(result.data.preview.content).not.toContain('\uFFFD')
  expect(JSON.stringify(result)).not.toMatch(/Workspace A|workspace-a-db-id|raw-workspace-secret/)
  db.close()
})

it('isolates preview capabilities by sender and keeps one after cancellation', async () => {
  const { db, root } = setup()
  const first = { sender: {} }
  const other = { sender: {} }
  const result = await preview({ workspaceId: 'workspace-a-db-id' }, first)
  expect(await save(result.data.previewId, other)).toMatchObject({ ok: false, error: { code: 'PREVIEW_EXPIRED' } })
  showSaveDialog.mockResolvedValueOnce({ canceled: true })
  expect(await save(result.data.previewId, first)).toEqual({ ok: true, data: { saved: false } })
  showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: join(root, 'retry.json') })
  expect(await save(result.data.previewId, first)).toEqual({ ok: true, data: { saved: true } })
  db.close()
})

it('rejects concurrent saves and returns fixed write failures without paths', async () => {
  const { db, userData } = setup()
  const result = await preview({ workspaceId: 'workspace-a-db-id' })
  let finishDialog!: (value: { canceled: boolean }) => void
  showSaveDialog.mockReturnValueOnce(new Promise((resolve) => { finishDialog = resolve }))
  const first = save(result.data.previewId)
  expect(await save(result.data.previewId)).toMatchObject({ ok: false, error: { code: 'SAVE_IN_PROGRESS' } })
  finishDialog({ canceled: true })
  await first
  showSaveDialog.mockResolvedValue({ canceled: false, filePath: join(userData, 'blocked.json') })
  const failed = await save(result.data.previewId)
  expect(failed).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } })
  expect(JSON.stringify(failed)).not.toMatch(/blocked\.json|user-data|raw-workspace-secret/)
  db.close()
})
