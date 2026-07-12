import { z } from 'zod'

export const keyValueEntrySchema = z
  .object({
    id: z.string().min(1),
    enabled: z.boolean(),
    key: z.string(),
    value: z.string(),
    description: z.string().optional(),
  })
  .strict()
export const authSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).strict(),
  z.object({ type: z.literal('bearer'), token: z.string() }).strict(),
  z.object({ type: z.literal('basic'), username: z.string(), password: z.string() }).strict(),
  z
    .object({ type: z.literal('api-key'), placement: z.enum(['header', 'query']), key: z.string(), value: z.string() })
    .strict(),
])
const multipartEntry = z
  .object({
    id: z.string().min(1),
    enabled: z.boolean(),
    key: z.string(),
    kind: z.enum(['text', 'file']),
    textValue: z.string().optional(),
    fileRef: z.string().nullable().optional(),
    contentType: z.string().optional(),
    filename: z.string().optional(),
    description: z.string().optional(),
  })
  .strict()
const bodySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).strict(),
  z.object({ type: z.literal('json'), content: z.string() }).strict(),
  z.object({ type: z.literal('text'), content: z.string(), contentType: z.string().optional() }).strict(),
  z.object({ type: z.literal('form-urlencoded'), entries: z.array(keyValueEntrySchema) }).strict(),
  z.object({ type: z.literal('multipart'), entries: z.array(multipartEntry) }).strict(),
  z.object({ type: z.literal('binary'), fileRef: z.string().nullable(), contentType: z.string().optional() }).strict(),
])
const httpRequestDraftBase = z
  .object({
    savedRequestId: z.string().min(1),
    workspaceId: z.string().min(1),
    name: z.string().trim().min(1).max(100),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
    url: z.string().trim().min(1),
    params: z.array(keyValueEntrySchema),
    headers: z.array(keyValueEntrySchema),
    auth: authSchema,
    body: bodySchema,
    settings: z.object({ timeoutMs: z.number().int().min(100).max(300000) }).strict(),
  })
  .strict()
export const httpRequestDraftSchema = httpRequestDraftBase.superRefine((value, ctx) => {
  if ((value.method === 'GET' || value.method === 'HEAD') && value.body.type !== 'none')
    ctx.addIssue({ code: 'custom', message: `${value.method} requests cannot have a body`, path: ['body'] })
})
export type HttpRequestDraft = z.infer<typeof httpRequestDraftSchema>
export const savedRequestHttpUpdateSchema = httpRequestDraftBase
  .omit({ workspaceId: true })
  .extend({ id: z.string().min(1) })
  .strict()
  .refine((value) => value.id === value.savedRequestId, { message: 'Request IDs must match' })
export const defaultHttpConfig = {
  params: [],
  headers: [],
  auth: { type: 'none' } as const,
  body: { type: 'none' } as const,
  settings: { timeoutMs: 30000 },
}
