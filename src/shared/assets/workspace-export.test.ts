import { describe, expect, it } from 'vitest'
import {
  mapWorkspaceExportV1,
  serializeWorkspaceExportV1,
  serializeWorkspaceExportV1Chunks,
  workspaceExportV1Schema,
  type WorkspaceExportSource,
} from './workspace-export'

const request = (overrides: Record<string, unknown> = {}) => ({
  id: 'request-db-id',
  workspace_id: 'workspace-db-id',
  collection_id: 'collection-b',
  name: 'Users',
  description: 'token=raw-description-secret /Users/Alice/private.txt',
  protocol: 'http',
  method: 'POST',
  url: 'https://api.example.test/users',
  params_json: '[]',
  headers_json: JSON.stringify([
    { id: 'header-entry', enabled: true, key: 'X-API-Key', value: 'raw-header-secret' },
  ]),
  auth_json: JSON.stringify({ type: 'bearer', token: 'raw-auth-secret' }),
  body_json: JSON.stringify({
    type: 'json',
    content: JSON.stringify({ password: 'raw-body-secret', file: 'C:\\Users\\Alice\\private.txt' }),
  }),
  settings_json: JSON.stringify({ timeoutMs: 30000 }),
  stream_config_json: '{}',
  created_at: '2026-01-01',
  updated_at: '2026-02-01',
  ...overrides,
})

const source = (): WorkspaceExportSource => ({
  workspace: { id: 'workspace-db-id', name: 'Demo', created_at: 'old', updated_at: 'new' },
  collections: [
    { id: 'collection-z', workspace_id: 'workspace-db-id', name: 'Zeta', created_at: 'old', updated_at: 'new' },
    { id: 'collection-b', workspace_id: 'workspace-db-id', name: 'API', created_at: 'old', updated_at: 'new' },
  ],
  requests: [
    request(),
    request({ id: 'request-a', collection_id: 'collection-z', name: 'Health', method: 'GET', body_json: '{"type":"none"}', auth_json: '{"type":"none"}', headers_json: '[]', description: '' }),
  ],
  environments: [
    { id: 'environment-db-id', workspace_id: 'workspace-db-id', name: 'Local', created_at: 'old', updated_at: 'new' },
  ],
  variables: [
    { id: 'variable-public', environment_id: 'environment-db-id', key: 'BASE_URL', value: 'https://localhost.test', is_secret: 0, description: 'Public endpoint', created_at: 'old', updated_at: 'new' },
    { id: 'variable-secret', environment_id: 'environment-db-id', key: 'TOKEN', value: 'raw-variable-secret', is_secret: 0, description: 'token=raw-variable-description', created_at: 'old', updated_at: 'new' },
    { id: 'variable-placeholder', environment_id: 'environment-db-id', key: 'LABEL', value: '{{SAFE_LABEL}}', is_secret: 0, description: '', created_at: 'old', updated_at: 'new' },
  ],
})

describe('WorkspaceExportV1', () => {
  it('maps a valid deterministic bundle without database or runtime metadata', () => {
    const first = mapWorkspaceExportV1(source())
    const second = mapWorkspaceExportV1(source())

    expect(first).toEqual(second)
    expect(first.workspace).toEqual({ name: 'Demo' })
    expect(first.collections).toEqual([
      { ref: 'collection-1', name: 'API' },
      { ref: 'collection-2', name: 'Zeta' },
    ])
    expect(first.requests.map(({ collectionRef, asset }) => [collectionRef, asset.name])).toEqual([
      ['collection-1', 'Users'],
      ['collection-2', 'Health'],
    ])
    expect(first.environments[0].variables).toEqual([
      { key: 'BASE_URL', value: 'https://localhost.test', isSecret: false, description: 'Public endpoint' },
      { key: 'LABEL', value: '{{SAFE_LABEL}}', isSecret: false, description: '' },
      { key: 'TOKEN', value: '', isSecret: true, description: 'token=[REDACTED]' },
    ])
    expect(JSON.stringify(first)).not.toMatch(/workspace-db-id|collection-b|environment-db-id|request-db-id|variable-secret|2026-0|created_at|updated_at/)
  })

  it('redacts request credentials, secret variables, and local filesystem paths', () => {
    const candidate = source()
    candidate.variables.push({
      id: 'variable-path-key',
      environment_id: 'environment-db-id',
      key: 'C:\\Users\\Alice\\variable.txt',
      value: 'safe',
      is_secret: 0,
      description: '',
    })
    const serialized = JSON.stringify(mapWorkspaceExportV1(candidate))
    expect(serialized).toContain('{{SAFE_LABEL}}')
    expect(serialized).not.toMatch(/raw-(?:description|header|auth|body|variable)|Users\\Alice|\/Users\/Alice/)
  })

  it('rejects invalid contracts and broken source ownership with fixed errors', () => {
    const valid = mapWorkspaceExportV1(source())
    expect(workspaceExportV1Schema.safeParse({ ...valid, runtime: true }).success).toBe(false)
    expect(() => mapWorkspaceExportV1({ ...source(), requests: [request({ collection_id: 'missing' })] })).toThrow('Workspace export data is invalid.')
    expect(() => mapWorkspaceExportV1({ ...source(), environments: [{ ...source().environments[0], workspace_id: 'other' }] })).toThrow('Workspace export data is invalid.')
  })

  it('serializes deterministically in bounded per-item chunks', () => {
    const many = source()
    many.requests = Array.from({ length: 1000 }, (_, index) => request({ id: `request-${index}`, name: `Request ${String(index).padStart(4, '0')}` }))
    const bundle = mapWorkspaceExportV1(many)
    const chunks = [...serializeWorkspaceExportV1Chunks(bundle)]
    const content = chunks.join('')

    expect(JSON.parse(content)).toEqual(bundle)
    expect(content).toBe(serializeWorkspaceExportV1(bundle))
    expect(content).toBe(serializeWorkspaceExportV1(bundle))
    expect(chunks.length).toBeGreaterThan(bundle.requests.length)
    expect(Math.max(...chunks.map((chunk) => chunk.length))).toBeLessThan(content.length / 10)
  })

  it('rejects a request that exceeds the per-item serialization bound', () => {
    const candidate = source()
    candidate.requests = [request({ description: 'x'.repeat(1_000_001) })]
    expect(() => mapWorkspaceExportV1(candidate)).toThrow('Workspace export data is invalid.')
  })
})
