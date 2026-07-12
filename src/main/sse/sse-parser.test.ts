import { describe, expect, it } from 'vitest'
import { SseParser } from './sse-parser'
const parse = (chunks: string[]) => {
  const out: any[] = []
  const p = new SseParser((e) => out.push(e))
  chunks.forEach((v) => p.push(v))
  p.finish()
  return out
}
describe('SseParser', () => {
  it('parses fields, comments, multiline data, id and retry', () =>
    expect(parse([': hi\nevent: update\nid: 7\nretry: 1500\ndata: first\ndata: second\n\n'])).toEqual([
      { event: 'update', data: 'first\nsecond', lastEventId: '7', retryMs: 1500 },
    ]))
  it.each([
    ['LF', 'data: a\n\n'],
    ['CRLF', 'data: a\r\n\r\n'],
    ['CR', 'data: a\r\r'],
  ])('supports %s', (_name, input) => expect(parse([input])[0].data).toBe('a'))
  it('handles arbitrary field, CRLF and UTF-8 decoder boundaries supplied as text', () =>
    expect(parse(['ev', 'ent: m\r', '\ndata: 你', '好\r\n', '\r\n'])).toEqual([
      { event: 'm', data: '你好', lastEventId: '', retryMs: null },
    ]))
  it('ignores invalid retry, null IDs, unknown fields and incomplete final events', () =>
    expect(parse(['id: ok\nretry: x\nid: bad\u0000id\nunknown: v\ndata: no terminator'])).toEqual([]))
  it('strips one BOM and dispatches empty data', () =>
    expect(parse(['\ufeffdata:\n\n'])).toEqual([{ event: 'message', data: '', lastEventId: '', retryMs: null }]))
})
