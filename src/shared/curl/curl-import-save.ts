import { requestAssetV1Schema } from '../assets/request-asset'
import type { CurlImportPreview } from './curl-import-preview'

export interface CurlImportVariableMapping {
  readonly placeholder: string
  readonly variableName: string
}

export interface CurlImportSaveRequest {
  readonly preview: CurlImportPreview
  readonly workspaceId: string
  readonly collectionId: string
  readonly environmentId?: string
  readonly name: string
  readonly description?: string
  readonly variableMappings: readonly CurlImportVariableMapping[]
}

export interface CurlImportSavePlan {
  readonly workspaceId: string
  readonly collectionId: string
  readonly name: string
  readonly description: string
  readonly request: CurlImportPreview['request']
  readonly variables: readonly Readonly<{
    environmentId: string
    key: string
    value: ''
    isSecret: true
    description: 'Imported from cURL'
  }>[]
}

const variableName = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/

const replaceValues = (value: unknown, replacements: ReadonlyMap<string, string>): unknown => {
  if (typeof value === 'string') {
    let result = value
    for (const [placeholder, replacement] of replacements) {
      result = result.replaceAll(placeholder, `{{${replacement}}}`)
    }
    return result
  }
  if (Array.isArray(value)) return value.map((item) => replaceValues(item, replacements))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, replaceValues(child, replacements)]),
    )
  }
  return value
}

export const mapCurlImportSave = (input: CurlImportSaveRequest): CurlImportSavePlan => {
  const workspaceId = input.workspaceId.trim()
  const collectionId = input.collectionId.trim()
  const environmentId = input.environmentId?.trim()
  const name = input.name.trim()
  const description = input.description?.trim() ?? ''
  if (!workspaceId || !collectionId || !name) throw new Error('Import save fields are required.')
  if (input.preview.protocol !== 'http') throw new Error('Only HTTP cURL previews can be saved.')

  const expected = new Set(input.preview.sensitiveMappings.map(({ placeholder }) => placeholder))
  if (input.variableMappings.some(({ placeholder }) => !expected.has(placeholder))) {
    throw new Error('Variable mapping does not match the preview.')
  }
  const mapped = new Set(input.variableMappings.map(({ placeholder }) => placeholder))
  if (input.variableMappings.length !== expected.size || mapped.size !== expected.size) {
    throw new Error('Every sensitive placeholder must be mapped exactly once.')
  }
  if (input.variableMappings.some(({ variableName: name }) => !variableName.test(name))) {
    throw new Error('Variable name is invalid.')
  }
  const names = new Set(input.variableMappings.map(({ variableName: name }) => name))
  if (names.size !== input.variableMappings.length) throw new Error('Variable names must be unique.')
  if (expected.size && !environmentId) throw new Error('Environment is required for sensitive variables.')

  const serialized = JSON.stringify(input.preview.request)
  if ([...expected].some((placeholder) => !serialized.includes(placeholder))) {
    throw new Error('Preview sensitive mapping is invalid.')
  }

  const replacements = new Map(
    input.variableMappings.map(({ placeholder, variableName: name }) => [placeholder, name]),
  )
  const asset = requestAssetV1Schema.parse({
    format: 'request-studio.request',
    version: 1,
    protocol: 'http',
    name,
    description,
    request: replaceValues(input.preview.request, replacements),
  })
  if (asset.protocol !== 'http') throw new Error('Only HTTP cURL previews can be saved.')

  return {
    workspaceId,
    collectionId,
    name,
    description,
    request: asset.request,
    variables: input.variableMappings.map(({ variableName: key }) => ({
      environmentId: environmentId!,
      key,
      value: '',
      isSecret: true,
      description: 'Imported from cURL',
    })),
  }
}
