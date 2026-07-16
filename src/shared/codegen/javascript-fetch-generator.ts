import type { HttpCodeGenerationModel } from './code-generation'

export function generateJavaScriptFetch(model: HttpCodeGenerationModel): string {
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
  lines.push('});')
  return lines.join('\n')
}
