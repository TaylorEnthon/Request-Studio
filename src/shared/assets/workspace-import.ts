import {
  workspaceExportV1Schema,
  type WorkspaceExportV1,
} from './workspace-export'
import { sanitizeTextForOutput } from './request-export'

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

export type WorkspaceImportMode = 'create-workspace' | 'merge-into-workspace'
export type WorkspaceImportConflictCode =
  | 'WORKSPACE_NAME_CONFLICT'
  | 'COLLECTION_NAME_CONFLICT'
  | 'ENVIRONMENT_NAME_CONFLICT'
  | 'VARIABLE_NAME_CONFLICT'
  | 'REQUEST_NAME_CONFLICT'
export type WorkspaceImportStrategy = 'skip' | 'rename' | 'merge' | 'replace'
export type WorkspaceImportEntityType =
  | 'workspace'
  | 'collection'
  | 'environment'
  | 'variable'
  | 'request'

export type WorkspaceImportTargetSnapshot = Readonly<{
  workspaceName: string
  collections: readonly Readonly<{ name: string; requests: readonly string[] }>[]
  environments: readonly Readonly<{ name: string; variables: readonly string[] }>[]
}>

export type WorkspaceImportAnalysis =
  | Readonly<{ mode: 'create-workspace'; existingWorkspaceNames: readonly string[] }>
  | Readonly<{ mode: 'merge-into-workspace'; target: WorkspaceImportTargetSnapshot | null }>

export type WorkspaceImportConflict = Readonly<{
  code: WorkspaceImportConflictCode
  entityType: WorkspaceImportEntityType
  sourceRef: string
  scopeRef: string
  displayName: string
  message: string
  availableStrategies: readonly WorkspaceImportStrategy[]
}>

export type WorkspaceImportWarning = Readonly<{ code: string; message: string }>
export type WorkspaceImportOperationKind =
  | 'create-workspace'
  | 'create-collection'
  | 'create-environment'
  | 'create-variable'
  | 'create-request'

export type WorkspaceImportOperation = Readonly<{
  index: number
  kind: WorkspaceImportOperationKind
  sourceRef: string
  parentSourceRef?: string
  displayName: string
  status: 'ready' | 'blocked'
  blockedByConflictCodes: readonly WorkspaceImportConflictCode[]
}>

export type WorkspaceImportDryRun = Readonly<{
  format: 'request-studio.workspace-import-dry-run'
  version: 1
  source: Readonly<{ format: 'request-studio.workspace'; version: 1 }>
  mode: WorkspaceImportMode
  summary: Readonly<{
    collectionCount: number
    requestCount: number
    environmentCount: number
    variableCount: number
    conflictCount: number
    warningCount: number
  }>
  conflicts: readonly WorkspaceImportConflict[]
  warnings: readonly WorkspaceImportWarning[]
  operations: readonly WorkspaceImportOperation[]
}>

export type WorkspaceImportDryRunResult =
  | Readonly<{ ok: true; dryRun: WorkspaceImportDryRun }>
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

const normalizeName = (value: string): string => value.trim().toLowerCase()
const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const containsName = (values: readonly string[], candidate: string): boolean =>
  values.some((value) => normalizeName(value) === normalizeName(candidate))

const conflictDetails: Readonly<Record<WorkspaceImportConflictCode, Readonly<{
  entityType: WorkspaceImportEntityType
  message: string
  availableStrategies: readonly WorkspaceImportStrategy[]
}>>> = {
  WORKSPACE_NAME_CONFLICT: {
    entityType: 'workspace',
    message: 'A Workspace with this name already exists.',
    availableStrategies: ['skip', 'rename'],
  },
  COLLECTION_NAME_CONFLICT: {
    entityType: 'collection',
    message: 'A Collection with this name already exists in the target Workspace.',
    availableStrategies: ['skip', 'rename', 'merge'],
  },
  ENVIRONMENT_NAME_CONFLICT: {
    entityType: 'environment',
    message: 'An Environment with this name already exists in the target Workspace.',
    availableStrategies: ['skip', 'rename', 'merge'],
  },
  VARIABLE_NAME_CONFLICT: {
    entityType: 'variable',
    message: 'A Variable with this key already exists in the target Environment.',
    availableStrategies: ['skip', 'rename', 'replace'],
  },
  REQUEST_NAME_CONFLICT: {
    entityType: 'request',
    message: 'A Request with this name already exists in the target Collection.',
    availableStrategies: ['skip', 'rename', 'replace'],
  },
}

