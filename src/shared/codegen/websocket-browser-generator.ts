import type { WebSocketCodeGenerationModel } from './code-generation'

export function generateBrowserWebSocket(model: WebSocketCodeGenerationModel): string {
  const lines = ['const socket = new WebSocket(', `  ${JSON.stringify(model.url)},`]
  if (model.subprotocols.length > 0) {
    lines.push(`  [${model.subprotocols.map((value) => JSON.stringify(value)).join(', ')}],`)
  }
  lines.push(
    ')', '',
    'socket.addEventListener("open", () => {', '  console.log("WebSocket connected")', '})', '',
    'socket.addEventListener("message", (event) => {', '  console.log("WebSocket message", event.data)', '})', '',
    'socket.addEventListener("error", (event) => {', '  console.error("WebSocket error", event)', '})', '',
    'socket.addEventListener("close", (event) => {',
    '  console.log("WebSocket closed", { code: event.code, reason: event.reason })', '})',
  )
  return lines.join('\n')
}
