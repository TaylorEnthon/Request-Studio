import { beforeEach, expect, it, vi } from 'vitest'
import { createDatabase } from '../database/database'
import { Repository } from '../repository'

const handlers = new Map<string, (event: unknown, input: unknown) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: (event: unknown, input: unknown) => unknown) => handlers.set(channel, handler) },
}))
import { registerCodeGenerationHandlers } from './code-generation-handlers'

const setup = () => {
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
    headers_json: JSON.stringify([{ id: 'header-1', enabled: true, key: 'X-Api-Key', value: 'raw-codegen-secret', description: '' }]),
    auth_json: JSON.stringify({ type: 'bearer', token: 'raw-codegen-token' }),
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
    stream_config_json: JSON.stringify({
      subprotocols: [], connectTimeoutMs: 10000, idleTimeoutMs: 0,
      pingEnabled: false, pingIntervalMs: 30000, autoReconnect: false,
      maxReconnectAttempts: 3, reconnectDelayMs: 1000, maxMessageBytes: 1048576,
    }),
  })
  registerCodeGenerationHandlers(repo)
  return db
}

const preview = (input: Record<string, unknown>) =>
  handlers.get('code-generation:preview')!({}, input) as any

beforeEach(() => handlers.clear())

it.each([
  ['javascript-fetch', 'fetch('],
  ['python-requests', 'requests.request('],
])('previews sanitized %s code for an owned request', (language, marker) => {
  const db = setup()
  const result = preview({ workspaceId: 'workspace-a', requestId: 'request-http', language })
  expect(result).toMatchObject({ ok: true, data: { language } })
  expect(result.data.content).toContain(marker)
  expect(JSON.stringify(result)).not.toMatch(
    /raw-codegen-secret|raw-codegen-token|C:\\\\Users|request-http|workspace-a/,
  )
  expect(result.data.content).toContain('[REDACTED]')
  db.close()
})

it('rejects an invalid language before repository access', () => {
  const db = setup()
  expect(preview({ workspaceId: 'workspace-a', requestId: 'request-http', language: 'ruby' }))
    .toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
  db.close()
})

it('rejects missing and cross-workspace requests with the same safe error', () => {
  const db = setup()
  for (const input of [
    { workspaceId: 'workspace-a', requestId: 'missing', language: 'javascript-fetch' },
    { workspaceId: 'workspace-b', requestId: 'request-http', language: 'javascript-fetch' },
  ]) {
    expect(preview(input)).toMatchObject({
      ok: false,
      error: { code: 'REQUEST_NOT_FOUND', message: 'Saved request is not available.' },
    })
  }
  db.close()
})

it('returns a fixed error for unsupported request protocols', () => {
  const db = setup()
  const result = preview({
    workspaceId: 'workspace-a',
    requestId: 'request-websocket',
    language: 'javascript-fetch',
  })
  expect(result).toMatchObject({
    ok: false,
    error: { code: 'GENERATION_FAILED', message: 'Code could not be generated.' },
  })
  expect(JSON.stringify(result)).not.toMatch(/raw-codegen|request-websocket|workspace-a/)
  db.close()
})
