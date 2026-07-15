import { z } from 'zod'
import { keyValueEntrySchema } from '../schemas/http'
import { STREAM_LIMITS } from '../streaming/streaming-constants'

const protectedValueSchema = z.string().refine(
  (value) => value === '[REDACTED]' || /^(?:\s*\{\{[A-Za-z_][A-Za-z0-9_]*\}\}\s*)+$/.test(value),
  'Credential values must use variable placeholders or [REDACTED].',
)

const assetAuthSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).strict(),
  z.object({ type: z.literal('bearer'), token: protectedValueSchema }).strict(),
  z.object({ type: z.literal('basic'), username: z.string(), password: protectedValueSchema }).strict(),
  z
    .object({
      type: z.literal('api-key'),
      placement: z.enum(['header', 'query']),
      key: z.string(),
      value: protectedValueSchema,
    })
    .strict(),
])

const sensitiveKey = /authorization|cookie|token|password|api[-_ ]?key|secret/i
const entriesSchema = z.array(keyValueEntrySchema).superRefine((entries, ctx) => {
  entries.forEach((entry, index) => {
    if (sensitiveKey.test(entry.key) && !protectedValueSchema.safeParse(entry.value).success) {
      ctx.addIssue({
        code: 'custom',
        message: 'Sensitive values must use variable placeholders or [REDACTED].',
        path: [index, 'value'],
      })
    }
  })
})

const formBodySchema = z.object({ type: z.literal('form-urlencoded'), entries: entriesSchema }).strict()
const textBodySchemas = [
  z.object({ type: z.literal('none') }).strict(),
  z.object({ type: z.literal('json'), content: z.string() }).strict(),
  z.object({ type: z.literal('text'), content: z.string(), contentType: z.string().optional() }).strict(),
] as const
const multipartEntrySchema = z
  .object({
    id: z.string().min(1),
    enabled: z.boolean(),
    key: z.string(),
    kind: z.enum(['text', 'file']),
    textValue: z.string().optional(),
    fileRef: z.null().optional(),
    contentType: z.string().optional(),
    filename: z.string().optional(),
    description: z.string().optional(),
  })
  .strict()
const httpBodySchema = z.discriminatedUnion('type', [
  ...textBodySchemas,
  formBodySchema,
  z.object({ type: z.literal('multipart'), entries: z.array(multipartEntrySchema) }).strict(),
  z.object({ type: z.literal('binary'), fileRef: z.null(), contentType: z.string().optional() }).strict(),
])
const sseBodySchema = z.discriminatedUnion('type', [...textBodySchemas, formBodySchema])

const requestBase = {
  url: z.string().trim().min(1),
  params: entriesSchema,
  headers: entriesSchema,
  auth: assetAuthSchema,
}

const httpRequestSchema = z
  .object({
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']),
    ...requestBase,
    body: httpBodySchema,
    settings: z.object({ timeoutMs: z.number().int().min(100).max(300000) }).strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.method === 'GET' || value.method === 'HEAD') && value.body.type !== 'none') {
      ctx.addIssue({ code: 'custom', message: `${value.method} requests cannot have a body.`, path: ['body'] })
    }
  })

const webSocketRequestSchema = z
  .object({
    ...requestBase,
    subprotocols: z
      .array(z.string().trim().regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/))
      .max(20),
    connectTimeoutMs: z.number().int().min(100).max(300000),
    idleTimeoutMs: z.number().int().min(0).max(3600000),
    pingEnabled: z.boolean(),
    pingIntervalMs: z.number().int().min(5000).max(300000),
    autoReconnect: z.boolean(),
    maxReconnectAttempts: z.number().int().min(0).max(10),
    reconnectDelayMs: z.number().int().min(100).max(60000),
    maxMessageBytes: z.number().int().min(1).max(STREAM_LIMITS.wsHardMessageBytes),
  })
  .strict()
  .superRefine((value, ctx) => validateUrl(value.url, ['ws:', 'wss:'], 'WebSocket', ctx))

const sseRequestSchema = z
  .object({
    method: z.enum(['GET', 'POST']),
    ...requestBase,
    body: sseBodySchema,
    connectTimeoutMs: z.number().int().min(100).max(300000),
    idleTimeoutMs: z.number().int().min(0).max(3600000),
    maxEventBytes: z.number().int().min(1).max(STREAM_LIMITS.sseHardEventBytes),
    maxSessionDurationMs: z.number().int().min(1000).max(86400000),
  })
  .strict()
  .superRefine((value, ctx) => {
    validateUrl(value.url, ['http:', 'https:'], 'SSE', ctx)
    if (value.method === 'GET' && value.body.type !== 'none') {
      ctx.addIssue({ code: 'custom', message: 'GET SSE requests cannot have a body.', path: ['body'] })
    }
  })

function validateUrl(url: string, protocols: string[], label: string, ctx: z.RefinementCtx): void {
  try {
    if (!protocols.includes(new URL(url).protocol)) throw new Error('Invalid protocol')
  } catch {
    ctx.addIssue({ code: 'custom', path: ['url'], message: `${label} URL uses an unsupported protocol.` })
  }
}

const assetBase = {
  format: z.literal('request-studio.request'),
  version: z.literal(1),
  name: z.string().trim().min(1).max(100),
  description: z.string(),
}

export const requestAssetV1Schema = z.discriminatedUnion('protocol', [
  z.object({ ...assetBase, protocol: z.literal('http'), request: httpRequestSchema }).strict(),
  z.object({ ...assetBase, protocol: z.literal('websocket'), request: webSocketRequestSchema }).strict(),
  z.object({ ...assetBase, protocol: z.literal('sse'), request: sseRequestSchema }).strict(),
])

export type RequestAssetV1 = Readonly<z.infer<typeof requestAssetV1Schema>>

/** Reserved boundary for a future export sanitizer; Phase A1 does not implement sanitization. */
export type RequestAssetSanitizer = (candidate: unknown) => RequestAssetV1