const conflict = (
  code: WorkspaceImportConflictCode,
  sourceRef: string,
  scopeRef: string,
  displayName: string,
): WorkspaceImportConflict => ({
  code,
  sourceRef,
  scopeRef,
  displayName: sanitizeTextForOutput(displayName),
  ...conflictDetails[code],
})

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const isTargetSnapshot = (value: unknown): value is WorkspaceImportTargetSnapshot => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const target = value as Record<string, unknown>
  return typeof target.workspaceName === 'string' &&
    Array.isArray(target.collections) && target.collections.every((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false
      const collection = item as Record<string, unknown>
      return typeof collection.name === 'string' && isStringArray(collection.requests)
    }) &&
    Array.isArray(target.environments) && target.environments.every((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return false
      const environment = item as Record<string, unknown>
      return typeof environment.name === 'string' && isStringArray(environment.variables)
    })
}

const dryRunFailure = (code: WorkspaceImportErrorCode): WorkspaceImportDryRunResult => ({
  ok: false,
  error: { code, message: messages[code] },
})

type OperationSeed = Readonly<{
  kind: WorkspaceImportOperationKind
  sourceRef: string
  parentSourceRef?: string
  displayName: string
  blockedByConflictCodes: readonly WorkspaceImportConflictCode[]
}>

