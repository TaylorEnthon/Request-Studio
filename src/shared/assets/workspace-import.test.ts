import { describe, expect, it } from 'vitest'
import {
  WORKSPACE_IMPORT_LIMITS,
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
