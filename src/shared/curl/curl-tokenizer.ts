export const MAX_CURL_INPUT_BYTES = 256 * 1024

export type CurlDialect = 'posix' | 'powershell' | 'cmd'
export type CurlDialectOption = CurlDialect | 'auto'
export type CurlErrorCode =
  | 'INPUT_TOO_LARGE'
  | 'EMPTY_INPUT'
  | 'UNSAFE_SYNTAX'
  | 'UNTERMINATED_QUOTE'
  | 'DANGLING_ESCAPE'
  | 'INVALID_COMMAND'
  | 'MISSING_VALUE'
  | 'UNSUPPORTED_FLAG'
  | 'INVALID_HEADER'
  | 'INVALID_URL'
  | 'FILE_REFERENCE'
  | 'MULTIPLE_URLS'

export class CurlParseError extends Error {
  constructor(
    public readonly code: CurlErrorCode,
    message: string,
    public readonly position?: number,
    public readonly dialect?: CurlDialect,
    public readonly flag?: string,
  ) {
    super(message)
    this.name = 'CurlParseError'
  }
}

export interface CurlToken {
  readonly value: string
  readonly start: number
}

export interface TokenizedCurl {
  readonly dialect: CurlDialect
  readonly tokens: readonly CurlToken[]
}

const continuationLength = (input: string, position: number): number =>
  input[position + 1] === '\r' && input[position + 2] === '\n' ? 3 : input[position + 1] === '\n' ? 2 : 0

const detectDialect = (input: string): CurlDialect => {
  if (/`\r?\n/.test(input)) return 'powershell'
  if (/\^\r?\n/.test(input)) return 'cmd'
  return 'posix'
}

export function tokenizeCurl(input: string, requestedDialect: CurlDialectOption = 'auto'): TokenizedCurl {
  const dialect = requestedDialect === 'auto' ? detectDialect(input) : requestedDialect
  if (new TextEncoder().encode(input).byteLength > MAX_CURL_INPUT_BYTES) {
    throw new CurlParseError('INPUT_TOO_LARGE', 'cURL input exceeds the maximum size.', undefined, dialect)
  }
  if (!input.trim()) throw new CurlParseError('EMPTY_INPUT', 'cURL input is empty.', 0, dialect)

  const tokens: CurlToken[] = []
  let value = ''
  let start = -1
  let quote: "'" | '"' | null = null
  const push = () => {
    if (start >= 0) tokens.push({ value, start })
    value = ''
    start = -1
  }
  const append = (character: string, position: number) => {
    if (start < 0) start = position
    value += character
  }
  const unsafe = (position: number): never => {
    throw new CurlParseError('UNSAFE_SYNTAX', 'Shell execution syntax is not supported.', position, dialect)
  }

  for (let position = 0; position < input.length; position += 1) {
    const character = input[position]
    const next = input[position + 1]

    if (dialect === 'posix' && character === '\\' && quote !== "'") {
      const continued = continuationLength(input, position)
      if (continued) {
        position += continued - 1
        continue
      }
      if (next === undefined) {
        throw new CurlParseError('DANGLING_ESCAPE', 'cURL input ends with an incomplete escape.', position, dialect)
      }
      append(next, position)
      position += 1
      continue
    }

    if (dialect === 'powershell' && character === '`' && quote !== "'") {
      const continued = continuationLength(input, position)
      if (continued) {
        position += continued - 1
        continue
      }
      if (next === undefined) {
        throw new CurlParseError('DANGLING_ESCAPE', 'cURL input ends with an incomplete escape.', position, dialect)
      }
      if (!['`', '"', "'", ' ', '\t'].includes(next)) unsafe(position)
      append(next, position)
      position += 1
      continue
    }

    if (dialect === 'cmd' && character === '^') {
      const continued = continuationLength(input, position)
      if (continued) {
        position += continued - 1
        continue
      }
      if (next === undefined) {
        throw new CurlParseError('DANGLING_ESCAPE', 'cURL input ends with an incomplete escape.', position, dialect)
      }
      if ('|&;<>'.includes(next)) unsafe(position)
      append(next, position)
      position += 1
      continue
    }

    if (dialect === 'cmd' && quote === '"' && character === '\\' && next === '"') {
      append('"', position)
      position += 1
      continue
    }

    if (dialect === 'powershell' && quote === "'" && character === "'" && next === "'") {
      append("'", position)
      position += 1
      continue
    }

    const supportsSingleQuote = dialect !== 'cmd'
    if ((character === '"' || (supportsSingleQuote && character === "'"))) {
      if (quote === null) {
        if (start < 0) start = position
        quote = character
        continue
      }
      if (quote === character) {
        quote = null
        continue
      }
    }

    const active = quote === null || (dialect === 'posix' && quote === '"')
    if (active && character === '$' && next === '(') unsafe(position)
    if (dialect === 'posix' && quote !== "'" && character === '`') unsafe(position)
    if (quote === null && '|&;<>'.includes(character)) unsafe(position)

    if (quote === null && /\s/.test(character)) {
      push()
      continue
    }
    append(character, position)
  }

  if (quote !== null) {
    throw new CurlParseError('UNTERMINATED_QUOTE', 'cURL input contains an unterminated quote.', input.length, dialect)
  }
  push()
  return { dialect, tokens }
}
