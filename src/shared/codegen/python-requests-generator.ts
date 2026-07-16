import type { HttpCodeGenerationModel } from './code-generation'

const pythonString = (value: string): string =>
  (JSON.stringify(value) ?? '""')
    .split(String.fromCharCode(0x2028))
    .join('\\u2028')
    .split(String.fromCharCode(0x2029))
    .join('\\u2029')

export function generatePythonRequests(model: HttpCodeGenerationModel): string {
  const lines = [
    'import requests',
    '',
    'response = requests.request(',
    `    ${pythonString(model.method)},`,
    `    ${pythonString(model.url)},`,
  ]
  if (model.headers.length > 0) {
    lines.push('    headers={')
    for (const { key, value } of model.headers) {
      lines.push(`        ${pythonString(key)}: ${pythonString(value)},`)
    }
    lines.push('    },')
  }
  if (model.basicAuth) {
    lines.push(
      `    auth=(${pythonString(model.basicAuth.username)}, ${pythonString(model.basicAuth.password)}),`,
    )
  }
  if (model.body) lines.push(`    data=${pythonString(model.body.content)},`)
  lines.push(')')
  return lines.join('\n')
}
