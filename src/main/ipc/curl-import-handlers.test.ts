import { beforeEach, expect, it, vi } from 'vitest'
import { createDatabase } from '../database/database'
import { Repository } from '../repository'

const handlers = new Map<string, (_event: unknown, input: unknown) => unknown>()
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: any) => handlers.set(channel, handler) },
}))
import { registerCurlImportHandlers } from './curl-import-handlers'

const secret = 'fixture-secret-value'
const source = `curl -H 'Authorization: Bearer ${secret}' https://example.test/items`
const defaultEvent = { sender: {} }

const setup = () => {
  const db = createDatabase(':memory:'), repo = new Repository(db)
  repo.create('workspaces', { id: 'w', name: 'Workspace' })
  repo.create('workspaces', { id: 'other', name: 'Other' })
  repo.create('collections', { id: 'c', workspace_id: 'w', name: 'API' })
  repo.create('collections', { id: 'other-c', workspace_id: 'other', name: 'Other API' })
  repo.create('environments', { id: 'e', workspace_id: 'w', name: 'Local' })
  repo.create('environments', { id: 'other-e', workspace_id: 'other', name: 'Other Local' })
  registerCurlImportHandlers(repo)
  return { db, repo }
}

const preview = () =>
  handlers.get('curl-import:preview')!(defaultEvent, { source, dialect: 'auto' }) as Promise<any>

beforeEach(() => handlers.clear())

it('previews sanitized cURL and imports it once through the existing transaction', async () => {
  const { db, repo } = setup()
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const result = await preview()
  expect(result.ok).toBe(true)
  expect(result.data.previewId).toMatch(/^[0-9a-f-]{36}$/)
  expect(JSON.stringify(result)).not.toContain(secret)

  const input = {
    previewId: result.data.previewId,
    workspaceId: 'w',
    collectionId: 'c',
    environmentId: 'e',
    name: 'Imported request',
    variableMappings: [{ placeholder: '{{TOKEN}}', variableName: 'API_TOKEN' }],
  }
  const saved: any = await handlers.get('curl-import:save')!(defaultEvent, input)
  expect(saved.ok).toBe(true)
  expect(saved.data.request.name).toBe('Imported request')
  expect(repo.list('environment_variables', 'environment_id', 'e')).toMatchObject([
    { key: 'API_TOKEN', value: '', is_secret: 1 },
  ])
  expect(JSON.stringify(saved)).not.toContain(secret)
  expect(await handlers.get('curl-import:save')!(defaultEvent, input)).toMatchObject({
    ok: false,
    error: { code: 'PREVIEW_EXPIRED' },
  })
  expect(logged).not.toHaveBeenCalled()
  logged.mockRestore()
  db.close()
})

it('returns fixed safe errors for invalid input and parser rejection', async () => {
  const { db } = setup()
  const invalid: any = await handlers.get('curl-import:preview')!(defaultEvent, {
    source,
    dialect: 'fish',
  })
  expect(invalid).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
  expect(JSON.stringify(invalid)).not.toContain(secret)

  const rejected: any = await handlers.get('curl-import:preview')!(defaultEvent, {
    source: 'curl --data @credentials.txt https://example.test',
    dialect: 'auto',
  })
  expect(rejected).toMatchObject({ ok: false, error: { code: 'CURL_FILE_REFERENCE' } })
  expect(JSON.stringify(rejected)).not.toContain('credentials.txt')
  db.close()
})

it('rejects collection and environment ownership mismatches without consuming the preview', async () => {
  const { db, repo } = setup()
  const first = await preview()
  const base = {
    previewId: first.data.previewId,
    workspaceId: 'w',
    environmentId: 'e',
    name: 'Imported request',
    variableMappings: [{ placeholder: '{{TOKEN}}', variableName: 'API_TOKEN' }],
  }
  expect(
    await handlers.get('curl-import:save')!(defaultEvent, {
      ...base,
      workspaceId: 'other',
      collectionId: 'c',
    }),
  ).toMatchObject({ ok: false, error: { code: 'IMPORT_FAILED' } })
  expect(repo.list('saved_requests', 'workspace_id', 'w')).toHaveLength(0)

  expect(await handlers.get('curl-import:save')!(defaultEvent, { ...base, collectionId: 'other-c' })).toMatchObject({
    ok: false,
    error: { code: 'IMPORT_FAILED' },
  })
  expect(repo.list('saved_requests', 'workspace_id', 'w')).toHaveLength(0)

  expect(
    await handlers.get('curl-import:save')!(defaultEvent, {
      ...base,
      collectionId: 'c',
      environmentId: 'other-e',
    }),
  ).toMatchObject({ ok: false, error: { code: 'IMPORT_FAILED' } })
  expect(repo.list('saved_requests', 'workspace_id', 'w')).toHaveLength(0)
  db.close()
})

it('isolates preview capabilities by renderer sender', async () => {
  const { db } = setup()
  const firstSender = { sender: {} }, secondSender = { sender: {} }
  const result: any = await handlers.get('curl-import:preview')!(firstSender, { source, dialect: 'auto' })
  const input = {
    previewId: result.data.previewId,
    workspaceId: 'w',
    collectionId: 'c',
    environmentId: 'e',
    name: 'Imported request',
    variableMappings: [{ placeholder: '{{TOKEN}}', variableName: 'API_TOKEN' }],
  }
  expect(await handlers.get('curl-import:save')!(secondSender, input)).toMatchObject({
    ok: false,
    error: { code: 'PREVIEW_EXPIRED' },
  })
  expect(await handlers.get('curl-import:save')!(firstSender, input)).toMatchObject({ ok: true })
  db.close()
})
