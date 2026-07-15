import { expect, it } from 'vitest'
import { compareEntries, compareJson, compareRunData, compareText, compareTimeline } from './compare'

it('distinguishes missing JSON properties from explicit null', () => {
  expect(compareJson({ value: null }, {}).entries).toContainEqual({ path: '$.value', status: 'removed', left: null, right: undefined })
})

it('returns a bounded line diff and skips oversized input', () => {
  expect(compareText('one\ntwo', 'one\nthree').entries).toEqual([
    { status: 'equal', left: 'one', right: 'one' },
    { status: 'removed', left: 'two' },
    { status: 'added', right: 'three' },
  ])
  expect(compareText('a\nb', 'a\nc', { maxCells: 1 })).toMatchObject({ skipped: true, warning: 'Diff skipped: content exceeds limit.' })
})

it('pairs duplicate headers by case-insensitive key occurrence', () => {
  const left = [{ key: 'Set-Cookie', value: 'a' }, { key: 'set-cookie', value: 'b' }]
  const right = [{ key: 'SET-COOKIE', value: 'a' }, { key: 'set-cookie', value: 'c' }]
  expect(compareEntries(left, right).filter((entry) => entry.status === 'changed')).toEqual([
    expect.objectContaining({ key: 'set-cookie', occurrence: 2, left: 'b', right: 'c' }),
  ])
})

it('aligns WebSocket payloads without using time as identity', () => {
  const left = [{ direction: 'inbound', dataKind: 'text', text: 'ready', relativeTimeMs: 1 }]
  const right = [{ direction: 'inbound', dataKind: 'text', text: 'ready', relativeTimeMs: 900 }]
  expect(compareTimeline('websocket', left, right).entries[0]).toMatchObject({ status: 'equal', timeDeltaMs: 899 })
})

it('pairs duplicate SSE event ids by occurrence', () => {
  const left = [{ eventName: 'message', eventId: '1', text: 'a' }, { eventName: 'message', eventId: '1', text: 'b' }]
  const right = [{ eventName: 'message', eventId: '1', text: 'a' }, { eventName: 'message', eventId: '1', text: 'b' }]
  expect(compareTimeline('sse', left, right).entries).toHaveLength(2)
  expect(compareTimeline('sse', left, right).entries.every((entry) => entry.status === 'equal')).toBe(true)
})

it('builds protocol-aware HTTP and streaming comparison sections', () => {
  const http = compareRunData({ left: { request: { url: '/a' }, result: { kind: 'json', text: '{"x":1}', durationMs: 10 }, records: [], run: { protocol: 'http' } }, right: { request: { url: '/b' }, result: { kind: 'json', text: '{"x":2}', durationMs: 15 }, records: [], run: { protocol: 'http' } } })
  expect(http.response.entries).toContainEqual(expect.objectContaining({ path: '$.x', status: 'changed' }))
  expect(http.metrics).toMatchObject({ durationDeltaMs: 5 })
  const stream = compareRunData({ left: { request: {}, result: { protocol: 'sse' }, records: [{ event_name: 'message', event_id: '1', text_preview: 'a' }], run: { protocol: 'sse' } }, right: { request: {}, result: { protocol: 'sse' }, records: [{ event_name: 'message', event_id: '1', text_preview: 'b' }], run: { protocol: 'sse' } } })
  expect(stream.timeline?.entries[0].status).toBe('changed')
})

it('honors a Main-process skip reason for oversized managed text', () => {
  const result = compareRunData({ left: { request: {}, result: { compareSkippedReason: 'Diff skipped: content exceeds limit.' }, records: [], run: { protocol: 'http' } }, right: { request: {}, result: {}, records: [], run: { protocol: 'http' } } })
  expect(result.response).toMatchObject({ skipped: true, warning: 'Diff skipped: content exceeds limit.' })
})
