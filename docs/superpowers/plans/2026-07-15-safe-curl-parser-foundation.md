# Safe cURL Parser Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded, non-executing POSIX/PowerShell/CMD cURL tokenizer and an HTTP RequestAsset-compatible parser that never returns raw detected credentials.

**Architecture:** A shared tokenizer performs dialect-specific lexical scanning and rejects active shell syntax before a shared parser interprets a strict cURL option allowlist. The parser emits an HTTP request-shaped value plus warnings and secret metadata whose placeholders depend only on semantic type and occurrence order.

**Tech Stack:** TypeScript, Zod-compatible RequestAsset shapes, Vitest; no new dependency.

## Global Constraints

- Maximum input is 256 KiB measured as UTF-8 bytes.
- Never invoke `child_process`, `exec`, `spawn`, a shell, `curl`, PowerShell, or CMD.
- Never include input text, token values, body content, or credentials in errors or logs.
- Placeholders must not depend on secret content, hashes, prefixes, suffixes, or lengths.
- No UI, IPC, Preload, SQLite, migration, Saved Request creation, Environment creation, execution, export, or code generation changes.
- Modify only the new shared cURL files, their tests, and this plan.

---

### Task 1: Safe dialect tokenizer

**Files:**
- Create: `src/shared/curl/curl-tokenizer.ts`
- Create: `src/shared/curl/curl-parser.test.ts`

**Interfaces:**
- Produces: `CurlDialect`, `CurlParseError`, `CurlToken`, `TokenizedCurl`, `tokenizeCurl(input, requestedDialect?)`.
- Consumes: standard `TextEncoder`; no project runtime service.

- [ ] **Step 1: Write failing tokenizer tests**

Add tests that call the desired API directly:

```ts
expect(tokenizeCurl("curl -H 'Accept: application/json' https://example.com", 'posix').tokens.map(t => t.value))
  .toEqual(['curl', '-H', 'Accept: application/json', 'https://example.com'])

expect(tokenizeCurl('curl.exe `\n-H "Accept: application/json" `\nhttps://example.com', 'powershell').tokens.map(t => t.value))
  .toEqual(['curl.exe', '-H', 'Accept: application/json', 'https://example.com'])

expect(tokenizeCurl('curl ^\n-H "X-Name: Tom" ^\nhttps://example.com', 'cmd').tokens.map(t => t.value))
  .toEqual(['curl', '-H', 'X-Name: Tom', 'https://example.com'])

expect(() => tokenizeCurl('curl https://example.com | whoami', 'posix')).toThrow(CurlParseError)
expect(() => tokenizeCurl('curl "unterminated', 'posix')).toThrow(CurlParseError)
expect(() => tokenizeCurl('x'.repeat(256 * 1024 + 1), 'posix')).toThrowError(/maximum/i)
```

- [ ] **Step 2: Run RED**

Run: `npm test -- src/shared/curl/curl-parser.test.ts`

Expected: FAIL because `./curl-tokenizer` does not exist.

- [ ] **Step 3: Implement the minimal tokenizer**

Create these exact public types:

```ts
export type CurlDialect = 'posix' | 'powershell' | 'cmd'
export type CurlDialectOption = CurlDialect | 'auto'
export type CurlErrorCode =
  | 'INPUT_TOO_LARGE' | 'EMPTY_INPUT' | 'UNSAFE_SYNTAX'
  | 'UNTERMINATED_QUOTE' | 'DANGLING_ESCAPE' | 'INVALID_COMMAND'
  | 'MISSING_VALUE' | 'UNSUPPORTED_FLAG' | 'INVALID_HEADER'
  | 'INVALID_URL' | 'FILE_REFERENCE' | 'MULTIPLE_URLS'

export class CurlParseError extends Error {
  constructor(
    public readonly code: CurlErrorCode,
    message: string,
    public readonly position?: number,
    public readonly dialect?: CurlDialect,
    public readonly flag?: string,
  ) { super(message); this.name = 'CurlParseError' }
}

export interface CurlToken { readonly value: string; readonly start: number }
export interface TokenizedCurl { readonly dialect: CurlDialect; readonly tokens: readonly CurlToken[] }
export function tokenizeCurl(input: string, requestedDialect: CurlDialectOption = 'auto'): TokenizedCurl
```

