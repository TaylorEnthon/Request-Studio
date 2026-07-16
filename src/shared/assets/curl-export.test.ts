import { describe, expect, it } from 'vitest'
import type { RequestAssetV1 } from './request-asset'
import { createCurlExportPreview } from './curl-export'

type HttpAsset = Extract<RequestAssetV1, { protocol: 'http' }>

const asset = (overrides: Partial<HttpAsset['request']> = {}, name = 'Users request'): HttpAsset => ({
  format: 'request-studio.request',
  version: 1,
  name,
  description: '',
  protocol: 'http',
  request: {
    method: 'GET',
    url: 'https://api.example.com/users',
    params: [],
    headers: [],
    auth: { type: 'none' },
    body: { type: 'none' },
    settings: { timeoutMs: 30000 },
    ...overrides,
  },
})

describe('createCurlExportPreview', () => {
  it('generates deterministic POSIX cURL with query, headers, and bearer auth', () => {
    const preview = createCurlExportPreview(
      asset({
        params: [{ id: 'p1', enabled: true, key: 'q', value: "O'Reilly" }],
        headers: [{ id: 'h1', enabled: true, key: 'X-Trace', value: '{{TRACE_ID}}' }],
        auth: { type: 'bearer', token: '{{BEARER_TOKEN}}' },
      }),
    )

    expect(preview).toMatchObject({
      format: 'curl',
      protocol: 'http',
      filenameSuggestion: 'users-request.sh',
      warnings: [],
    })
    expect(preview.content).toContain("--request 'GET'")
    expect(preview.content).toContain("--url 'https://api.example.com/users?q=O'\"'\"'Reilly'")
    expect(preview.content).toContain("--header 'X-Trace: {{TRACE_ID}}'")
    expect(preview.content).toContain("--header 'Authorization: Bearer {{BEARER_TOKEN}}'")
  })

  it.each([
    [
      { type: 'basic', username: 'user', password: '{{PASSWORD}}' } as const,
      "--user 'user:{{PASSWORD}}'",
    ],
    [
      {
        type: 'api-key',
        placement: 'header',
        key: 'X-API-Key',
        value: '{{API_KEY}}',
      } as const,
      "--header 'X-API-Key: {{API_KEY}}'",
    ],
  ])('renders sanitized auth without resolving it', (auth, expected) => {
    expect(createCurlExportPreview(asset({ auth })).content).toContain(expected)
  })

  it('generates POST JSON with one content type and a redaction warning', () => {
    const preview = createCurlExportPreview(
      asset({
        method: 'POST',
        body: { type: 'json', content: '{"token":"[REDACTED]"}' },
      }),
    )

    expect(preview.content).toContain("--header 'Content-Type: application/json'")
    expect(preview.content).toContain("--data-raw '{\"token\":\"[REDACTED]\"}'")
    expect(preview.warnings).toContainEqual({
      code: 'sanitized-values',
      message: 'Sensitive values were redacted.',
    })
  })

  it('preserves an existing content type', () => {
    const preview = createCurlExportPreview(
      asset({
        method: 'POST',
        headers: [{ id: 'h1', enabled: true, key: 'content-type', value: 'application/problem+json' }],
        body: { type: 'json', content: '{}' },
      }),
    )
    expect(preview.content.match(/content-type/gi)).toHaveLength(1)
  })

  it('generates enabled form fields and query API-key placeholders', () => {
    const preview = createCurlExportPreview(
      asset({
        method: 'POST',
        params: [
          { id: 'p1', enabled: true, key: 'tag', value: 'one' },
          { id: 'p2', enabled: true, key: 'tag', value: 'two' },
        ],
        auth: { type: 'api-key', placement: 'query', key: 'api_key', value: '{{API_KEY}}' },
        body: {
          type: 'form-urlencoded',
          entries: [
            { id: 'f1', enabled: true, key: 'name', value: 'Tom' },
            { id: 'f2', enabled: false, key: 'skip', value: 'disabled-secret' },
          ],
        },
      }),
    )

    expect(preview.content).toContain('tag=one&tag=two&api_key={{API_KEY}}')
    expect(preview.content).toContain('--globoff')
    expect(preview.content).toContain("--data-urlencode 'name=Tom'")
    expect(preview.content).not.toContain('disabled-secret')
  })

  it('emits multipart text and omits file parts with a fixed warning', () => {
    const preview = createCurlExportPreview(
      asset({
        method: 'POST',
        body: {
          type: 'multipart',
          entries: [
            { id: 'm1', enabled: true, key: 'name', kind: 'text', textValue: 'Tom' },
            { id: 'm2', enabled: true, key: 'upload', kind: 'file', fileRef: null },
          ],
        },
      }),
    )

    expect(preview.content).toContain("--form 'name=Tom'")
    expect(preview.content).not.toContain("--form 'upload=")
    expect(preview.warnings).toContainEqual({
      code: 'file-content-omitted',
      message: 'Local file content was omitted.',
    })
  })

  it('omits binary content and exposes no local path', () => {
    const localPath = 'C:\\Users\\me\\secret.bin'
    const preview = createCurlExportPreview(
      asset({
        method: 'POST',
        body: { type: 'binary', fileRef: null, contentType: 'application/octet-stream' },
      }),
    )

    expect(preview.content).not.toMatch(/--data|--form|secret\.bin/)
    expect(JSON.stringify(preview)).not.toContain(localPath)
    expect(preview.warnings).toEqual([
      { code: 'file-content-omitted', message: 'Local file content was omitted.' },
    ])
  })

  it('warns about opaque text and uses a safe filename fallback', () => {
    const preview = createCurlExportPreview(
      asset({ method: 'POST', body: { type: 'text', content: 'ordinary text' } }, '***'),
    )
    expect(preview.filenameSuggestion).toBe('request.sh')
    expect(preview.warnings).toContainEqual({
      code: 'opaque-text',
      message: 'Review unstructured text for opaque sensitive values.',
    })
  })

  it('inserts generated query parameters before a URL fragment', () => {
    const preview = createCurlExportPreview(
      asset({
        url: 'https://api.example.com/users?existing=1#section',
        params: [{ id: 'p1', enabled: true, key: 'page', value: '2' }],
      }),
    )
    expect(preview.content).toContain(
      "--url 'https://api.example.com/users?existing=1&page=2#section'",
    )
  })
})
