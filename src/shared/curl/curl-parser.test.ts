import { describe, expect, it } from 'vitest'
import { CurlParseError, tokenizeCurl } from './curl-tokenizer'

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

  it('returns stable errors for malformed and oversized input', () => {
    expect(() => tokenizeCurl('curl "unterminated', 'posix')).toThrowError(/quote/i)
    expect(() => tokenizeCurl('curl dangling\\', 'posix')).toThrowError(/escape/i)
    expect(() => tokenizeCurl('x'.repeat(256 * 1024 + 1), 'posix')).toThrowError(/maximum/i)
  })
})
