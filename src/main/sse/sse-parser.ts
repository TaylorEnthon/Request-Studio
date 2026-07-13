export type ParsedSseEvent = { event: string; data: string; lastEventId: string; retryMs: number | null }
export class SseParser {
  private buffer = ''
  private data: string[] = []
  private event = ''
  private lastEventId = ''
  private retryMs: number | null = null
  private first = true
  constructor(
    private emit: (event: ParsedSseEvent) => void,
    private maxEventBytes = Number.POSITIVE_INFINITY,
  ) {}
  push(input: string) {
    if (this.first) {
      this.first = false
      if (input.startsWith('\ufeff')) input = input.slice(1)
    }
    this.buffer += input
    if (Buffer.byteLength(this.buffer) + this.data.reduce((n, v) => n + Buffer.byteLength(v), 0) > this.maxEventBytes)
      throw new Error('SSE event exceeded the maximum size.')
    this.drain(false)
  }
  finish() {
    this.drain(true)
  }
  private drain(final: boolean) {
    while (this.buffer) {
      const match = /[\r\n]/.exec(this.buffer)
      if (!match) break
      const index = match.index,
        char = this.buffer[index]
      if (char === '\r' && index === this.buffer.length - 1 && !final) break
      const line = this.buffer.slice(0, index),
        consume = char === '\r' && this.buffer[index + 1] === '\n' ? 2 : 1
      this.buffer = this.buffer.slice(index + consume)
      this.line(line)
    }
    if (final && this.buffer === '\r') {
      this.buffer = ''
      this.line('')
    } else if (final && this.buffer.endsWith('\r')) {
      const line = this.buffer.slice(0, -1)
      this.buffer = ''
      this.line(line)
    } else if (final) this.buffer = ''
  }
  private line(line: string) {
    if (line === '') {
      if (this.data.length) {
        this.emit({
          event: this.event || 'message',
          data: this.data.join('\n'),
          lastEventId: this.lastEventId,
          retryMs: this.retryMs,
        })
      }
      this.data = []
      this.event = ''
      this.retryMs = null
      return
    }
    if (line.startsWith(':')) return
    const at = line.indexOf(':'),
      field = at < 0 ? line : line.slice(0, at)
    let value = at < 0 ? '' : line.slice(at + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') this.data.push(value)
    else if (field === 'event') this.event = value
    else if (field === 'id' && !value.includes('\u0000')) this.lastEventId = value
    else if (field === 'retry' && /^\d+$/.test(value)) this.retryMs = Number(value)
  }
}
