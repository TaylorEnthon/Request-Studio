const sensitive = /authorization|cookie|password|passwd|secret|token|api.?key/i
export function redactStreamingValue(value: string, secrets: string[]) {
  const replace = (text: string) => secrets.reduce((v, s) => (s ? v.split(s).join('[REDACTED]') : v), text)
  try {
    const walk = (v: any, key = ''): any =>
      typeof v === 'string'
        ? sensitive.test(key) || secrets.includes(v)
          ? '[REDACTED]'
          : replace(v)
        : Array.isArray(v)
          ? v.map((x) => walk(x))
          : v && typeof v === 'object'
            ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]))
            : v
    return JSON.stringify(walk(JSON.parse(value)))
  } catch {
    return replace(value)
  }
}
export function safeSnapshot<T>(value: T, secrets: string[]) {
  return JSON.parse(redactStreamingValue(JSON.stringify(value), secrets)) as T
}