Implementation rules:

1. Reject `new TextEncoder().encode(input).byteLength > 256 * 1024` before scanning.
2. Auto-detect PowerShell from backtick-newline, CMD from caret-newline, POSIX otherwise.
3. Scan once with `quote`, `escaped`, `tokenStart`, and `buffer` state.
4. Remove dialect continuation pairs without emitting whitespace into tokens.
5. Reject active `|`, `>`, `<`, `;`, `&&`, `||`, `$(`, and POSIX command-substitution backticks outside safe literal quoting.
6. Throw only fixed messages such as `Shell execution syntax is not supported.`; never append source text.

- [ ] **Step 4: Run GREEN and static checks**

Run:

```bash
npm test -- src/shared/curl/curl-parser.test.ts
npm run lint
npm run typecheck
```

Expected: tokenizer tests PASS; lint and typecheck exit 0.

- [ ] **Step 5: Commit tokenizer**

```bash
git add src/shared/curl/curl-tokenizer.ts src/shared/curl/curl-parser.test.ts
git commit -m "feat: add safe curl tokenizer"
```

---

### Task 2: RequestAsset-compatible cURL parser and secret boundary

**Files:**
- Create: `src/shared/curl/curl-parser.ts`
- Modify: `src/shared/curl/curl-parser.test.ts`

**Interfaces:**
- Consumes: `tokenizeCurl`, `CurlDialectOption`, `CurlParseError`, and existing `defaultHttpConfig`.
- Produces: `SensitiveField`, `ParsedCurlRequest`, and `parseCurl(input, dialect?)`.

- [ ] **Step 1: Write failing parser and security tests**

Cover the public contract and verify fixture credentials are absent from serialized results and thrown errors:

```ts
const get = parseCurl('curl https://example.com')
expect(get.request).toMatchObject({ method: 'GET', url: 'https://example.com/', body: { type: 'none' } })

const post = parseCurl(`curl -X POST -H 'Content-Type: application/json' -d '{"a":1}' https://example.com`)
expect(post.request.body).toEqual({ type: 'json', content: '{"a":1}' })

const duplicates = parseCurl(`curl -H 'Accept:a' -H 'Accept:b' https://example.com`)
expect(duplicates.request.headers.map(header => header.value)).toEqual(['a', 'b'])

const secret = 'fixture-runtime-credential'
const parsed = parseCurl(`curl -H "Authorization: Bearer ${secret}" https://example.com`)
expect(parsed.request.auth).toEqual({ type: 'bearer', token: '{{TOKEN}}' })
expect(parsed.sensitiveFields).toEqual([{ kind: 'bearer', position: expect.any(Number), placeholder: '{{TOKEN}}' }])
expect(JSON.stringify(parsed)).not.toContain(secret)

expect(() => parseCurl('curl -d @file.json https://example.com')).toThrowError(/file/i)
expect(() => parseCurl('curl file:///tmp/secret')).toThrowError(/protocol/i)
expect(() => parseCurl('curl --config secret.conf https://example.com')).toThrow(CurlParseError)
```

Also test `-u username:password`, API-key-shaped headers, repeated data joined with `&`, `--url`, missing option values, unknown flags, multiple URLs, and error serialization without the credential fixture.

- [ ] **Step 2: Run RED**

Run: `npm test -- src/shared/curl/curl-parser.test.ts`

Expected: FAIL because `./curl-parser` does not exist.

- [ ] **Step 3: Implement the minimal parser**

Create this result contract:

```ts
export interface SensitiveField {
  readonly kind: 'bearer' | 'basic-username' | 'basic-password' | 'api-key' | 'header-secret'
  readonly position: number
  readonly placeholder: string
}

