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
import { registerRequestExportHandlers } from './request-export-handlers'

const roots: string[] = []
const event = { sender: {} }
const websocketConfig = {
  subprotocols: [],
  connectTimeoutMs: 10000,
  idleTimeoutMs: 0,
  pingEnabled: false,
  pingIntervalMs: 30000,
  autoReconnect: false,
  maxReconnectAttempts: 3,
  reconnectDelayMs: 1000,
  maxMessageBytes: 1048576,
}
const sseConfig = {
  method: 'GET',
  body: { type: 'none' },
  connectTimeoutMs: 10000,
  idleTimeoutMs: 60000,
  maxEventBytes: 1048576,
  maxSessionDurationMs: 1800000,
}

const setup = () => {
  const root = mkdtempSync(join(tmpdir(), 'request-studio-export-ipc-'))
  const userData = join(root, 'user-data')
  mkdirSync(userData)
  roots.push(root)
  const db = createDatabase(':memory:')
  const repo = new Repository(db)
  repo.create('workspaces', { id: 'workspace-a', name: 'Workspace A' })
  repo.create('workspaces', { id: 'workspace-b', name: 'Workspace B' })
  repo.create('collections', { id: 'collection-a', workspace_id: 'workspace-a', name: 'API' })
  const common = {
    workspace_id: 'workspace-a',
    collection_id: 'collection-a',
    name: 'Users Request',
    url: 'https://api.example.com/users',
    description: 'file=C:\\Users\\me\\private.txt',
    params_json: '[]',
    headers_json: '[]',
    auth_json: JSON.stringify({ type: 'bearer', token: 'raw-ipc-secret' }),
    body_json: JSON.stringify({ type: 'none' }),
    settings_json: JSON.stringify({ timeoutMs: 30000 }),
  }
  repo.create('saved_requests', {
    id: 'request-http',
    ...common,
    protocol: 'http',
    method: 'GET',
    stream_config_json: '{}',
  })
  repo.create('saved_requests', {
    id: 'request-websocket',
    ...common,
    protocol: 'websocket',
    method: null,
    url: 'wss://api.example.com/events',
    stream_config_json: JSON.stringify(websocketConfig),
  })
  repo.create('saved_requests', {
    id: 'request-sse',
    ...common,
    protocol: 'sse',
    method: 'GET',
    stream_config_json: JSON.stringify(sseConfig),
  })
  registerRequestExportHandlers(repo, userData)
  return { db, root, userData }
}

const preview = (input: Record<string, unknown>, sender = event) =>
  handlers.get('request-export:preview')!(sender, input)
const save = (previewId: string, sender = event) =>
  handlers.get('request-export:save')!(sender, { previewId })

beforeEach(() => {
  handlers.clear()
  showSaveDialog.mockReset()
})
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

it('previews sanitized cURL and saves the exact reviewed content once', async () => {
  const { db, root } = setup()
  const result = await preview({
    workspaceId: 'workspace-a',
    requestId: 'request-http',
    format: 'curl',
  })
  expect(result).toMatchObject({
    ok: true,
    data: { preview: { format: 'curl', filenameSuggestion: 'users-request.sh' } },
  })
  expect(result.data.previewId).toMatch(/^[0-9a-f-]{36}$/)
  expect(JSON.stringify(result)).not.toMatch(
    /raw-ipc-secret|request-http|workspace-a|C:\\\\Users/,
  )

  const destination = join(root, 'saved.sh')
  showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination })
  expect(await save(result.data.previewId)).toEqual({ ok: true, data: { saved: true } })
  expect(readFileSync(destination, 'utf8')).toBe(result.data.preview.content)
  expect(await save(result.data.previewId)).toMatchObject({
    ok: false,
    error: { code: 'PREVIEW_EXPIRED' },
  })
  db.close()
})

it.each([
  ['request-http', 'http'],
  ['request-websocket', 'websocket'],
  ['request-sse', 'sse'],
])('previews Request JSON for %s', async (requestId, protocol) => {
  const { db } = setup()
  const result = await preview({ workspaceId: 'workspace-a', requestId, format: 'request-json' })
  expect(result).toMatchObject({ ok: true, data: { preview: { format: 'request-json', protocol } } })
  expect(JSON.parse(result.data.preview.content).protocol).toBe(protocol)
  expect(JSON.stringify(result)).not.toContain('raw-ipc-secret')
  db.close()
})

it('rejects invalid formats and missing or cross-workspace requests safely', async () => {
  const { db } = setup()
  expect(
    await preview({ workspaceId: 'workspace-a', requestId: 'request-http', format: 'har' }),
  ).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
  for (const input of [
    { workspaceId: 'workspace-a', requestId: 'missing', format: 'curl' },
    { workspaceId: 'workspace-b', requestId: 'request-http', format: 'curl' },
  ]) {
    expect(await preview(input)).toMatchObject({
      ok: false,
      error: { code: 'REQUEST_NOT_FOUND' },
    })
  }
  db.close()
})

it('isolates previews by sender and preserves a preview after cancellation', async () => {
  const { db, root } = setup()
  const owner = { sender: {} }
  const other = { sender: {} }
  const result = await preview(
    { workspaceId: 'workspace-a', requestId: 'request-http', format: 'curl' },
    owner,
  )
  expect(await save(result.data.previewId, other)).toMatchObject({
    ok: false,
    error: { code: 'PREVIEW_EXPIRED' },
  })
  showSaveDialog.mockResolvedValueOnce({ canceled: true })
  expect(await save(result.data.previewId, owner)).toEqual({ ok: true, data: { saved: false } })
  showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: join(root, 'saved.sh') })
  expect(await save(result.data.previewId, owner)).toEqual({ ok: true, data: { saved: true } })
  db.close()
})

it('returns a fixed safe error when the selected destination cannot be written', async () => {
  const { db, userData } = setup()
  const result = await preview({
    workspaceId: 'workspace-a',
    requestId: 'request-http',
    format: 'curl',
  })
  showSaveDialog.mockResolvedValue({ canceled: false, filePath: join(userData, 'blocked.sh') })
  const saved = await save(result.data.previewId)
  expect(saved).toMatchObject({ ok: false, error: { code: 'SAVE_FAILED' } })
  expect(JSON.stringify(saved)).not.toMatch(/blocked\.sh|user-data|raw-ipc-secret/)
  db.close()
})

it('rejects a concurrent save and restores retry after cancellation', async () => {
  const { db, root } = setup()
  const result = await preview({
    workspaceId: 'workspace-a',
    requestId: 'request-http',
    format: 'curl',
  })
  let finishDialog!: (result: { canceled: boolean; filePath?: string }) => void
  showSaveDialog.mockReturnValueOnce(
    new Promise((resolve) => {
      finishDialog = resolve
    }),
  )
  const first = save(result.data.previewId)
  expect(await save(result.data.previewId)).toMatchObject({
    ok: false,
    error: { code: 'SAVE_IN_PROGRESS' },
  })
  finishDialog({ canceled: true })
  expect(await first).toEqual({ ok: true, data: { saved: false } })
  showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: join(root, 'retry.sh') })
  expect(await save(result.data.previewId)).toEqual({ ok: true, data: { saved: true } })
  db.close()
})
