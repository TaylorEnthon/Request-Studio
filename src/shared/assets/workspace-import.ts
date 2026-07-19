import {
  workspaceExportV1Schema,
  type WorkspaceExportV1,
} from './workspace-export'

export const WORKSPACE_IMPORT_LIMITS = {
  maxSourceBytes: 16 * 1024 * 1024,
  maxDepth: 64,
} as const

export type WorkspaceImportErrorCode =
  | 'INVALID_SOURCE_TYPE'
  | 'EMPTY_SOURCE'
  | 'INPUT_TOO_LARGE'
  | 'INVALID_JSON'
  | 'INVALID_ROOT'
  | 'UNSAFE_OBJECT_KEY'
  | 'MAX_DEPTH_EXCEEDED'
  | 'UNSUPPORTED_FORMAT'
  | 'UNSUPPORTED_VERSION'
  | 'ITEM_LIMIT_EXCEEDED'
  | 'REQUEST_ITEM_TOO_LARGE'
  | 'DUPLICATE_REFERENCE'
  | 'INVALID_REFERENCE'
  | 'INVALID_VARIABLE_NAME'
  | 'INVALID_SECRET_SLOT'
  | 'INVALID_REQUEST_ASSET'
  | 'INVALID_BUNDLE'
  | 'INVALID_IMPORT_MODE'
  | 'TARGET_WORKSPACE_REQUIRED'
  | 'TARGET_WORKSPACE_NOT_FOUND'

export type WorkspaceImportError = Readonly<{
  code: WorkspaceImportErrorCode
  message: string
}>

export type WorkspaceImportParseResult =
  | Readonly<{ ok: true; bundle: WorkspaceExportV1 }>
  | Readonly<{ ok: false; error: WorkspaceImportError }>

const messages: Readonly<Record<WorkspaceImportErrorCode, string>> = {
  INVALID_SOURCE_TYPE: 'Workspace import source must be text.',
  EMPTY_SOURCE: 'Workspace import source is empty.',
  INPUT_TOO_LARGE: 'Workspace import source exceeds the size limit.',
  INVALID_JSON: 'Workspace import source is not valid JSON.',
  INVALID_ROOT: 'Workspace import source must contain an object.',
  UNSAFE_OBJECT_KEY: 'Workspace import source contains an unsafe object key.',
  MAX_DEPTH_EXCEEDED: 'Workspace import source exceeds the nesting limit.',
  UNSUPPORTED_FORMAT: 'Workspace import format is not supported.',
  UNSUPPORTED_VERSION: 'Workspace import version is not supported.',
  ITEM_LIMIT_EXCEEDED: 'Workspace import item limit is exceeded.',
  REQUEST_ITEM_TOO_LARGE: 'Workspace import Request item exceeds the size limit.',
  DUPLICATE_REFERENCE: 'Workspace import contains a duplicate reference.',
  INVALID_REFERENCE: 'Workspace import contains an unavailable reference.',
  INVALID_VARIABLE_NAME: 'Workspace import contains an invalid variable name.',
  INVALID_SECRET_SLOT: 'Workspace import secret slots must be empty.',
  INVALID_REQUEST_ASSET: 'Workspace import contains an invalid Request asset.',
  INVALID_BUNDLE: 'Workspace import bundle is invalid.',
  INVALID_IMPORT_MODE: 'Workspace import mode is invalid.',
  TARGET_WORKSPACE_REQUIRED: 'A target Workspace is required for merge analysis.',
  TARGET_WORKSPACE_NOT_FOUND: 'The target Workspace is unavailable.',
}

const failure = (code: WorkspaceImportErrorCode): WorkspaceImportParseResult => ({
  ok: false,
  error: { code, message: messages[code] },
})

const dangerousKeys = new Set(['__proto__', 'prototype', 'constructor'])
const variableName = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/

const preflight = (root: Record<string, unknown>): WorkspaceImportErrorCode | null => {
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 1 }]
  while (stack.length) {
    const current = stack.pop()!
    if (current.depth > WORKSPACE_IMPORT_LIMITS.maxDepth) return 'MAX_DEPTH_EXCEEDED'
    if (!current.value || typeof current.value !== 'object') continue
    for (const key of Object.keys(current.value)) {
      if (dangerousKeys.has(key)) return 'UNSAFE_OBJECT_KEY'
      stack.push({
        value: (current.value as Record<string, unknown>)[key],
        depth: current.depth + 1,
      })
    }
  }
  return null
}

type SafeIssue = Readonly<{ code: string; path: readonly PropertyKey[]; message: string }>

const schemaFailure = (issues: readonly SafeIssue[]): WorkspaceImportErrorCode => {
  if (issues.some(({ message }) => message === 'Collection refs must be unique.')) {
    return 'DUPLICATE_REFERENCE'
  }
  if (issues.some(({ message }) => message === 'Collection ref is unavailable.')) {
    return 'INVALID_REFERENCE'
  }
  if (issues.some(({ message }) => message === 'Request export item is too large.')) {
    return 'REQUEST_ITEM_TOO_LARGE'
  }
  if (
    issues.some(
      ({ code, path }) =>
        code === 'too_big' &&
        (path[0] === 'collections' ||
          path[0] === 'requests' ||
          path[0] === 'environments' ||
          path.includes('variables')),
    )
  ) {
    return 'ITEM_LIMIT_EXCEEDED'
  }
  if (issues.some(({ path }) => path[0] === 'requests')) return 'INVALID_REQUEST_ASSET'
  return 'INVALID_BUNDLE'
}

const semanticFailure = (bundle: WorkspaceExportV1): WorkspaceImportErrorCode | null => {
  for (const environment of bundle.environments) {
    const keys = new Set<string>()
    for (const variable of environment.variables) {
      if (!variableName.test(variable.key) || keys.has(variable.key)) return 'INVALID_VARIABLE_NAME'
      keys.add(variable.key)
      if (variable.isSecret && variable.value !== '') return 'INVALID_SECRET_SLOT'
    }
  }
  return null
}

export function parseWorkspaceImportSource(source: unknown): WorkspaceImportParseResult {
  if (typeof source !== 'string') return failure('INVALID_SOURCE_TYPE')
  if (!source.trim()) return failure('EMPTY_SOURCE')
  if (new TextEncoder().encode(source).byteLength > WORKSPACE_IMPORT_LIMITS.maxSourceBytes) {
    return failure('INPUT_TOO_LARGE')
  }

  let candidate: unknown
  try {
    candidate = JSON.parse(source)
  } catch {
    return failure('INVALID_JSON')
  }
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return failure('INVALID_ROOT')
  }

  const checkedRoot = candidate as Record<string, unknown>
  const preflightError = preflight(checkedRoot)
  if (preflightError) return failure(preflightError)
  if (checkedRoot.format !== 'request-studio.workspace') return failure('UNSUPPORTED_FORMAT')
  if (checkedRoot.version !== 1) return failure('UNSUPPORTED_VERSION')

  const parsed = workspaceExportV1Schema.safeParse(candidate)
  if (!parsed.success) return failure(schemaFailure(parsed.error.issues))
  const semanticError = semanticFailure(parsed.data)
  return semanticError ? failure(semanticError) : { ok: true, bundle: parsed.data }
}
