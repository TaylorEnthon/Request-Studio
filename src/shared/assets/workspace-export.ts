import { z } from 'zod'
import { requestAssetV1Schema } from './request-asset'
import type { SavedRequestAssetRow } from './request-asset-mapper'
import {
  isSensitiveOutputKey,
  mapSavedRequestToExportAsset,
  sanitizeTextForOutput,
} from './request-export'

const INVALID_WORKSPACE_EXPORT = 'Workspace export data is invalid.'
const name = z.string().trim().min(1).max(100)
const text = z.string().max(100_000)
const ref = z.string().regex(/^collection-[1-9]\d*$/)

const variableSchema = z.object({
  key: z.string().min(1).max(200),
  value: text,
  isSecret: z.boolean(),
  description: z.string().max(2_000),
}).strict()

export const workspaceExportV1Schema = z.object({
  format: z.literal('request-studio.workspace'),
  version: z.literal(1),
  workspace: z.object({ name }).strict(),
  collections: z.array(z.object({ ref, name }).strict()).max(1_000),
  requests: z.array(z.object({ collectionRef: ref, asset: requestAssetV1Schema }).strict()).max(10_000),
  environments: z.array(z.object({
    name,
    variables: z.array(variableSchema).max(1_000),
  }).strict()).max(100),
}).strict().superRefine((bundle, ctx) => {
  const refs = new Set(bundle.collections.map((collection) => collection.ref))
  if (refs.size !== bundle.collections.length) {
    ctx.addIssue({ code: 'custom', path: ['collections'], message: 'Collection refs must be unique.' })
  }
  bundle.requests.forEach((request, index) => {
    if (!refs.has(request.collectionRef)) {
      ctx.addIssue({ code: 'custom', path: ['requests', index, 'collectionRef'], message: 'Collection ref is unavailable.' })
    }
  })
})

export type WorkspaceExportV1 = z.infer<typeof workspaceExportV1Schema>

type NamedRow = Readonly<{
  id: string
  name: string
  created_at?: string
  updated_at?: string
}>
type OwnedNamedRow = NamedRow & Readonly<{ workspace_id: string }>
type VariableRow = Readonly<{
  id: string
  environment_id: string
  key: string
  value: string
  is_secret: number
  description: string
  created_at?: string
  updated_at?: string
}>
type RequestRow = SavedRequestAssetRow & Readonly<{
  id: string
  workspace_id: string
  collection_id: string
}>

export type WorkspaceExportSource = {
  workspace: NamedRow
  collections: OwnedNamedRow[]
  requests: RequestRow[]
  environments: OwnedNamedRow[]
  variables: VariableRow[]
}

const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0
const byNameAndId = <T extends NamedRow>(left: T, right: T): number =>
  compare(left.name, right.name) || compare(left.id, right.id)

export function mapWorkspaceExportV1(source: WorkspaceExportSource): WorkspaceExportV1 {
  try {
    const workspaceId = source.workspace.id
    if (source.collections.some((row) => row.workspace_id !== workspaceId)) throw new Error()
    if (source.environments.some((row) => row.workspace_id !== workspaceId)) throw new Error()

    const collections = [...source.collections].sort(byNameAndId)
    const collectionRefs = new Map(collections.map((row, index) => [row.id, `collection-${index + 1}`]))
    const environmentIds = new Set(source.environments.map((row) => row.id))
    if (source.requests.some((row) => row.workspace_id !== workspaceId || !collectionRefs.has(row.collection_id))) throw new Error()
    if (source.variables.some((row) => !environmentIds.has(row.environment_id))) throw new Error()

    const requests = [...source.requests]
      .sort((left, right) =>
        compare(collectionRefs.get(left.collection_id)!, collectionRefs.get(right.collection_id)!) ||
        compare(left.name, right.name) || compare(left.id, right.id),
      )
      .map((row) => ({
        collectionRef: collectionRefs.get(row.collection_id)!,
        asset: mapSavedRequestToExportAsset(row),
      }))

    const environments = [...source.environments].sort(byNameAndId).map((environment) => ({
      name: sanitizeTextForOutput(environment.name),
      variables: source.variables
        .filter((variable) => variable.environment_id === environment.id)
        .sort((left, right) => compare(left.key, right.key) || compare(left.id, right.id))
        .map((variable) => {
          const isSecret = Boolean(variable.is_secret) || isSensitiveOutputKey(variable.key)
          return {
            key: variable.key,
            value: isSecret ? '' : sanitizeTextForOutput(variable.value),
            isSecret,
            description: sanitizeTextForOutput(variable.description),
          }
        }),
    }))

    return workspaceExportV1Schema.parse({
      format: 'request-studio.workspace',
      version: 1,
      workspace: { name: sanitizeTextForOutput(source.workspace.name) },
      collections: collections.map((row, index) => ({
        ref: `collection-${index + 1}`,
        name: sanitizeTextForOutput(row.name),
      })),
      requests,
      environments,
    })
  } catch {
    throw new TypeError(INVALID_WORKSPACE_EXPORT)
  }
}

const arrayChunks = function* (values: readonly unknown[]): Generator<string> {
  yield '['
  for (let index = 0; index < values.length; index += 1) {
    if (index) yield ','
    yield JSON.stringify(values[index])
  }
  yield ']'
}

export function* serializeWorkspaceExportV1Chunks(bundle: WorkspaceExportV1): Generator<string> {
  yield `{"format":"request-studio.workspace","version":1,"workspace":${JSON.stringify(bundle.workspace)},"collections":`
  yield* arrayChunks(bundle.collections)
  yield ',"requests":'
  yield* arrayChunks(bundle.requests)
  yield ',"environments":'
  yield* arrayChunks(bundle.environments)
  yield '}\n'
}

export function serializeWorkspaceExportV1(bundle: WorkspaceExportV1): string {
  return [...serializeWorkspaceExportV1Chunks(bundle)].join('')
}
