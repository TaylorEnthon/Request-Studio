export type DiffStatus = 'equal' | 'added' | 'removed' | 'changed'

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable((value as any)[key])}`).join(',')}}`
  return JSON.stringify(value)
}
const digest = (value: string) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(16)
}

export function compareJson(left: unknown, right: unknown) {
  const entries: { path: string; status: DiffStatus; left?: unknown; right?: unknown }[] = []
  const visit = (a: unknown, b: unknown, path: string) => {
    if (Object.is(a, b)) return
    const aObject = a !== null && typeof a === 'object', bObject = b !== null && typeof b === 'object'
    if (aObject && bObject && Array.isArray(a) === Array.isArray(b)) {
      const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)])
      for (const key of keys) {
        const hasA = Object.prototype.hasOwnProperty.call(a, key), hasB = Object.prototype.hasOwnProperty.call(b, key)
        const childPath = Array.isArray(a) ? `${path}[${key}]` : `${path}.${key}`
        if (!hasA) entries.push({ path: childPath, status: 'added', left: undefined, right: (b as any)[key] })
        else if (!hasB) entries.push({ path: childPath, status: 'removed', left: (a as any)[key], right: undefined })
        else visit((a as any)[key], (b as any)[key], childPath)
      }
    } else entries.push({ path, status: 'changed', left: a, right: b })
  }
  visit(left, right, '$')
  return { equal: entries.length === 0, entries }
}

type LineEntry = { status: DiffStatus; left?: string; right?: string }
const align = <T>(left: T[], right: T[], token: (value: T) => string) => {
  const rows = left.length + 1, columns = right.length + 1, table = new Uint32Array(rows * columns)
  for (let i = left.length - 1; i >= 0; i--) for (let j = right.length - 1; j >= 0; j--)
    table[i * columns + j] = token(left[i]) === token(right[j]) ? table[(i + 1) * columns + j + 1] + 1 : Math.max(table[(i + 1) * columns + j], table[i * columns + j + 1])
  const result: { left?: T; right?: T }[] = []
  let i = 0, j = 0
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && token(left[i]) === token(right[j])) result.push({ left: left[i++], right: right[j++] })
    else if (j < right.length && (i === left.length || table[i * columns + j + 1] > table[(i + 1) * columns + j])) result.push({ right: right[j++] })
    else result.push({ left: left[i++] })
  }
  return result
}

export function compareText(left: string, right: string, limits: { maxBytes?: number; maxLines?: number; maxCells?: number } = {}) {
  const maxBytes = limits.maxBytes ?? 2 * 1024 * 1024, maxLines = limits.maxLines ?? 2000, maxCells = limits.maxCells ?? 2_000_000
  const a = left.split('\n'), b = right.split('\n')
  if (left.length > maxBytes || right.length > maxBytes || a.length > maxLines || b.length > maxLines || a.length * b.length > maxCells)
    return { equal: false, skipped: true, warning: 'Diff skipped: content exceeds limit.', entries: [] as LineEntry[] }
  const entries = align(a, b, (value) => value).map(({ left: l, right: r }): LineEntry => l === undefined ? { status: 'added', right: r } : r === undefined ? { status: 'removed', left: l } : { status: 'equal', left: l, right: r })
  return { equal: entries.every((entry) => entry.status === 'equal'), skipped: false, entries }
}

type KeyValue = { key: string; value: string; enabled?: boolean }
export function compareEntries(left: KeyValue[], right: KeyValue[]) {
  const keys = new Set([...left, ...right].map((entry) => entry.key.toLowerCase())), entries: any[] = []
  for (const key of keys) {
    const a = left.filter((entry) => entry.key.toLowerCase() === key), b = right.filter((entry) => entry.key.toLowerCase() === key)
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      const l = a[index], r = b[index], status: DiffStatus = !l ? 'added' : !r ? 'removed' : l.value === r.value && l.enabled === r.enabled ? 'equal' : 'changed'
      entries.push({ key, occurrence: index + 1, status, left: l?.value, right: r?.value, leftEnabled: l?.enabled, rightEnabled: r?.enabled })
    }
  }
  return entries
}

const payload = (record: any) => record.json ?? record.json_text ?? record.text ?? record.text_preview ?? ''
const recordToken = (protocol: 'websocket' | 'sse', record: any) => protocol === 'sse'
  ? `${record.eventName ?? record.event_name ?? ''}|${record.eventId ?? record.event_id ? `id:${record.eventId ?? record.event_id}` : `data:${digest(stable(payload(record)))}`}`
  : `${record.direction ?? ''}|${record.dataKind ?? record.data_kind ?? ''}|${digest(stable(payload(record)))}`

export function compareTimeline(protocol: 'websocket' | 'sse', left: any[], right: any[]) {
  if (left.length > 10_000 || right.length > 10_000) return { equal: false, skipped: true, warning: 'Timeline diff skipped: record limit exceeded.', entries: [] as any[] }
  const entries = align(left, right, (record) => recordToken(protocol, record)).map(({ left: l, right: r }) => {
    if (!l) return { status: 'added' as const, right: r }
    if (!r) return { status: 'removed' as const, left: l }
    const same = stable(payload(l)) === stable(payload(r)), leftTime = l.relativeTimeMs ?? l.relative_time_ms ?? 0, rightTime = r.relativeTimeMs ?? r.relative_time_ms ?? 0
    return { status: same ? 'equal' as const : 'changed' as const, left: l, right: r, timeDeltaMs: rightTime - leftTime }
  })
  return { equal: entries.every((entry) => entry.status === 'equal'), skipped: false, entries }
}

export function compareRunData(input: { left: any; right: any }) {
  const { left, right } = input, protocol = (left.result?.protocol ?? left.run?.protocol ?? left.request?.protocol ?? 'http') as 'http' | 'websocket' | 'sse'
  let response: any
  if (left.result?.compareSkippedReason || right.result?.compareSkippedReason)
    response = { equal: false, skipped: true, warning: left.result?.compareSkippedReason ?? right.result?.compareSkippedReason, entries: [] }
  else if (left.result?.kind === 'json' && right.result?.kind === 'json') {
    try { response = compareJson(JSON.parse(left.result.text ?? 'null'), JSON.parse(right.result.text ?? 'null')) }
    catch { response = compareText(left.result?.text ?? '', right.result?.text ?? '') }
  } else response = compareText(left.result?.text ?? '', right.result?.text ?? '')
  const leftDuration = left.result?.durationMs ?? left.run?.duration_ms ?? 0, rightDuration = right.result?.durationMs ?? right.run?.duration_ms ?? 0
  return {
    protocol,
    request: compareJson(left.request, right.request),
    response,
    metrics: {
      durationDeltaMs: rightDuration - leftDuration,
      durationDeltaPercent: leftDuration ? ((rightDuration - leftDuration) / leftDuration) * 100 : null,
      sizeDeltaBytes: (right.result?.sizeBytes ?? right.result?.inboundBytes ?? 0) - (left.result?.sizeBytes ?? left.result?.inboundBytes ?? 0),
    },
    timeline: protocol === 'http' ? null : compareTimeline(protocol, left.records ?? [], right.records ?? []),
    resources: compareJson(left.resources ?? [], right.resources ?? []),
  }
}
