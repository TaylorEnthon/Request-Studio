import type { HttpCodeGenerationModel } from './code-generation'

export function generateTypeScriptAxios(model: HttpCodeGenerationModel): string {
  const lines = [
    "import axios from 'axios'",
    '',
    'const response = await axios.request({',
    `  method: ${JSON.stringify(model.method)},`,
    `  url: ${JSON.stringify(model.url)},`,
  ]
  if (model.headers.length > 0) {
    lines.push('  headers: {')
    for (const { key, value } of model.headers) {
      lines.push(`    ${JSON.stringify(key)}: ${JSON.stringify(value)},`)
    }
    lines.push('  },')
  }
  if (model.basicAuth) {
    lines.push('  auth: {')
    lines.push(`    username: ${JSON.stringify(model.basicAuth.username)},`)
    lines.push(`    password: ${JSON.stringify(model.basicAuth.password)},`)
    lines.push('  },')
  }
  if (model.body) lines.push(`  data: ${JSON.stringify(model.body.content)},`)
  lines.push('})')
  return lines.join('\n')
}
