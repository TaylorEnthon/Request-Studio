import { describe, expect, it } from 'vitest'
import type { RequestAssetV1 } from '../assets/request-asset'
import { generateCode } from './code-generation'

const asset = (request: Extract<RequestAssetV1, { protocol: 'http' }>['request']): RequestAssetV1 => ({
  format: 'request-studio.request',
  version: 1,
  protocol: 'http',
  name: 'Request',
  description: '',
  request,
})

const baseRequest: Extract<RequestAssetV1, { protocol: 'http' }>['request'] = {
  method: 'GET',
  url: 'https://api.example.com/users',
  params: [],
  headers: [],
  auth: { type: 'none' },
  body: { type: 'none' },
  settings: { timeoutMs: 30000 },
}

describe('JavaScript Fetch generator', () => {
  it('generates an exact GET request', () => {
    expect(generateCode(asset(baseRequest), 'javascript-fetch').content).toBe(
      [
        'const response = await fetch("https://api.example.com/users", {',
        '  method: "GET",',
        '});',
      ].join('\n'),
    )
  })

  it('generates stable headers and a POST JSON body', () => {
    const result = generateCode(
      asset({
        ...baseRequest,
        method: 'POST',
        params: [{ id: 'p1', enabled: true, key: 'view', value: 'full' }],
        headers: [
          { id: 'h1', enabled: true, key: 'X-Client', value: 'Request "Studio"' },
        ],
        auth: { type: 'bearer', token: '{{TOKEN}}' },
        body: { type: 'json', content: '{"name":"Ada"}' },
      }),
      'javascript-fetch',
    )

    expect(result.content).toBe(
      [
        'const response = await fetch("https://api.example.com/users?view=full", {',
        '  method: "POST",',
        '  headers: {',
        '    "X-Client": "Request \\"Studio\\"",',
        '    "Authorization": "Bearer {{TOKEN}}",',
        '    "Content-Type": "application/json",',
        '  },',
        '  body: "{\\"name\\":\\"Ada\\"}",',
        '});',
      ].join('\n'),
    )
  })

  it('preserves query placeholders and escapes ordinary values', () => {
    const result = generateCode(
      asset({
        ...baseRequest,
        params: [
          { id: 'p1', enabled: true, key: 'q', value: 'a b\\c' },
          { id: 'p2', enabled: true, key: 'token', value: '{{TOKEN}}' },
        ],
      }),
      'javascript-fetch',
    )
    expect(result.content).toContain(
      'https://api.example.com/users?q=a%20b%5Cc&token={{TOKEN}}',
    )
  })

  it('renders basic auth without resolving its password placeholder', () => {
    const result = generateCode(
      asset({
        ...baseRequest,
        auth: { type: 'basic', username: 'user', password: '{{BASIC_PASSWORD}}' },
      }),
      'javascript-fetch',
    )
    expect(result.content).toContain(
      '"Authorization": `Basic ${btoa("user:{{BASIC_PASSWORD}}")}`,',
    )
  })
})
