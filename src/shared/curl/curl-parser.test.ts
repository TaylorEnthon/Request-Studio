import { describe, expect, it } from 'vitest'
import { CurlParseError, tokenizeCurl } from './curl-tokenizer'
import { parseCurl } from './curl-parser'

const values = (input: string, dialect: 'posix' | 'powershell' | 'cmd' | 'auto' = 'auto') =>
  tokenizeCurl(input, dialect).tokens.map((token) => token.value)

describe('tokenizeCurl', () => {
  it('tokenizes POSIX quotes, escapes, and multiline continuation', () => {
    expect(values("curl \\\n-H 'Authorization: Bearer token' \\\nhttps://api.example.com", 'posix')).toEqual([
      'curl',
      '-H',
      'Authorization: Bearer token',
      'https://api.example.com',
    ])
    expect(values('curl -H "X-Name: Tom\\ Smith" https://example.com', 'posix')).toContain('X-Name: Tom Smith')
  })

  it('tokenizes PowerShell quotes and backtick continuation', () => {
    expect(values('curl.exe `\n-H "Content-Type: application/json" `\n-d \'{"name":"Tom"}\' `\nhttps://example.com', 'powershell')).toEqual([
      'curl.exe',
      '-H',
      'Content-Type: application/json',
      '-d',
      '{"name":"Tom"}',
      'https://example.com',
    ])
  })

  it('tokenizes CMD quotes, escapes, and caret continuation', () => {
    expect(values('curl ^\n-H "X-Name: Tom" ^\n-d "{\\"name\\":\\"Tom\\"}" ^\nhttps://example.com', 'cmd')).toEqual([
      'curl',
      '-H',
      'X-Name: Tom',
      '-d',
      '{"name":"Tom"}',
      'https://example.com',
    ])
  })

  it('auto-detects continuation dialects and defaults ambiguous input to POSIX', () => {
    expect(tokenizeCurl('curl `\nhttps://example.com').dialect).toBe('powershell')
    expect(tokenizeCurl('curl ^\nhttps://example.com').dialect).toBe('cmd')
    expect(tokenizeCurl('curl https://example.com').dialect).toBe('posix')
  })

  it.each([
    'curl https://example.com | whoami',
    'curl https://example.com && whoami',
    'curl $(whoami)',
    'curl `whoami`',
    'curl https://example.com > output.txt',
    'curl https://example.com; whoami',
  ])('rejects active shell syntax without echoing the input: %s', (input) => {
    try {
      tokenizeCurl(input, 'posix')
      throw new Error('Expected tokenization to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(CurlParseError)
      expect(String(error)).not.toContain(input)
      expect(error).toMatchObject({ code: 'UNSAFE_SYNTAX' })
    }
  })

  it('rejects PowerShell command substitution inside double quotes', () => {
    expect(() => tokenizeCurl('curl "$(whoami)"', 'powershell')).toThrowError(
      expect.objectContaining({ code: 'UNSAFE_SYNTAX' }),
    )
  })

  it('returns stable errors for malformed and oversized input', () => {
    expect(() => tokenizeCurl('curl "unterminated', 'posix')).toThrowError(/quote/i)
    expect(() => tokenizeCurl('curl dangling\\', 'posix')).toThrowError(/escape/i)
    expect(() => tokenizeCurl('x'.repeat(256 * 1024 + 1), 'posix')).toThrowError(/maximum/i)
  })
})

describe('parseCurl', () => {
  it('parses GET URLs and normalizes repeated query parameters', () => {
    const parsed = parseCurl("curl 'https://example.com/users?page=1&page=2'")
    expect(parsed).toMatchObject({
      dialect: 'posix',
      request: {
        method: 'GET',
        url: 'https://example.com/users',
        params: [
          { id: 'curl-param-1', enabled: true, key: 'page', value: '1' },
          { id: 'curl-param-2', enabled: true, key: 'page', value: '2' },
        ],
        headers: [],
        auth: { type: 'none' },
        body: { type: 'none' },
        settings: { timeoutMs: 30000 },
      },
      sensitiveFields: [],
      warnings: [],
    })
    expect(parseCurl('curl --url=https://example.com').request.url).toBe('https://example.com/')
  })

  it('parses explicit POST JSON and preserves duplicate headers', () => {
    const parsed = parseCurl("curl -X POST -H 'Content-Type: application/json' -H 'Accept:a' -H 'Accept:b' -d '{\"a\":1}' https://example.com")
    expect(parsed.request.method).toBe('POST')
    expect(parsed.request.headers.map(({ key, value }) => [key, value])).toEqual([
      ['Content-Type', 'application/json'],
      ['Accept', 'a'],
      ['Accept', 'b'],
    ])
    expect(parsed.request.body).toEqual({ type: 'json', content: '{"a":1}' })
  })

  it('infers POST and joins repeated data in occurrence order', () => {
    const parsed = parseCurl("curl -d 'a=1' --data-raw 'b=2' https://example.com")
    expect(parsed.request).toMatchObject({ method: 'POST', body: { type: 'text', content: 'a=1&b=2' } })
    expect(parsed.warnings).toEqual(['Method inferred as POST from request data.'])
  })

  it('replaces Basic credentials with semantic placeholders', () => {
    const username = ['fixture', 'basic', 'user'].join('-')
    const password = ['fixture', 'basic', 'password'].join('-')
    const parsed = parseCurl(`curl -u ${username}:${password} https://example.com`)
    expect(parsed.request.auth).toEqual({
      type: 'basic',
      username: '{{BASIC_USERNAME}}',
      password: '{{BASIC_PASSWORD}}',
    })
    expect(parsed.sensitiveFields.map(({ kind, placeholder }) => ({ kind, placeholder }))).toEqual([
      { kind: 'basic-username', placeholder: '{{BASIC_USERNAME}}' },
      { kind: 'basic-password', placeholder: '{{BASIC_PASSWORD}}' },
    ])
    expect(JSON.stringify(parsed)).not.toContain(username)
    expect(JSON.stringify(parsed)).not.toContain(password)
  })

  it('replaces Bearer and API-key header credentials without retaining source values', () => {
    const bearer = ['fixture', 'bearer', 'credential'].join('-')
    const apiKey = ['fixture', 'api', 'key'].join('-')
    const parsed = parseCurl(`curl -H "Authorization: Bearer ${bearer}" -H "X-API-Key: ${apiKey}" https://example.com`)
    expect(parsed.request.auth).toEqual({ type: 'bearer', token: '{{TOKEN}}' })
    expect(parsed.request.headers).toContainEqual({
      id: 'curl-header-2',
      enabled: true,
      key: 'X-API-Key',
      value: '{{API_KEY}}',
    })
    expect(parsed.sensitiveFields.map(({ kind, placeholder }) => ({ kind, placeholder }))).toEqual([
      { kind: 'bearer', placeholder: '{{TOKEN}}' },
      { kind: 'api-key', placeholder: '{{API_KEY}}' },
    ])
    expect(JSON.stringify(parsed)).not.toContain(bearer)
    expect(JSON.stringify(parsed)).not.toContain(apiKey)
  })

  it('sanitizes credential-shaped JSON fields', () => {
    const secret = ['fixture', 'json', 'secret'].join('-')
    const parsed = parseCurl(`curl -H 'Content-Type: application/json' -d '{"password":"${secret}"}' https://example.com`)
    expect(parsed.request.body).toEqual({ type: 'json', content: '{"password":"{{PASSWORD}}"}' })
    expect(parsed.sensitiveFields).toContainEqual({
      kind: 'header-secret',
      position: expect.any(Number),
      placeholder: '{{PASSWORD}}',
    })
    expect(JSON.stringify(parsed)).not.toContain(secret)
  })

  it.each([
    'curl -d @file.json https://example.com',
    'curl --data-raw @file.json https://example.com',
    'curl --data-binary body https://example.com',
    'curl --config config.txt https://example.com',
    'curl -F file=@upload.bin https://example.com',
    'curl --upload-file upload.bin https://example.com',
    'curl --cert client.pem https://example.com',
    'curl --key client.key https://example.com',
  ])('rejects file references and dangerous flags: %s', (input) => {
    expect(() => parseCurl(input)).toThrow(CurlParseError)
  })

  it('classifies attached short file flags without retaining their values', () => {
    expect(() => parseCurl('curl -Ffile=@upload.bin https://example.com')).toThrowError(
      expect.objectContaining({ code: 'FILE_REFERENCE', flag: '-F' }),
    )
  })

  it('rejects unsupported commands, flags, URLs, and missing values', () => {
    expect(() => parseCurl('wget https://example.com')).toThrowError(expect.objectContaining({ code: 'INVALID_COMMAND' }))
    expect(() => parseCurl('curl --compressed https://example.com')).toThrowError(/option/i)
    expect(() => parseCurl('curl -H')).toThrowError(/value/i)
    expect(() => parseCurl('curl file:///tmp/secret')).toThrowError(/protocol/i)
    expect(() => parseCurl('curl https://one.example https://two.example')).toThrowError(/one URL/i)
  })

  it('does not expose credential values through errors', () => {
    const credential = ['fixture', 'error', 'credential'].join('-')
    try {
      parseCurl(`curl -H "Authorization: Bearer ${credential}" --unknown https://example.com`)
      throw new Error('Expected parsing to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(CurlParseError)
      expect(JSON.stringify(error)).not.toContain(credential)
      expect(String(error)).not.toContain(credential)
    }
  })

  it('does not retain unknown option tokens in structured errors', () => {
    const credential = ['fixture', 'option', 'credential'].join('-')
    try {
      parseCurl(`curl -Z${credential} https://example.com`)
      throw new Error('Expected parsing to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(CurlParseError)
      expect(JSON.stringify(error)).not.toContain(credential)
    }
  })
})
