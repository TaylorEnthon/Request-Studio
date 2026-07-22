import { describe, expect, it } from 'vitest'
import { createWorkspaceImportDryRun, parseWorkspaceImportSource } from './workspace-import'
import { mapSavedRequestToAsset, type SavedRequestAssetRow } from './request-asset-mapper'
import {
  mapWorkspaceImportRequestValues,
  prepareWorkspaceImportApply,
} from './workspace-import-apply'

const asset = (name = 'Users') => ({
  format: 'request-studio.request' as const,
  version: 1 as const,
  protocol: 'http' as const,
  name,
  description: '',
  request: {
    method: 'POST' as const,
    url: 'https://api.example.test/users',
    params: [],
    headers: [{ id: 'authorization', enabled: true, key: 'Authorization', value: '{{TOKEN}}' }],
    auth: { type: 'bearer' as const, token: '{{TOKEN}}' },
    body: { type: 'json' as const, content: '{"enabled":true}' },
    settings: { timeoutMs: 30_000 },
  },
})

const bundle = () => ({
  format: 'request-studio.workspace' as const,
  version: 1 as const,
  workspace: { name: 'Portable API' },
  collections: [{ ref: 'collection-1', name: 'API' }],
  requests: [{ collectionRef: 'collection-1', asset: asset() }],
  environments: [{
    name: 'Local',
    variables: [{ key: 'TOKEN', value: '', isSecret: true, description: 'Credential slot' }],
  }],
})

const parsed = (value = bundle()) => {
  const result = parseWorkspaceImportSource(JSON.stringify(value))
  if (!result.ok) throw new Error(result.error.code)
  return result.bundle
}

describe('Workspace import apply preparation', () => {
  it('applies explicit renames deterministically without mutating the source', () => {
    const source = parsed()
    const before = structuredClone(source)
    const dryRun = createWorkspaceImportDryRun(source, {
      mode: 'merge-into-workspace',
      target: {
        workspaceName: 'Target',
        collections: [{ name: 'API', requests: ['Users'] }],
        environments: [{ name: 'Local', variables: ['TOKEN'] }],
      },
    })
    if (!dryRun.ok) throw new Error(dryRun.error.code)
    const resolutions = [
      { sourceRef: 'collection-1', strategy: 'rename' as const, name: 'Imported API' },
      { sourceRef: 'environment-1', strategy: 'rename' as const, name: 'Imported Local' },
    ]

    const first = prepareWorkspaceImportApply(source, dryRun.dryRun, resolutions)
    expect(first).toEqual(prepareWorkspaceImportApply(source, dryRun.dryRun, [...resolutions].reverse()))
    expect(first).toMatchObject({
      ok: true,
      bundle: {
        collections: [{ ref: 'collection-1', name: 'Imported API' }],
        environments: [{ name: 'Imported Local' }],
      },
    })
    expect(source).toEqual(before)
  })

  it.each([
    [[{ sourceRef: 'collection-1', strategy: 'merge' }], 'UNSUPPORTED_STRATEGY'],
    [[{ sourceRef: 'missing', strategy: 'rename', name: 'Other' }], 'INVALID_PLAN'],
    [[{ sourceRef: 'collection-1', strategy: 'rename', name: 'C:\\Users\\Example\\secret.txt' }], 'UNSAFE_IMPORT_CONTENT'],
    ['not-an-array', 'INVALID_PLAN'],
  ])('rejects unsafe or unsupported resolution %#', (resolutions, code) => {
    const source = parsed()
    const dryRun = createWorkspaceImportDryRun(source, {
      mode: 'merge-into-workspace',
      target: { workspaceName: 'Target', collections: [{ name: 'API', requests: [] }], environments: [] },
    })
    if (!dryRun.ok) throw new Error(dryRun.error.code)
    expect(prepareWorkspaceImportApply(source, dryRun.dryRun, resolutions as never)).toMatchObject({
      ok: false,
      error: { code },
    })
  })

  it('maps an HTTP asset to the existing Saved Request row representation', () => {
    expect(mapWorkspaceImportRequestValues(asset())).toEqual({
      name: 'Users',
      description: '',
      protocol: 'http',
      method: 'POST',
      url: 'https://api.example.test/users',
      params_json: '[]',
      headers_json: '[{"id":"authorization","enabled":true,"key":"Authorization","value":"{{TOKEN}}"}]',
      auth_json: '{"type":"bearer","token":"{{TOKEN}}"}',
      body_json: '{"type":"json","content":"{\\"enabled\\":true}"}',
      settings_json: '{"timeoutMs":30000}',
      stream_config_json: '{}',
    })
  })

  it('round-trips WebSocket and SSE assets through the existing row mapper', () => {
    const common = { format: 'request-studio.request' as const, version: 1 as const, name: 'Stream', description: '' }
    const websocket = {
      ...common, protocol: 'websocket' as const,
      request: { url: 'wss://api.example.test/events', params: [], headers: [], auth: { type: 'none' as const }, subprotocols: [], connectTimeoutMs: 10000, idleTimeoutMs: 0, pingEnabled: false, pingIntervalMs: 30000, autoReconnect: false, maxReconnectAttempts: 3, reconnectDelayMs: 1000, maxMessageBytes: 1048576 },
    }
    const sse = {
      ...common, protocol: 'sse' as const,
      request: { method: 'POST' as const, url: 'https://api.example.test/events', params: [], headers: [], auth: { type: 'none' as const }, body: { type: 'text' as const, content: 'start' }, connectTimeoutMs: 10000, idleTimeoutMs: 60000, maxEventBytes: 1048576, maxSessionDurationMs: 1800000 },
    }
    const row = (value: typeof websocket | typeof sse): SavedRequestAssetRow => ({
      ...mapWorkspaceImportRequestValues(value),
    } as SavedRequestAssetRow)

    expect(mapSavedRequestToAsset(row(websocket))).toEqual(websocket)
    expect(mapSavedRequestToAsset(row(sse))).toEqual(sse)
  })

  it('turns malformed JSON bodies into a fixed unsafe-content error', () => {
    const source = parsed({
      ...bundle(),
      requests: [{ collectionRef: 'collection-1', asset: asset('Broken') }],
    })
    const request = source.requests[0].asset
    if (request.protocol !== 'http' || request.request.body.type !== 'json') throw new Error('Expected JSON asset')
    request.request.body.content = '{'
    const dryRun = createWorkspaceImportDryRun(source, { mode: 'create-workspace', existingWorkspaceNames: [] })
    if (!dryRun.ok) throw new Error(dryRun.error.code)
    expect(prepareWorkspaceImportApply(source, dryRun.dryRun)).toEqual({
      ok: false,
      error: { code: 'UNSAFE_IMPORT_CONTENT', message: 'Workspace import contains unsafe content.' },
    })
  })
})
