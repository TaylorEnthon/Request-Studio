import type { SseCodeGenerationModel } from './code-generation'

export function generateSseFetch(model: SseCodeGenerationModel): string {
  const lines = [
    'const controller = new AbortController()',
    '',
    `const response = await fetch(${JSON.stringify(model.url)}, {`,
    `  method: ${JSON.stringify(model.method)},`,
    '  signal: controller.signal,',
  ]
  if (model.headers.length > 0 || model.basicAuth) {
    lines.push('  headers: {')
    for (const { key, value } of model.headers) {
      lines.push(`    ${JSON.stringify(key)}: ${JSON.stringify(value)},`)
    }
    if (model.basicAuth) {
      const value = `${model.basicAuth.username}:${model.basicAuth.password}`
      lines.push(
        `    "Authorization": \`Basic \${btoa(${JSON.stringify(value)})}\`,`,
      )
    }
    lines.push('  },')
  }
  if (model.body?.kind === 'json') {
    const json = JSON.stringify(model.body.value, null, 2).split('\n')
    lines.push(`  body: JSON.stringify(${json[0]}`)
    lines.push(...json.slice(1).map((line) => `  ${line}`))
    lines[lines.length - 1] += '),'
  } else if (model.body) {
    lines.push(`  body: ${JSON.stringify(model.body.content)},`)
  }
  lines.push(
    '})',
    '',
    'if (!response.ok) throw new Error(`SSE request failed: ${response.status}`)',
    'if (!response.body) throw new Error("SSE response body is unavailable")',
    '',
    'const reader = response.body.getReader()',
    'const decoder = new TextDecoder("utf-8")',
    'let buffer = ""',
    '',
    'while (true) {',
    '  const { done, value } = await reader.read()',
    '  if (done) break',
    '  buffer += decoder.decode(value, { stream: true })',
    '  const blocks = buffer.split(/\\r?\\n\\r?\\n/)',
    '  buffer = blocks.pop() ?? ""',
    '',
    '  for (const block of blocks) {',
    '    const fields = new Map()',
    '    const dataLines = []',
    '    for (const line of block.split(/\\r?\\n/)) {',
    '      if (!line || line.startsWith(":")) continue',
    '      const separator = line.indexOf(":")',
    '      const field = separator < 0 ? line : line.slice(0, separator)',
    '      const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "")',
    '      if (field === "data") dataLines.push(value)',
    '      else if (field === "event" || field === "id" || field === "retry") fields.set(field, value)',
    '    }',
    '    const event = fields.get("event") ?? "message"',
    '    const data = dataLines.join("\\n")',
    '    const id = fields.get("id")',
    '    const retry = fields.get("retry")',
    '    // Use retry as the delay before reconnecting after a disconnect.',
    '    console.log({ event, data, id, retry })',
    '  }',
    '}',
  )
  return lines.join('\n')
}
