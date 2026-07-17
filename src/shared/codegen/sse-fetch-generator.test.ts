import { describe, expect, it } from 'vitest'
import type { RequestAssetV1 } from '../assets/request-asset'
import { generateCode } from './code-generation'

const asset = (request: Extract<RequestAssetV1, { protocol: 'sse' }>['request']): RequestAssetV1 => ({
  format: 'request-studio.request',
  version: 1,
  protocol: 'sse',
  name: 'Events',
  description: '',
  request,
})

const baseRequest: Extract<RequestAssetV1, { protocol: 'sse' }>['request'] = {
  method: 'GET',
  url: 'https://api.example.com/events',
  params: [],
  headers: [],
  auth: { type: 'none' },
  body: { type: 'none' },
  connectTimeoutMs: 10000,
  idleTimeoutMs: 0,
  maxEventBytes: 1048576,
  maxSessionDurationMs: 60000,
}

describe('SSE Fetch generator', () => {
  it('generates a GET request with a deterministic UTF-8 reader loop', () => {
    const content = generateCode(asset(baseRequest), 'sse-fetch').content

    expect(content).toContain('const response = await fetch("https://api.example.com/events", {')
    expect(content).toContain('  method: "GET",')
    expect(content).toContain('if (!response.ok) throw new Error(`SSE request failed: ${response.status}`)')
    expect(content).toContain('if (!response.body) throw new Error("SSE response body is unavailable")')
    expect(content).toContain('const reader = response.body.getReader()')
    expect(content).toContain('const decoder = new TextDecoder("utf-8")')
    expect(content).toContain('while (true) {')
    expect(content).toContain('  const { done, value } = await reader.read()')
    expect(content).toContain('  if (done) break')
  })

  it('generates POST headers and body', () => {
    const content = generateCode(
      asset({
        ...baseRequest,
        method: 'POST',
        headers: [{ id: 'h1', enabled: true, key: 'X-Client', value: 'Request Studio' }],
        body: { type: 'json', content: '{"topic":"alerts"}' },
      }),
      'sse-fetch',
    ).content

    expect(content).toContain('  method: "POST",')
    expect(content).toContain('    "X-Client": "Request Studio",')
    expect(content).toContain('    "Content-Type": "application/json",')
    expect(content).toContain('  body: "{\\"topic\\":\\"alerts\\"}",')
  })

  it('generates browser Fetch Basic authorization without resolving its placeholder', () => {
    const content = generateCode(
      asset({
        ...baseRequest,
        auth: { type: 'basic', username: 'user', password: '{{BASIC_PASSWORD}}' },
      }),
      'sse-fetch',
    ).content

    expect(content).toContain(
      '    "Authorization": `Basic ${btoa("user:{{BASIC_PASSWORD}}")}`,',
    )
  })
})
