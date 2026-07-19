import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_IMPORT_LIMITS,
  createWorkspaceImportDryRun,
  parseWorkspaceImportSource,
  type WorkspaceImportErrorCode,
} from './workspace-import'

const requestAsset = (overrides: Record<string, unknown> = {}) => ({
  format: 'request-studio.request' as const,
  version: 1 as const,
  protocol: 'http' as const,
  name: 'Users',
  description: '',
  request: {
    method: 'GET' as const,
    url: 'https://api.example.test/users',
    params: [],
    headers: [],
    auth: { type: 'none' as const },
    body: { type: 'none' as const },
    settings: { timeoutMs: 30_000 },
  },
  ...overrides,
})

const validBundle = () => ({
  format: 'request-studio.workspace' as const,
  version: 1 as const,
  workspace: { name: 'Portable API' },
  collections: [{ ref: 'collection-1', name: 'API' }],
  requests: [{ collectionRef: 'collection-1', asset: requestAsset() }],
  environments: [
    {
      name: 'Local',
      variables: [{ key: 'TOKEN', value: '', isSecret: true, description: '' }],
    },
  ],
})

const errorCode = (source: unknown): WorkspaceImportErrorCode => {
  const result = parseWorkspaceImportSource(source)
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error('Expected Workspace import parsing to fail.')
  return result.error.code
}

const parsed = (bundle: unknown = validBundle()) => {
  const result = parseWorkspaceImportSource(JSON.stringify(bundle))
  if (!result.ok) throw new Error(`Expected valid bundle, received ${result.error.code}.`)
  return result.bundle
}