export function createWorkspaceImportDryRun(
  bundle: WorkspaceExportV1,
  analysis: unknown,
): WorkspaceImportDryRunResult {
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
    return dryRunFailure('INVALID_IMPORT_MODE')
  }
  const input = analysis as Record<string, unknown>
  if (input.mode !== 'create-workspace' && input.mode !== 'merge-into-workspace') {
    return dryRunFailure('INVALID_IMPORT_MODE')
  }
  if (input.mode === 'create-workspace' && !isStringArray(input.existingWorkspaceNames)) {
    return dryRunFailure('INVALID_IMPORT_MODE')
  }
  if (input.mode === 'merge-into-workspace' && !Object.hasOwn(input, 'target')) {
    return dryRunFailure('TARGET_WORKSPACE_REQUIRED')
  }
  if (input.mode === 'merge-into-workspace' && input.target === null) {
    return dryRunFailure('TARGET_WORKSPACE_NOT_FOUND')
  }
  if (input.mode === 'merge-into-workspace' && !isTargetSnapshot(input.target)) {
    return dryRunFailure('INVALID_IMPORT_MODE')
  }

  const mode = input.mode
  const target = mode === 'merge-into-workspace' ? input.target as WorkspaceImportTargetSnapshot : null
  const conflicts: WorkspaceImportConflict[] = []
  const collectionConflicts = new Set<string>()
  const environmentConflicts = new Set<string>()
  const requestConflicts = new Set<string>()
  const variableConflicts = new Set<string>()
  const workspaceConflict = mode === 'create-workspace' &&
    containsName(input.existingWorkspaceNames as readonly string[], bundle.workspace.name)

  if (workspaceConflict) {
    conflicts.push(conflict(
      'WORKSPACE_NAME_CONFLICT',
      'workspace',
      'workspace',
      bundle.workspace.name,
    ))
  }

  if (target) {
    for (const collection of bundle.collections) {
      const matches = target.collections.filter(({ name }) =>
        normalizeName(name) === normalizeName(collection.name))
      if (!matches.length) continue
      collectionConflicts.add(collection.ref)
      conflicts.push(conflict(
        'COLLECTION_NAME_CONFLICT',
        collection.ref,
        'workspace',
        collection.name,
      ))
      bundle.requests.forEach((request, index) => {
        const sourceRef = `request-${index + 1}`
        if (request.collectionRef === collection.ref &&
          matches.some(({ requests }) => containsName(requests, request.asset.name))) {
          requestConflicts.add(sourceRef)
          conflicts.push(conflict(
            'REQUEST_NAME_CONFLICT',
            sourceRef,
            collection.ref,
            request.asset.name,
          ))
        }
      })
    }
    bundle.environments.forEach((environment, environmentIndex) => {
      const sourceRef = `environment-${environmentIndex + 1}`
      const matches = target.environments.filter(({ name }) =>
        normalizeName(name) === normalizeName(environment.name))
      if (!matches.length) return
      environmentConflicts.add(sourceRef)
      conflicts.push(conflict(
        'ENVIRONMENT_NAME_CONFLICT',
        sourceRef,
        'workspace',
        environment.name,
      ))
      environment.variables.forEach((variable, variableIndex) => {
        const variableRef = `${sourceRef}-variable-${variableIndex + 1}`
        if (matches.some(({ variables }) => containsName(variables, variable.key))) {
          variableConflicts.add(variableRef)
          conflicts.push(conflict(
            'VARIABLE_NAME_CONFLICT',
            variableRef,
            sourceRef,
            variable.key,
          ))
        }
      })
    })
  }

  const conflictRank: Readonly<Record<WorkspaceImportEntityType, number>> = {
    workspace: 0,
    collection: 1,
    environment: 2,
    variable: 3,
    request: 4,
  }
  conflicts.sort((left, right) =>
    conflictRank[left.entityType] - conflictRank[right.entityType] ||
    compareText(left.sourceRef, right.sourceRef) || compareText(left.code, right.code))

  const workspaceBlocks = workspaceConflict ? ['WORKSPACE_NAME_CONFLICT'] as const : []
  const seeds: OperationSeed[] = []
  if (mode === 'create-workspace') {
    seeds.push({
      kind: 'create-workspace',
      sourceRef: 'workspace',
      displayName: sanitizeTextForOutput(bundle.workspace.name),
      blockedByConflictCodes: workspaceBlocks,
    })
  }
  for (const collection of bundle.collections) {
    seeds.push({
      kind: 'create-collection',
      sourceRef: collection.ref,
      parentSourceRef: 'workspace',
      displayName: sanitizeTextForOutput(collection.name),
      blockedByConflictCodes: workspaceConflict
        ? workspaceBlocks
        : collectionConflicts.has(collection.ref) ? ['COLLECTION_NAME_CONFLICT'] : [],
    })
  }
  bundle.environments.forEach((environment, environmentIndex) => {
    const sourceRef = `environment-${environmentIndex + 1}`
    seeds.push({
      kind: 'create-environment',
      sourceRef,
      parentSourceRef: 'workspace',
      displayName: sanitizeTextForOutput(environment.name),
      blockedByConflictCodes: workspaceConflict
        ? workspaceBlocks
        : environmentConflicts.has(sourceRef) ? ['ENVIRONMENT_NAME_CONFLICT'] : [],
    })
    environment.variables.forEach((variable, variableIndex) => {
      const variableRef = `${sourceRef}-variable-${variableIndex + 1}`
      const blocked: WorkspaceImportConflictCode[] = workspaceConflict
        ? [...workspaceBlocks]
        : [
            ...(environmentConflicts.has(sourceRef) ? ['ENVIRONMENT_NAME_CONFLICT'] as const : []),
            ...(variableConflicts.has(variableRef) ? ['VARIABLE_NAME_CONFLICT'] as const : []),
          ]
      seeds.push({
        kind: 'create-variable',
        sourceRef: variableRef,
        parentSourceRef: sourceRef,
        displayName: sanitizeTextForOutput(variable.key),
        blockedByConflictCodes: blocked,
      })
    })
  })
  bundle.requests.forEach((request, index) => {
    const sourceRef = `request-${index + 1}`
    const blocked: WorkspaceImportConflictCode[] = workspaceConflict
      ? [...workspaceBlocks]
      : [
          ...(collectionConflicts.has(request.collectionRef) ? ['COLLECTION_NAME_CONFLICT'] as const : []),
          ...(requestConflicts.has(sourceRef) ? ['REQUEST_NAME_CONFLICT'] as const : []),
        ]
    seeds.push({
      kind: 'create-request',
      sourceRef,
      parentSourceRef: request.collectionRef,
      displayName: sanitizeTextForOutput(request.asset.name),
      blockedByConflictCodes: blocked,
    })
  })

  const operationRank: Readonly<Record<WorkspaceImportOperationKind, number>> = {
    'create-workspace': 0,
    'create-collection': 1,
    'create-environment': 2,
    'create-variable': 3,
    'create-request': 4,
  }
  seeds.sort((left, right) =>
    operationRank[left.kind] - operationRank[right.kind] || compareText(left.sourceRef, right.sourceRef))
  const operations: WorkspaceImportOperation[] = seeds.map((operation, index) => ({
    ...operation,
    index,
    status: operation.blockedByConflictCodes.length ? 'blocked' : 'ready',
  }))
  const warnings: readonly WorkspaceImportWarning[] = []

  return {
    ok: true,
    dryRun: {
      format: 'request-studio.workspace-import-dry-run',
      version: 1,
      source: { format: bundle.format, version: bundle.version },
      mode,
      summary: {
        collectionCount: bundle.collections.length,
        requestCount: bundle.requests.length,
        environmentCount: bundle.environments.length,
        variableCount: bundle.environments.reduce((count, environment) =>
          count + environment.variables.length, 0),
        conflictCount: conflicts.length,
        warningCount: warnings.length,
      },
      conflicts,
      warnings,
      operations,
    },
  }
}
