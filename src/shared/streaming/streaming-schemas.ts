import { z } from 'zod'
import { authSchema, keyValueEntrySchema } from '../schemas/http'
import { STREAM_LIMITS } from './streaming-constants'
const base = z
  .object({
    savedRequestId: z.string().min(1),
    workspaceId: z.string().regex(/^[A-Za-z0-9_-]+$/, 'Invalid workspace identifier.'),
    name: z.string().trim().min(1).max(100),
    url: z.string().trim().min(1),
    params: z.array(keyValueEntrySchema),
    headers: z.array(keyValueEntrySchema),
    auth: authSchema,
  })
  .strict()
const wsSettings = {
  subprotocols: z
    .array(
      z
        .string()
        .trim()
        .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/),
    )
    .max(20),
  connectTimeoutMs: z.number().int().min(100).max(300000),
  idleTimeoutMs: z.number().int().min(0).max(3600000),
  pingEnabled: z.boolean(),
  pingIntervalMs: z.number().int().min(5000).max(300000),
  autoReconnect: z.boolean(),
  maxReconnectAttempts: z.number().int().min(0).max(10),
  reconnectDelayMs: z.number().int().min(100).max(60000),
  maxMessageBytes: z.number().int().min(1).max(STREAM_LIMITS.wsHardMessageBytes),
}
const webSocketDraftObject = base.extend(wsSettings).strict(),
  validateWebSocket = (v: any, c: z.RefinementCtx) => {
    try {
      if (!['ws:', 'wss:'].includes(new URL(v.url).protocol)) throw 0
    } catch {
      c.addIssue({ code: 'custom', path: ['url'], message: 'WebSocket URL must use ws:// or wss://.' })
    }
  }
export const webSocketDraftSchema = webSocketDraftObject.superRefine(validateWebSocket)
const sseBody = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }).strict(),
  z.object({ type: z.literal('json'), content: z.string() }).strict(),
  z.object({ type: z.literal('text'), content: z.string(), contentType: z.string().optional() }).strict(),
  z.object({ type: z.literal('form-urlencoded'), entries: z.array(keyValueEntrySchema) }).strict(),
])
const sseDraftObject = base
    .extend({
      method: z.enum(['GET', 'POST']),
      body: sseBody,
      connectTimeoutMs: z.number().int().min(100).max(300000),
      idleTimeoutMs: z.number().int().min(0).max(3600000),
      maxEventBytes: z.number().int().min(1).max(STREAM_LIMITS.sseHardEventBytes),
      maxSessionDurationMs: z.number().int().min(1000).max(86400000),
    })
    .strict(),
  validateSse = (v: any, c: z.RefinementCtx) => {
    try {
      if (!['http:', 'https:'].includes(new URL(v.url).protocol)) throw 0
    } catch {
      c.addIssue({ code: 'custom', path: ['url'], message: 'SSE URL must use http:// or https://.' })
    }
    if (v.method === 'GET' && v.body.type !== 'none')
      c.addIssue({ code: 'custom', path: ['body'], message: 'GET SSE requests cannot have a body.' })
  }
export const sseDraftSchema = sseDraftObject.superRefine(validateSse)
export type WebSocketDraft = z.infer<typeof webSocketDraftSchema>
export type SseDraft = z.infer<typeof sseDraftSchema>
export const defaultWebSocketConfig = {
  subprotocols: [],
  connectTimeoutMs: 10000,
  idleTimeoutMs: 0,
  pingEnabled: false,
  pingIntervalMs: 30000,
  autoReconnect: false,
  maxReconnectAttempts: 3,
  reconnectDelayMs: 1000,
  maxMessageBytes: STREAM_LIMITS.wsDefaultMessageBytes,
}
export const defaultSseConfig = {
  method: 'GET' as const,
  body: { type: 'none' } as const,
  connectTimeoutMs: 10000,
  idleTimeoutMs: 60000,
  maxEventBytes: STREAM_LIMITS.sseDefaultEventBytes,
  maxSessionDurationMs: 1800000,
}
export const savedWebSocketUpdateSchema = webSocketDraftObject
  .omit({ workspaceId: true })
  .extend({ id: z.string().min(1) })
  .strict()
  .superRefine((v, c) => {
    validateWebSocket(v, c)
    if (v.id !== v.savedRequestId) c.addIssue({ code: 'custom', message: 'Request IDs must match' })
  })
export const savedSseUpdateSchema = sseDraftObject
  .omit({ workspaceId: true })
  .extend({ id: z.string().min(1) })
  .strict()
  .superRefine((v, c) => {
    validateSse(v, c)
    if (v.id !== v.savedRequestId) c.addIssue({ code: 'custom', message: 'Request IDs must match' })
  })
