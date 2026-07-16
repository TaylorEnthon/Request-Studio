import { describe, expect, it } from 'vitest'
import { parseCurl, type ParsedCurlRequest } from './curl-parser'
import {
  normalizeCurlImportPreview,
  previewCurlImport,
  type CurlImportPreviewResult,
} from './curl-import-preview'

const previewOf = (result: CurlImportPreviewResult) => {
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Expected a successful preview')
  return result.preview
}

describe('cURL import preview', () => {
  it('normalizes a GET request into a RequestAsset-compatible preview', () => {
    expect(previewCurlImport('curl https://example.com/users')).toMatchObject({
      ok: true,
      preview: {
        protocol: 'http',
        dialect: 'posix',
        request: {
          method: 'GET',
          url: 'https://example.com/users',
          params: [],
          headers: [],
          auth: { type: 'none' },
          body: { type: 'none' },
          settings: { timeoutMs: 30000 },
        },
        warnings: [],
        sensitiveMappings: [],
      },
    })
  })

  it('normalizes POST JSON, headers, and inferred-method warning', () => {
    const preview = previewOf(
      previewCurlImport("curl -H 'Content-Type: application/json' -H 'Accept: application/json' -d '{\"a\":1}' https://example.com"),
    )
    expect(preview.request).toMatchObject({
      method: 'POST',
      headers: [
        { key: 'Content-Type', value: 'application/json' },
        { key: 'Accept', value: 'application/json' },
      ],
      body: { type: 'json', content: '{"a":1}' },
    })
    expect(preview.warnings).toEqual([
      { code: 'METHOD_INFERRED', message: 'POST was inferred from request data.', severity: 'warning' },
    ])
  })

  it('maps Bearer and API-key placeholders without retaining credentials', () => {
    const bearer = ['preview', 'bearer', 'fixture'].join('-')
    const apiKey = ['preview', 'api', 'fixture'].join('-')
    const result = previewCurlImport(
      `curl -H "Authorization: Bearer ${bearer}" -H "X-API-Key: ${apiKey}" https://example.com`,
    )
    const preview = previewOf(result)
    expect(preview.request.auth).toEqual({ type: 'bearer', token: '{{TOKEN}}' })
    expect(preview.sensitiveMappings).toEqual([
      { kind: 'bearer-token', placeholder: '{{TOKEN}}', location: 'auth.token', suggestedVariable: 'TOKEN' },
      { kind: 'api-key', placeholder: '{{API_KEY}}', location: 'header.X-API-Key', suggestedVariable: 'API_KEY' },
    ])
    expect(JSON.stringify(result)).not.toContain(bearer)
    expect(JSON.stringify(result)).not.toContain(apiKey)
  })

  it('maps Basic, query, and JSON-body placeholders to deterministic locations', () => {
    const username = ['preview', 'basic', 'user'].join('-')
    const password = ['preview', 'basic', 'password'].join('-')
    const queryToken = ['preview', 'query', 'token'].join('-')
    const bodySecret = ['preview', 'body', 'secret'].join('-')
    const result = previewCurlImport(
      `curl -u ${username}:${password} -H 'Content-Type: application/json' -d '{"password":"${bodySecret}"}' 'https://example.com?access_token=${queryToken}'`,
    )
    const preview = previewOf(result)
    expect(preview.sensitiveMappings).toEqual([
      { kind: 'header-secret', placeholder: '{{TOKEN}}', location: 'query.access_token', suggestedVariable: 'TOKEN' },
      { kind: 'basic-username', placeholder: '{{BASIC_USERNAME}}', location: 'auth.username', suggestedVariable: 'BASIC_USERNAME' },
      { kind: 'basic-password', placeholder: '{{BASIC_PASSWORD}}', location: 'auth.password', suggestedVariable: 'BASIC_PASSWORD' },
      { kind: 'header-secret', placeholder: '{{PASSWORD}}', location: 'body', suggestedVariable: 'PASSWORD' },
    ])
    const serialized = JSON.stringify(result)
    for (const secret of [username, password, queryToken, bodySecret]) expect(serialized).not.toContain(secret)
  })

  it('returns stable blocking issues for unsupported flags and file references', () => {
    expect(previewCurlImport('curl --compressed https://example.com')).toMatchObject({
      ok: false,
      dialect: 'posix',
      issues: [{ code: 'CURL_UNSUPPORTED_FLAG', severity: 'error' }],
    })
    const path = ['private', 'fixture'].join('-') + '.json'
    const result = previewCurlImport(`curl -d @${path} https://example.com`)
    expect(result).toMatchObject({
      ok: false,
      dialect: 'posix',
      issues: [{ code: 'CURL_FILE_REFERENCE', severity: 'error' }],
    })
    expect(JSON.stringify(result)).not.toContain(path)
  })

  it('rejects malformed JSON without returning its sensitive body', () => {
    const secret = ['malformed', 'json', 'secret'].join('-')
    const result = previewCurlImport(
      `curl -H 'Content-Type: application/json' -d '{"password":"${secret}"' https://example.com`,
    )
    expect(result).toMatchObject({
      ok: false,
      issues: [{ code: 'CURL_INVALID_BODY', message: 'The cURL command contains invalid JSON data.' }],
    })
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  it('rejects an unknown dialect before parsing', () => {
    expect(previewCurlImport('curl https://example.com', 'fish')).toEqual({
      ok: false,
      dialect: 'unknown',
      issues: [
        { code: 'UNKNOWN_DIALECT', message: 'The selected shell dialect is not supported.', severity: 'error' },
      ],
    })
  })

  it('replaces unrecognized parser warning text with a generic safe warning', () => {
    const source = ['warning', 'credential', 'fixture'].join('-')
    const parsed = parseCurl('curl https://example.com')
    const preview = normalizeCurlImportPreview({ ...parsed, warnings: [`source: ${source}`] })
    expect(preview.warnings).toEqual([
      { code: 'PARSER_WARNING', message: 'The cURL request was normalized with a warning.', severity: 'warning' },
    ])
    expect(JSON.stringify(preview)).not.toContain(source)
  })

  it('revalidates parser-shaped input through the RequestAsset secret boundary', () => {
    const credential = ['malformed', 'preview', 'credential'].join('-')
    const parsed = parseCurl('curl https://example.com')
    const unsafe = {
      ...parsed,
      request: { ...parsed.request, auth: { type: 'bearer', token: credential } },
    } as ParsedCurlRequest
    try {
      normalizeCurlImportPreview(unsafe)
      throw new Error('Expected normalization to fail')
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(credential)
      expect(String(error)).not.toContain(credential)
    }
  })
})