describe('Workspace import source parser', () => {
  it('accepts a valid current-version bundle without mutating the input object', () => {
    const source = validBundle()
    const before = structuredClone(source)
    const result = parseWorkspaceImportSource(JSON.stringify(source))

    expect(result).toMatchObject({ ok: true, bundle: source })
    expect(source).toEqual(before)
  })

  it.each([
    [null, 'INVALID_SOURCE_TYPE'],
    [42, 'INVALID_SOURCE_TYPE'],
    ['', 'EMPTY_SOURCE'],
    ['   ', 'EMPTY_SOURCE'],
    ['{', 'INVALID_JSON'],
    ['null', 'INVALID_ROOT'],
    ['[]', 'INVALID_ROOT'],
    ['true', 'INVALID_ROOT'],
    [JSON.stringify({ ...validBundle(), extra: true }), 'INVALID_BUNDLE'],
    [JSON.stringify({ ...validBundle(), format: 'other' }), 'UNSUPPORTED_FORMAT'],
    [JSON.stringify({ ...validBundle(), version: 2 }), 'UNSUPPORTED_VERSION'],
  ])('returns fixed errors for invalid source %#', (source, code) => {
    expect(errorCode(source)).toBe(code)
  })

  it('rejects source text over the UTF-8 byte limit before parsing', () => {
    expect(errorCode('x'.repeat(WORKSPACE_IMPORT_LIMITS.maxSourceBytes + 1))).toBe('INPUT_TOO_LARGE')
  })

  it('rejects excessive nesting and dangerous object keys', () => {
    const nested = `${'{"item":'.repeat(WORKSPACE_IMPORT_LIMITS.maxDepth)}0${'}'.repeat(WORKSPACE_IMPORT_LIMITS.maxDepth)}`
    expect(errorCode(nested)).toBe('MAX_DEPTH_EXCEEDED')

    for (const key of ['__proto__', 'prototype', 'constructor']) {
      const source = JSON.stringify(validBundle()).replace(
        '"workspace":{"name":"Portable API"}',
        `"workspace":{"name":"Portable API","${key}":{}}`,
      )
      expect(errorCode(source)).toBe('UNSAFE_OBJECT_KEY')
    }
  })

  it('enforces Collection, Request, Environment, and Variable count limits', () => {
    const collections = validBundle()
    collections.collections = Array.from({ length: 1_001 }, (_, index) => ({
      ref: `collection-${index + 1}`,
      name: `Collection ${index + 1}`,
    }))
    collections.requests = []
    expect(errorCode(JSON.stringify(collections))).toBe('ITEM_LIMIT_EXCEEDED')

    const requests = validBundle()
    requests.requests = Array.from({ length: 10_001 }, () => ({
      collectionRef: 'collection-1',
      asset: requestAsset(),
    }))
    expect(errorCode(JSON.stringify(requests))).toBe('ITEM_LIMIT_EXCEEDED')

    const environments = validBundle()
    environments.environments = Array.from({ length: 101 }, (_, index) => ({
      name: `Environment ${index + 1}`,
      variables: [],
    }))
    expect(errorCode(JSON.stringify(environments))).toBe('ITEM_LIMIT_EXCEEDED')

    const variables = validBundle()
    variables.environments[0].variables = Array.from({ length: 1_001 }, (_, index) => ({
      key: `KEY_${index}`,
      value: '',
      isSecret: false,
      description: '',
    }))
    expect(errorCode(JSON.stringify(variables))).toBe('ITEM_LIMIT_EXCEEDED')
  })

  it('rejects an oversized Request item', () => {
    const bundle = validBundle()
    bundle.requests[0].asset = requestAsset({ description: 'x'.repeat(1_000_000) })
    expect(errorCode(JSON.stringify(bundle))).toBe('REQUEST_ITEM_TOO_LARGE')
  })

  it('rejects duplicate and missing Collection references', () => {
    const duplicate = validBundle()
    duplicate.collections.push({ ref: 'collection-1', name: 'Duplicate' })
    expect(errorCode(JSON.stringify(duplicate))).toBe('DUPLICATE_REFERENCE')

    const missing = validBundle()
    missing.requests[0].collectionRef = 'collection-2'
    expect(errorCode(JSON.stringify(missing))).toBe('INVALID_REFERENCE')
  })

  it('rejects invalid RequestAsset protocol combinations', () => {
    const bundle = validBundle()
    bundle.requests[0].asset = requestAsset({
      request: { ...requestAsset().request, method: 'TRACE' },
    })
    expect(errorCode(JSON.stringify(bundle))).toBe('INVALID_REQUEST_ASSET')
  })

  it('rejects invalid and duplicate variable keys', () => {
    const invalid = validBundle()
    invalid.environments[0].variables[0].key = 'invalid-name'
    expect(errorCode(JSON.stringify(invalid))).toBe('INVALID_VARIABLE_NAME')

    const tooLong = validBundle()
    tooLong.environments[0].variables[0].key = `A${'B'.repeat(100)}`
    expect(errorCode(JSON.stringify(tooLong))).toBe('INVALID_VARIABLE_NAME')

    const duplicate = validBundle()
    duplicate.environments[0].variables.push({
      key: 'TOKEN',
      value: '',
      isSecret: true,
      description: '',
    })
    expect(errorCode(JSON.stringify(duplicate))).toBe('INVALID_VARIABLE_NAME')
  })

  it('rejects non-empty secret slots without echoing sensitive source data', () => {
    const bundle = validBundle()
    bundle.environments[0].variables[0].value = 'fixture-milestone7-secret-value'
    const source = JSON.stringify(bundle)
    const result = parseWorkspaceImportSource(source)

    expect(result).toMatchObject({ ok: false, error: { code: 'INVALID_SECRET_SLOT' } })
    expect(JSON.stringify(result)).not.toContain('fixture-milestone7-secret-value')
    expect(JSON.stringify(result)).not.toContain('C:\\Users\\Example\\secret.txt')
  })

  it('never includes invalid source content in fixed parse errors', () => {
    const fixtures = [
      'fixture-milestone7-secret-value',
      'C:\\Users\\Example\\secret.txt',
      '/home/example/secret.txt',
      'file:///C:/Users/Example/secret.txt',
      'file:///home/example/secret.txt',
    ]
    const result = parseWorkspaceImportSource(`{"unknown":"${fixtures.join('|')}"}`)
    const serialized = JSON.stringify(result)

    for (const fixture of fixtures) expect(serialized).not.toContain(fixture)
  })
})

