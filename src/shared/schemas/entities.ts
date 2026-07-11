import { z } from 'zod'

export const idSchema = z.string().min(1)
export const workspaceNameSchema = z.object({ name: z.string().trim().min(1).max(100) })
export const protocolSchema = z.enum(['http', 'websocket', 'sse'])
export const savedRequestInputSchema = z.object({
  workspaceId: idSchema, collectionId: idSchema, name: z.string().trim().min(1),
  protocol: protocolSchema, method: z.string().nullable().optional(), url: z.string(), description: z.string().default('')
}).transform((value) => ({ ...value, method: value.protocol === 'http' ? (value.method || 'GET').toUpperCase() : null }))
export const idInputSchema = z.object({ id: idSchema })
export const scopedNameSchema = z.object({ workspaceId: idSchema, name: z.string().trim().min(1).max(100) })
export const variableInputSchema = z.object({ environmentId: idSchema, key: z.string().trim().min(1), value: z.string(), isSecret: z.boolean(), description: z.string() })
export const environmentRenameSchema = z.object({ id: idSchema, workspaceId: idSchema, name: z.string().trim().min(1).max(100) }).strict()
export const variableUpdateSchema = z.object({ id: idSchema, environmentId: idSchema, key: z.string().trim().min(1).max(100), value: z.string(), isSecret: z.boolean(), description: z.string().max(500) }).strict()
