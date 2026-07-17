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

describe('TypeScript Axios generator', () => {
  it('generates an exact GET request', () => {
    expect(generateCode(asset(baseRequest), 'typescript-axios').content).toBe(
      [
        "import axios from 'axios'",
        '',
        'const response = await axios.request({',
        '  method: "GET",',
        '  url: "https://api.example.com/users",',
        '})',
      ].join('\n'),
    )
  })

  it('generates headers and JSON POST data', () => {
    expect(
      generateCode(
        asset({
          ...baseRequest,
          method: 'POST',
          headers: [{ id: 'h1', enabled: true, key: 'X-Client', value: 'Request Studio' }],
          auth: { type: 'bearer', token: '{{TOKEN}}' },
          body: { type: 'json', content: '{"name":"Ada"}' },
        }),
        'typescript-axios',
      ).content,
    ).toBe(
      [
        "import axios from 'axios'",
        '',
        'const response = await axios.request({',
        '  method: "POST",',
        '  url: "https://api.example.com/users",',
        '  headers: {',
        '    "X-Client": "Request Studio",',
        '    "Authorization": "Bearer {{TOKEN}}",',
        '    "Content-Type": "application/json",',
        '  },',
        '  data: "{\\"name\\":\\"Ada\\"}",',
        '})',
      ].join('\n'),
    )
  })
})
