import type { WebSocketCodeGenerationModel } from './code-generation'

export function generateBrowserWebSocket(model: WebSocketCodeGenerationModel): string {
  const lines = ['const socket = new WebSocket(', `  ${JSON.stringify(model.url)},`]
  if (model.subprotocols.length > 0) {
    lines.push(`  [${model.subprotocols.map((value) => JSON.stringify(value)).join(', ')}],`)
  }
  lines.push(')')
  return lines.join('\n')
}
