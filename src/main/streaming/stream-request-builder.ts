import type { SseDraft, WebSocketDraft } from '../../shared/streaming/streaming-schemas'
import { resolveTemplate, type EnvironmentValue } from '../http/variable-resolver'
const resolve = (value: string, variables: EnvironmentValue[]) => resolveTemplate(value, variables).value
function transport(draft: { url: string; params: any[]; headers: any[]; auth: any }, variables: EnvironmentValue[]) {
  const url = new URL(resolve(draft.url, variables))
  for (const p of draft.params)
    if (p.enabled && p.key) url.searchParams.append(resolve(p.key, variables), resolve(p.value, variables))
  const headers: Record<string, string> = {}
  for (const h of draft.headers)
    if (h.enabled && h.key) headers[resolve(h.key, variables)] = resolve(h.value, variables)
  const auth = draft.auth
  if (auth.type === 'bearer') headers.authorization = `Bearer ${resolve(auth.token, variables)}`
  if (auth.type === 'basic')
    headers.authorization = `Basic ${Buffer.from(`${resolve(auth.username, variables)}:${resolve(auth.password, variables)}`).toString('base64')}`
  if (auth.type === 'api-key') {
    const key = resolve(auth.key, variables),
      value = resolve(auth.value, variables)
    if (auth.placement === 'header') headers[key] = value
    else url.searchParams.append(key, value)
  }
  return {
    url: url.toString(),
    headers,
    secretValues: variables.filter((v) => v.isSecret && v.value).map((v) => v.value),
  }
}
export function buildWebSocketRequest(draft: WebSocketDraft, variables: EnvironmentValue[]) {
  return { ...transport(draft, variables), subprotocols: draft.subprotocols.map((v) => v.trim()).filter(Boolean) }
}
export function buildSseRequest(draft: SseDraft, variables: EnvironmentValue[]) {
  const built = transport(draft, variables)
  const lower = new Set(Object.keys(built.headers).map((v) => v.toLowerCase()))
  if (!lower.has('accept')) built.headers.accept = 'text/event-stream'
  if (!lower.has('cache-control')) built.headers['cache-control'] = 'no-cache'
  let body: string | undefined
  if (draft.method === 'POST') {
    if (draft.body.type === 'json') {
      body = resolve(draft.body.content, variables)
      JSON.parse(body)
      if (!lower.has('content-type')) built.headers['content-type'] = 'application/json'
    } else if (draft.body.type === 'text') {
      body = resolve(draft.body.content, variables)
      if (draft.body.contentType && !lower.has('content-type')) built.headers['content-type'] = draft.body.contentType
    } else if (draft.body.type === 'form-urlencoded') {
      const form = new URLSearchParams()
      for (const e of draft.body.entries)
        if (e.enabled && e.key) form.append(resolve(e.key, variables), resolve(e.value, variables))
      body = form.toString()
      if (!lower.has('content-type')) built.headers['content-type'] = 'application/x-www-form-urlencoded'
    }
  }
  return { ...built, method: draft.method, body }
}
