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

describe('Python requests generator', () => {
  it('generates an exact GET request', () => {
    expect(generateCode(asset(baseRequest), 'python-requests').content).toBe(
      [
        'import requests',
        '',
        'response = requests.request(',
        '    "GET",',
        '    "https://api.example.com/users",',
        ')',
        'response.raise_for_status()',
      ].join('\n'),
    )
  })

  it('generates stable headers, basic auth, and POST data', () => {
    const result = generateCode(
      asset({
        ...baseRequest,
        method: 'POST',
        headers: [{ id: 'h1', enabled: true, key: 'X-Client', value: 'Request Studio' }],
        auth: { type: 'basic', username: 'user', password: '{{BASIC_PASSWORD}}' },
        body: { type: 'json', content: '{"name":"Ada"}' },
      }),
      'python-requests',
    )

    expect(result.content).toBe(
      [
        'import json',
        'import requests',
        '',
        'response = requests.request(',
        '    "POST",',
        '    "https://api.example.com/users",',
        '    headers={',
        '        "X-Client": "Request Studio",',
        '        "Content-Type": "application/json",',
        '    },',
        '    auth=("user", "{{BASIC_PASSWORD}}"),',
        '    json=json.loads("{\\"name\\":\\"Ada\\"}"),',
        ')',
        'response.raise_for_status()',
      ].join('\n'),
    )
  })

  it('escapes Python string content deterministically', () => {
    const content = generateCode(
      asset({
        ...baseRequest,
        method: 'POST',
        body: {
          type: 'text',
          content: 'quote=" slash=\\ newline=\n 中文',
          contentType: 'text/plain',
        },
      }),
      'python-requests',
    ).content

    expect(content).toContain('data="quote=\\" slash=\\\\ newline=\\n 中文"')
    expect(content).toBe(
      generateCode(
        asset({
          ...baseRequest,
          method: 'POST',
          body: {
            type: 'text',
            content: 'quote=" slash=\\ newline=\n 中文',
            contentType: 'text/plain',
          },
        }),
        'python-requests',
      ).content,
    )
  })
})