export interface ParsedCurlRequest {
  readonly dialect: CurlDialect
  readonly request: {
    readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
    readonly url: string
    readonly params: readonly {
      readonly id: string; readonly enabled: true; readonly key: string; readonly value: string
    }[]
    readonly headers: readonly {
      readonly id: string; readonly enabled: true; readonly key: string; readonly value: string
    }[]
    readonly auth:
      | { readonly type: 'none' }
      | { readonly type: 'bearer'; readonly token: string }
      | { readonly type: 'basic'; readonly username: string; readonly password: string }
    readonly body:
      | { readonly type: 'none' }
      | { readonly type: 'json'; readonly content: string }
      | { readonly type: 'text'; readonly content: string; readonly contentType?: string }
    readonly settings: { readonly timeoutMs: number }
  }
  readonly sensitiveFields: readonly SensitiveField[]
  readonly warnings: readonly string[]
}

export function parseCurl(input: string, dialect: CurlDialectOption = 'auto'): ParsedCurlRequest
```

Parsing rules:

1. Require first token `curl` or `curl.exe` case-insensitively.
2. Consume only the documented flags, including `--flag=value` long forms.
3. Reject every unknown option and all file-capable flags with fixed errors.
4. Validate the final URL with `URL`; allow only `http:` and `https:` and reject embedded URL credentials.
5. Move URL query pairs into deterministic entries `curl-param-1...` and clear the URL search component.
6. Build header IDs `curl-header-1...`; preserve duplicates and order.
7. Infer `POST` only when data exists; otherwise default to `GET`.
8. Join repeated data with `&`; map valid JSON under JSON content type to `{ type: 'json', content }`, otherwise use text.
9. Convert one Bearer authorization header to bearer auth and `-u` to Basic auth. Replace credential fields immediately.
10. Replace sensitive header values using semantic placeholders and add metadata containing only kind, token position, and placeholder.
11. Allocate collisions through occurrence counters only: `{{TOKEN}}`, `{{TOKEN_2}}`, and so on.

- [ ] **Step 4: Run GREEN and focused regression**

Run:

```bash
npm test -- src/shared/curl/curl-parser.test.ts
npm test -- src/shared/assets/request-asset.test.ts src/shared/curl/curl-parser.test.ts
npm run lint
npm run typecheck
```

Expected: all focused tests PASS; lint and typecheck exit 0.

- [ ] **Step 5: Commit parser**

```bash
git add src/shared/curl/curl-parser.ts src/shared/curl/curl-parser.test.ts
git commit -m "feat: add safe curl parser foundation"
```

---

### Task 3: Impact audit and delivery verification

**Files:**
- No production changes expected.

**Interfaces:**
- Consumes: completed tokenizer/parser and repository verification scripts.
- Produces: verified commits and remote main closure evidence.

- [ ] **Step 1: Refresh and inspect CodeGraph**

Run:

```bash
codegraph sync .
codegraph status .
codegraph explore "tokenizeCurl parseCurl callers dependency paths IPC preload database execution"
```

Expected: index up to date; only parser/tests depend on tokenizer and only tests call parser.

- [ ] **Step 2: Run full local verification**

Run every command independently and require exit 0:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:all
npm run smoke:database
npm run smoke:media
npm run smoke:streaming
npm run smoke:electron
git diff --check
```

If Windows MSBuild FileTracker returns `E_ACCESSDENIED`, rerun the unchanged Electron smoke with reasonable permission and record the cause; do not alter code.

- [ ] **Step 3: Audit scope and secrets**

Run:

```bash
git status --short --branch
git status --ignored --short
git diff origin/main...HEAD --stat
git diff origin/main...HEAD --name-only
```

Expected: only the Phase B1 design/plan and `src/shared/curl/` files are changed; ignored build/index/dependency files remain uncommitted.

- [ ] **Step 4: Push and close CI**

```powershell
git push origin main
$sha = git rev-parse HEAD
$run = gh run list --branch main --commit $sha --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $run --exit-status
git fetch origin
git rev-list --left-right --count origin/main...HEAD
git status --short --branch
```

Expected: main CI success, HEAD equals origin/main, ahead/behind `0/0`, and working tree clean.
