import type { SseCodeGenerationModel } from './code-generation'

export function generateSseFetch(model: SseCodeGenerationModel): string {
  const lines = [
    `const response = await fetch(${JSON.stringify(model.url)}, {`,
    `  method: ${JSON.stringify(model.method)},`,
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
  if (model.body) lines.push(`  body: ${JSON.stringify(model.body.content)},`)
  lines.push(
    '})',
    '',
    'if (!response.ok) throw new Error(`SSE request failed: ${response.status}`)',
    'if (!response.body) throw new Error("SSE response body is unavailable")',
    '',
    'const reader = response.body.getReader()',
    'const decoder = new TextDecoder("utf-8")',
    '',
    'while (true) {',
    '  const { done, value } = await reader.read()',
    '  if (done) break',
    '  console.log(decoder.decode(value, { stream: true }))',
    '}',
  )
  return lines.join('\n')
}