describe('Workspace import dry-run planner', () => {
  it('builds a deterministic dependency-ordered create plan and stable summary', () => {
    const bundle = parsed()
    const analysis = { mode: 'create-workspace', existingWorkspaceNames: [] } as const
    const first = createWorkspaceImportDryRun(bundle, analysis)

    expect(first).toEqual(createWorkspaceImportDryRun(bundle, analysis))
    expect(first).toMatchObject({
      ok: true,
      dryRun: {
        format: 'request-studio.workspace-import-dry-run',
        version: 1,
        source: { format: 'request-studio.workspace', version: 1 },
        mode: 'create-workspace',
        summary: {
          collectionCount: 1,
          requestCount: 1,
          environmentCount: 1,
          variableCount: 1,
          conflictCount: 0,
          warningCount: 0,
        },
        conflicts: [],
        warnings: [],
      },
    })
    if (!first.ok) throw new Error('Expected dry-run planning to succeed.')
    expect(first.dryRun.operations.map(({ index, kind, sourceRef, parentSourceRef, status }) => ({
      index,
      kind,
      sourceRef,
      parentSourceRef,
      status,
    }))).toEqual([
      { index: 0, kind: 'create-workspace', sourceRef: 'workspace', parentSourceRef: undefined, status: 'ready' },
      { index: 1, kind: 'create-collection', sourceRef: 'collection-1', parentSourceRef: 'workspace', status: 'ready' },
      { index: 2, kind: 'create-environment', sourceRef: 'environment-1', parentSourceRef: 'workspace', status: 'ready' },
      { index: 3, kind: 'create-variable', sourceRef: 'environment-1-variable-1', parentSourceRef: 'environment-1', status: 'ready' },
      { index: 4, kind: 'create-request', sourceRef: 'request-1', parentSourceRef: 'collection-1', status: 'ready' },
    ])
  })

  it('blocks the complete create plan on a case-insensitive Workspace conflict', () => {
    const result = createWorkspaceImportDryRun(parsed(), {
      mode: 'create-workspace',
      existingWorkspaceNames: [' portable api '],
    })

    expect(result).toMatchObject({
      ok: true,
      dryRun: {
        conflicts: [{
          code: 'WORKSPACE_NAME_CONFLICT',
          entityType: 'workspace',
          sourceRef: 'workspace',
          scopeRef: 'workspace',
          availableStrategies: ['skip', 'rename'],
        }],
      },
    })
    if (!result.ok) throw new Error('Expected dry-run planning to succeed.')
    expect(result.dryRun.operations.every(({ status }) => status === 'blocked')).toBe(true)
    expect(result.dryRun.operations.every(({ blockedByConflictCodes }) =>
      blockedByConflictCodes.includes('WORKSPACE_NAME_CONFLICT'))).toBe(true)
  })

  it('reports all merge conflicts in stable order with entity-specific strategies', () => {
    const target = {
      workspaceName: 'Existing',
      collections: [{ name: 'api', requests: ['Users'] }],
      environments: [{ name: 'LOCAL', variables: ['TOKEN'] }],
    } as const
    const result = createWorkspaceImportDryRun(parsed(), {
      mode: 'merge-into-workspace',
      target,
    })

    expect(result).toMatchObject({
      ok: true,
      dryRun: {
        mode: 'merge-into-workspace',
        summary: { conflictCount: 4 },
        conflicts: [
          { code: 'COLLECTION_NAME_CONFLICT', displayName: 'API', availableStrategies: ['skip', 'rename', 'merge'] },
          { code: 'ENVIRONMENT_NAME_CONFLICT', displayName: 'Local', availableStrategies: ['skip', 'rename', 'merge'] },
          { code: 'VARIABLE_NAME_CONFLICT', displayName: 'TOKEN', availableStrategies: ['skip', 'rename', 'replace'] },
          { code: 'REQUEST_NAME_CONFLICT', displayName: 'Users', availableStrategies: ['skip', 'rename', 'replace'] },
        ],
      },
    })
    if (!result.ok) throw new Error('Expected dry-run planning to succeed.')
    expect(result.dryRun.operations.map(({ kind }) => kind)).toEqual([
      'create-collection',
      'create-environment',
      'create-variable',
      'create-request',
    ])
    expect(result.dryRun.operations.every(({ status, blockedByConflictCodes }) =>
      status === 'blocked' && blockedByConflictCodes.length > 0)).toBe(true)
    expect(result.dryRun.operations.find(({ kind }) => kind === 'create-request')).toMatchObject({
      blockedByConflictCodes: ['COLLECTION_NAME_CONFLICT', 'REQUEST_NAME_CONFLICT'],
    })
    expect(result.dryRun.operations.find(({ kind }) => kind === 'create-variable')).toMatchObject({
      blockedByConflictCodes: ['ENVIRONMENT_NAME_CONFLICT', 'VARIABLE_NAME_CONFLICT'],
    })
  })

  it('returns fixed errors for invalid modes and missing merge targets', () => {
    expect(createWorkspaceImportDryRun(parsed(), { mode: 'unsupported' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_IMPORT_MODE' },
    })
    expect(createWorkspaceImportDryRun(parsed(), { mode: 'create-workspace' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_IMPORT_MODE' },
    })
    expect(createWorkspaceImportDryRun(parsed(), { mode: 'merge-into-workspace' })).toMatchObject({
      ok: false,
      error: { code: 'TARGET_WORKSPACE_REQUIRED' },
    })
    expect(createWorkspaceImportDryRun(parsed(), { mode: 'merge-into-workspace', target: null })).toMatchObject({
      ok: false,
      error: { code: 'TARGET_WORKSPACE_NOT_FOUND' },
    })
  })

  it('does not mutate the bundle or target snapshot', () => {
    const bundle = parsed()
    const target = {
      workspaceName: 'Existing',
      collections: [{ name: 'API', requests: ['Users'] }],
      environments: [{ name: 'Local', variables: ['TOKEN'] }],
    }
    const bundleBefore = structuredClone(bundle)
    const targetBefore = structuredClone(target)

    createWorkspaceImportDryRun(bundle, { mode: 'merge-into-workspace', target })

    expect(bundle).toEqual(bundleBefore)
    expect(target).toEqual(targetBefore)
  })

  it('excludes source payloads, credentials, local paths, and database metadata', () => {
    const credential = 'fixture-milestone7-secret-value'
    const paths = [
      'C:\\Users\\Example\\secret.txt',
      '/home/example/secret.txt',
      'file:///C:/Users/Example/secret.txt',
      'file:///home/example/secret.txt',
    ]
    const candidate: any = validBundle()
    candidate.collections[0].name = paths[0]
    candidate.environments[0].name = paths[1]
    candidate.requests[0].asset = requestAsset({
      name: paths[2],
      description: credential,
      request: {
        ...requestAsset().request,
        method: 'POST',
        body: { type: 'text', content: paths[3] },
      },
    })
    candidate.environments[0].variables[0] = {
      key: 'PUBLIC_VALUE',
      value: `${credential}|${paths.join('|')}`,
      isSecret: false,
      description: credential,
    }
    const target: any = {
      workspaceName: 'Target',
      collections: [],
      environments: [],
      id: 'target-workspace-db-id',
    }
    const result = createWorkspaceImportDryRun(parsed(candidate), {
      mode: 'merge-into-workspace',
      target,
    })
    const serialized = JSON.stringify(result)

    expect(result.ok).toBe(true)
    for (const fixture of [credential, ...paths, 'target-workspace-db-id']) {
      expect(serialized).not.toContain(fixture)
    }
    expect(serialized).not.toContain('api.example.test')
  })
})
