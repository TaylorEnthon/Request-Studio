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
  if (model.body?.kind === 'json') {
    const json = JSON.stringify(model.body.value, null, 2).split('\n')
    lines.push(`  body: JSON.stringify(${json[0]}`)
    lines.push(...json.slice(1).map((line) => `  ${line}`))
    lines[lines.length - 1] += '),'
  } else if (model.body) {
    lines.push(`  body: ${JSON.stringify(model.body.content)},`)
  }
  lines.push('});', 'if (!response.ok) throw new Error(`Request failed: ${response.status} ${response.statusText}`);')
  return lines.join('\n')
}
