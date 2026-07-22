import { defaultHttpConfig } from '../schemas/http'
import type { RequestAssetV1 } from './request-asset'
import { isSensitiveOutputKey, sanitizeRequestAssetForOutput, sanitizeTextForOutput } from './request-export'
import type { WorkspaceExportV1 } from './workspace-export'
import type {
  WorkspaceImportDryRun,
  WorkspaceImportError,
  WorkspaceImportErrorCode,
  WorkspaceImportMode,
  WorkspaceImportStrategy,
} from './workspace-import'

export type WorkspaceImportConflictResolution = Readonly<{
  sourceRef: string
  strategy: WorkspaceImportStrategy
  name?: string
}>

export type WorkspaceImportApplyRequest =
  | Readonly<{
      source: unknown
      mode: 'create-workspace'
      resolutions?: readonly WorkspaceImportConflictResolution[]
    }>
  | Readonly<{
      source: unknown
      mode: 'merge-into-workspace'
      targetWorkspaceId: string
      resolutions?: readonly WorkspaceImportConflictResolution[]
    }>

export type WorkspaceImportApplyErrorCode =
  | WorkspaceImportErrorCode
  | 'INVALID_PLAN'
  | 'IMPORT_CONFLICT'
  | 'UNSUPPORTED_STRATEGY'
  | 'UNSAFE_IMPORT_CONTENT'
  | 'TRANSACTION_FAILED'

export type WorkspaceImportApplyError = Readonly<{
  code: WorkspaceImportApplyErrorCode
  message: string
}>

export type WorkspaceImportApplyResult =
  | Readonly<{
      ok: true
      apply: Readonly<{
        format: 'request-studio.workspace-import-apply'
        version: 1
        mode: WorkspaceImportMode
        summary: Readonly<{
          collectionCount: number
          requestCount: number
          environmentCount: number
          variableCount: number
        }>
      }>
    }>
  | Readonly<{ ok: false; error: WorkspaceImportError | WorkspaceImportApplyError }>

type PreparationResult =
  | Readonly<{ ok: true; bundle: WorkspaceExportV1 }>
  | Readonly<{ ok: false; error: WorkspaceImportApplyError }>

const messages = {
  INVALID_PLAN: 'Workspace import apply plan is invalid.',
  IMPORT_CONFLICT: 'Workspace import conflicts must be resolved before apply.',
  UNSUPPORTED_STRATEGY: 'Workspace import conflict strategy is not supported for apply.',
  UNSAFE_IMPORT_CONTENT: 'Workspace import contains unsafe content.',
  TRANSACTION_FAILED: 'Workspace import transaction failed.',
} as const

export const workspaceImportApplyFailure = (
  code: keyof typeof messages,
): Readonly<{ ok: false; error: WorkspaceImportApplyError }> => ({
  ok: false,
  error: { code, message: messages[code] },
})

const variableName = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/

const canonicalAsset = (asset: RequestAssetV1): RequestAssetV1 => {
  if (!('body' in asset.request) || asset.request.body.type !== 'json') return asset
  return {
    ...asset,
    request: {
      ...asset.request,
      body: { ...asset.request.body, content: JSON.stringify(JSON.parse(asset.request.body.content)) },
    },
  } as RequestAssetV1
}

const isSafeBundle = (bundle: WorkspaceExportV1): boolean => {
  try {
    if (sanitizeTextForOutput(bundle.workspace.name) !== bundle.workspace.name) return false
    if (bundle.collections.some(({ name }) => sanitizeTextForOutput(name) !== name)) return false
    for (const request of bundle.requests) {
      const original = canonicalAsset(request.asset)
      const sanitized = canonicalAsset(sanitizeRequestAssetForOutput(request.asset))
      if (JSON.stringify(original) !== JSON.stringify(sanitized)) return false
    }
    return bundle.environments.every((environment) =>
      sanitizeTextForOutput(environment.name) === environment.name &&
      environment.variables.every((variable) =>
        sanitizeTextForOutput(variable.key) === variable.key &&
        sanitizeTextForOutput(variable.value) === variable.value &&
        sanitizeTextForOutput(variable.description) === variable.description &&
        (!isSensitiveOutputKey(variable.key) || variable.isSecret)),
    )
  } catch {
    return false
  }
}

export function prepareWorkspaceImportApply(
  bundle: WorkspaceExportV1,
  dryRun: WorkspaceImportDryRun,
  resolutions: readonly WorkspaceImportConflictResolution[] | unknown = [],
): PreparationResult {
  if (!Array.isArray(resolutions) || resolutions.some((resolution) =>
    !resolution || typeof resolution !== 'object' || Array.isArray(resolution) ||
    typeof (resolution as Record<string, unknown>).sourceRef !== 'string' ||
    typeof (resolution as Record<string, unknown>).strategy !== 'string')) {
    return workspaceImportApplyFailure('INVALID_PLAN')
  }
  const output = structuredClone(bundle)
  const conflicts = new Map(dryRun.conflicts.map((conflict) => [conflict.sourceRef, conflict]))
  const seen = new Set<string>()

  for (const resolution of [...resolutions as readonly WorkspaceImportConflictResolution[]].sort((left, right) =>
    left.sourceRef < right.sourceRef ? -1 : left.sourceRef > right.sourceRef ? 1 : 0)) {
    if (!resolution || typeof resolution.sourceRef !== 'string' || seen.has(resolution.sourceRef)) {
      return workspaceImportApplyFailure('INVALID_PLAN')
    }
    seen.add(resolution.sourceRef)
    const conflict = conflicts.get(resolution.sourceRef)
    if (!conflict || !conflict.availableStrategies.includes(resolution.strategy)) {
      return workspaceImportApplyFailure('INVALID_PLAN')
    }
    if (resolution.strategy !== 'rename') return workspaceImportApplyFailure('UNSUPPORTED_STRATEGY')
    const name = resolution.name?.trim()
    if (!name || name.length > 100 || (conflict.entityType === 'variable' && !variableName.test(name))) {
      return workspaceImportApplyFailure('INVALID_PLAN')
    }

    if (conflict.entityType === 'workspace') output.workspace.name = name
    else if (conflict.entityType === 'collection') {
      const collection = output.collections.find(({ ref }) => ref === conflict.sourceRef)
      if (!collection) return workspaceImportApplyFailure('INVALID_PLAN')
      collection.name = name
    } else if (conflict.entityType === 'environment') {
      const match = /^environment-(\d+)$/.exec(conflict.sourceRef)
      const environment = match && output.environments[Number(match[1]) - 1]
      if (!environment) return workspaceImportApplyFailure('INVALID_PLAN')
      environment.name = name
    } else if (conflict.entityType === 'variable') {
      const match = /^environment-(\d+)-variable-(\d+)$/.exec(conflict.sourceRef)
      const variable = match && output.environments[Number(match[1]) - 1]?.variables[Number(match[2]) - 1]
      if (!variable) return workspaceImportApplyFailure('INVALID_PLAN')
      variable.key = name
    } else {
      const match = /^request-(\d+)$/.exec(conflict.sourceRef)
      const request = match && output.requests[Number(match[1]) - 1]
      if (!request) return workspaceImportApplyFailure('INVALID_PLAN')
      request.asset.name = name
    }
  }

  return isSafeBundle(output)
    ? { ok: true, bundle: output }
    : workspaceImportApplyFailure('UNSAFE_IMPORT_CONTENT')
}

export function mapWorkspaceImportRequestValues(asset: RequestAssetV1): Record<string, unknown> {
  const { url, params, headers, auth, ...protocolFields } = asset.request
  const common = {
    name: asset.name,
    description: asset.description,
    protocol: asset.protocol,
    method: asset.protocol === 'websocket' ? null : asset.request.method,
    url,
    params_json: JSON.stringify(params),
    headers_json: JSON.stringify(headers),
    auth_json: JSON.stringify(auth),
  }
  if (asset.protocol === 'http') {
    return {
      ...common,
      body_json: JSON.stringify(asset.request.body),
      settings_json: JSON.stringify(asset.request.settings),
      stream_config_json: '{}',
    }
  }
  return {
    ...common,
    body_json: JSON.stringify(defaultHttpConfig.body),
    settings_json: JSON.stringify(defaultHttpConfig.settings),
    stream_config_json: JSON.stringify(protocolFields),
  }
}

export const workspaceImportApplySuccess = (
  mode: WorkspaceImportMode,
  bundle: WorkspaceExportV1,
): WorkspaceImportApplyResult => ({
  ok: true,
  apply: {
    format: 'request-studio.workspace-import-apply',
    version: 1,
    mode,
    summary: {
      collectionCount: bundle.collections.length,
      requestCount: bundle.requests.length,
      environmentCount: bundle.environments.length,
      variableCount: bundle.environments.reduce((count, environment) => count + environment.variables.length, 0),
    },
  },
})
