# Request Studio Milestone 6 C1 Request Export Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert HTTP, WebSocket, and SSE Saved Request snapshots into sanitized `RequestAssetV1` values and generate deterministic safe HTTP cURL previews.

**Architecture:** Add one pure export sanitizer beside the existing asset mapper, then feed its HTTP output to one pure cURL generator. Reuse `mapSavedRequestToAsset` and `RequestAssetV1`; do not add persistence, IPC, UI, execution, schema, service, registry, or dependency layers.

**Tech Stack:** TypeScript 6, Zod 4, Vitest 4, Node.js standard library APIs only.

## Global Constraints

- Preserve existing `{{VARIABLE}}` placeholders and `[REDACTED]`; never derive placeholders from secrets.
- Never include raw credentials, resolved Environment values, local filesystem paths, database IDs, history, Experiment data, or resource metadata in output or diagnostics.
- Errors and warnings use fixed safe messages and never interpolate source input or caught exception messages.
- cURL generation supports HTTP only; WebSocket and SSE stop at sanitized `RequestAssetV1` mapping.
- Add no dependency, migration, Main/IPC/Preload/Renderer change, file download, workspace export, code generation, OpenAPI, GraphQL, installer, or execution change.
- Use TDD for every security and generation behavior.

## File Map

- Create `src/shared/assets/request-export.ts`: sanitize a Saved Request snapshot and define preview types.
- Create `src/shared/assets/request-export.test.ts`: protocol, credential, metadata, path, and safe-error tests.
- Create `src/shared/assets/curl-export.ts`: deterministic POSIX cURL preview generation for HTTP assets.
- Create `src/shared/assets/curl-export.test.ts`: cURL behavior and leak tests.
- Do not modify `request-asset.ts` or `request-asset-mapper.ts`; they already provide the structural contract.

---

### Task 1: Sanitized Saved Request Export Asset

**Files:**
- Create: `src/shared/assets/request-export.ts`
- Test: `src/shared/assets/request-export.test.ts`

**Interfaces:**
- Consumes: `SavedRequestAssetRow`, `mapSavedRequestToAsset(row): RequestAssetV1`.
- Produces: `mapSavedRequestToExportAsset(row: SavedRequestAssetRow): RequestAssetV1`, `ExportWarning`, and `ExportPreview`.

- [ ] **Step 1: Write the failing protocol and metadata test**

Use a Saved Request row containing database IDs, history, and Experiment data. Assert that HTTP, WebSocket, and SSE each map to the matching protocol and that serialized assets contain none of those metadata fixture values.

```typescript
import { describe, expect, it } from 'vitest'
import { mapSavedRequestToExportAsset } from './request-export'

const websocketConfig = JSON.stringify({
  subprotocols: [], connectTimeoutMs: 10000, idleTimeoutMs: 0,
  pingEnabled: false, pingIntervalMs: 30000, autoReconnect: false,
  maxReconnectAttempts: 3, reconnectDelayMs: 1000, maxMessageBytes: 1048576,
})
const sseConfig = JSON.stringify({
  method: 'GET', body: { type: 'none' }, connectTimeoutMs: 10000,
  idleTimeoutMs: 60000, maxEventBytes: 1048576, maxSessionDurationMs: 1800000,
})
const baseRow = {
  id: 'database-id', workspace_id: 'workspace-id', collection_id: 'collection-id',
  name: 'Export request', description: '', protocol: 'http', method: 'POST',
  url: 'https://api.example.com/items', params_json: '[]', headers_json: '[]',
  auth_json: '{"type":"none"}', body_json: '{"type":"none"}',
  settings_json: '{"timeoutMs":30000}', stream_config_json: '{}',
  history: ['history-secret'], experiment: { token: 'experiment-secret' },
}

describe('mapSavedRequestToExportAsset', () => {
it.each([
  ['http', 'https://api.example.com/items', 'POST', '{}'],
  ['websocket', 'wss://api.example.com/events', null, websocketConfig],
  ['sse', 'https://api.example.com/events', 'GET', sseConfig],
] as const)('maps a sanitized %s asset', (protocol, url, method, streamConfig) => {
  const asset = mapSavedRequestToExportAsset({
    ...baseRow, protocol, url, method, stream_config_json: streamConfig,
  })
  expect(asset.protocol).toBe(protocol)
  expect(JSON.stringify(asset)).not.toMatch(/database-id|workspace-id|history-secret|experiment-secret/)
})
})
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `npx vitest run src/shared/assets/request-export.test.ts`

Expected: FAIL because `./request-export` does not exist.

- [ ] **Step 3: Add focused security tests**

Add fixtures for raw bearer/basic/API-key values; sensitive URL query keys; sensitive enabled and disabled headers, params, form and multipart fields; nested JSON credentials; fixed placeholders; binary and multipart Windows paths; recognizable credentials and paths in text; malformed JSON body content.

```typescript
expect(asset.request.params.map((entry) => entry.value)).toEqual(['[REDACTED]', '{{TOKEN}}'])
expect(asset.request.headers[0].value).toBe('[REDACTED]')
expect(asset.request.auth).toEqual({ type: 'basic', username: 'user', password: '[REDACTED]' })
expect(asset.request.url).toContain('access_token=[REDACTED]')
expect(JSON.stringify(asset)).not.toMatch(/query-secret|header-secret|basic-secret|body-secret|C:\\\\Users/)
const malformedJsonRow = {
  ...baseRow,
  body_json: JSON.stringify({ type: 'json', content: '{"token":"malformed-body-secret"' }),
}
expect(() => mapSavedRequestToExportAsset(malformedJsonRow))
  .toThrow('Request export JSON body is invalid.')
```

Catch the malformed-body error once and assert `String(error)` does not contain the secret fixture.

- [ ] **Step 4: Implement the minimum sanitizer**

Create `request-export.ts` with these exact public types:

```typescript
export type ExportWarning = Readonly<{ code: string; message: string }>
export type ExportPreview = Readonly<{
  format: 'curl'
  protocol: 'http'
  filenameSuggestion: string
  content: string
  warnings: readonly ExportWarning[]
}>

export function mapSavedRequestToExportAsset(row: SavedRequestAssetRow): RequestAssetV1
```

Private implementation rules:

1. `protect(value)` returns an existing complete placeholder or `[REDACTED]`; every other value becomes `[REDACTED]`.
2. `parseJson(value, safeMessage)` catches `JSON.parse` and throws only `new TypeError(safeMessage)`.
3. `sanitizeUrl` splits only the raw query portion, safely decodes each key for classification, replaces sensitive values with `[REDACTED]`, and otherwise preserves the original pair. A decode failure uses `INVALID_EXPORT_DATA`; it never echoes the URL.
4. `sanitizeEntries` clones arrays and protects `value` when `key` matches `/authorization|cookie|token|password|api[-_ ]?key|secret/i`.
5. `sanitizeAuth` protects bearer `token`, basic `password`, and API-key `value`.
6. `sanitizeJsonValue` recursively protects values under sensitive keys.
7. `sanitizeBody` handles JSON, text, form-urlencoded, multipart, and binary. File entries and binary bodies receive `fileRef: null`; sensitive multipart text receives `[REDACTED]`.
8. `sanitizeStreamConfig` sanitizes its optional `body`, covering SSE storage.
9. Serialize the sanitized `url`, `params_json`, `headers_json`, `auth_json`, `body_json`, and `stream_config_json` into a cloned row and return `mapSavedRequestToAsset(sanitizedRow)`.

Use these exact safe errors:

```typescript
const INVALID_EXPORT_DATA = 'Saved request export data is invalid.'
const INVALID_JSON_BODY = 'Request export JSON body is invalid.'
```

Text sanitization must preserve ordinary text and apply these four deterministic transformations in order: Bearer authorization values, credential-shaped `key=value` or `key:value` assignments, Windows absolute paths, and common POSIX absolute paths rooted at `/Users`, `/home`, `/tmp`, `/var`, `/opt`, or `/etc`.

- [ ] **Step 5: Run focused and existing asset tests to verify GREEN**

Run: `npx vitest run src/shared/assets/request-export.test.ts src/shared/assets/request-asset.test.ts`

Expected: both test files PASS and no known secret fixture appears in test output.

- [ ] **Step 6: Review Task 1 scope**

Run: `git diff --check`

Run: `git diff -- src/shared/assets/request-export.ts src/shared/assets/request-export.test.ts`

Expected: no logging, IO, Environment lookup, secret-derived placeholder, or unrelated change.

---

### Task 2: Deterministic HTTP cURL Export Preview

**Files:**
- Create: `src/shared/assets/curl-export.ts`
- Test: `src/shared/assets/curl-export.test.ts`

**Interfaces:**
- Consumes: `Extract<RequestAssetV1, { protocol: 'http' }>` and Task 1 preview types.
- Produces: `createCurlExportPreview(asset: HttpRequestAsset): ExportPreview`.

- [ ] **Step 1: Write failing GET, query, header, auth, and quoting tests**

Build a valid HTTP asset fixture and assert deterministic preview metadata and POSIX arguments:

```typescript
import { describe, expect, it } from 'vitest'
import type { RequestAssetV1 } from './request-asset'
import { createCurlExportPreview } from './curl-export'

type HttpAsset = Extract<RequestAssetV1, { protocol: 'http' }>
const asset = (overrides: Partial<HttpAsset['request']> = {}): HttpAsset => ({
  format: 'request-studio.request', version: 1, name: 'Users request',
  description: '', protocol: 'http',
  request: {
    method: 'GET', url: 'https://api.example.com/users', params: [], headers: [],
    auth: { type: 'none' }, body: { type: 'none' }, settings: { timeoutMs: 30000 },
    ...overrides,
  },
})

const preview = createCurlExportPreview(asset({
  params: [{ id: 'p1', enabled: true, key: 'q', value: "O'Reilly" }],
  headers: [{ id: 'h1', enabled: true, key: 'X-Token', value: '{{TOKEN}}' }],
  auth: { type: 'bearer', token: '{{BEARER_TOKEN}}' },
}))

expect(preview).toMatchObject({
  format: 'curl', protocol: 'http', filenameSuggestion: 'users-request.sh',
})
expect(preview.content).toContain("--request 'GET'")
expect(preview.content).toContain("--header 'X-Token: {{TOKEN}}'")
expect(preview.content).toContain("--header 'Authorization: Bearer {{BEARER_TOKEN}}'")
expect(preview.content).toContain("'\"'\"'Reilly'")
```

Add these table cases:

```typescript
it.each([
  [{ type: 'basic', username: 'user', password: '{{PASSWORD}}' } as const,
    "--user 'user:{{PASSWORD}}'"],
  [{ type: 'api-key', placement: 'header', key: 'X-API-Key', value: '{{API_KEY}}' } as const,
    "--header 'X-API-Key: {{API_KEY}}'"],
])('renders sanitized auth without resolving it', (auth, expected) => {
  expect(createCurlExportPreview(asset({ auth })).content).toContain(expected)
})
```

- [ ] **Step 2: Run the new test and verify RED**

Run: `npx vitest run src/shared/assets/curl-export.test.ts`

Expected: FAIL because `./curl-export` does not exist.

- [ ] **Step 3: Add body, warning, and leak tests**

Add these assertions:

```typescript
const jsonPreview = createCurlExportPreview(asset({
  method: 'POST', body: { type: 'json', content: '{"token":"[REDACTED]"}' },
}))
expect(jsonPreview.content).toContain("--header 'Content-Type: application/json'")
expect(jsonPreview.content).toContain("--data-raw '{\"token\":\"[REDACTED]\"}'")
expect(jsonPreview.warnings.map((warning) => warning.code)).toContain('sanitized-values')

const formPreview = createCurlExportPreview(asset({
  method: 'POST',
  auth: { type: 'api-key', placement: 'query', key: 'api_key', value: '{{API_KEY}}' },
  body: { type: 'form-urlencoded', entries: [
    { id: 'f1', enabled: true, key: 'name', value: 'Tom' },
    { id: 'f2', enabled: false, key: 'skip', value: 'disabled-secret' },
  ] },
}))
expect(formPreview.content).toContain('api_key={{API_KEY}}')
expect(formPreview.content).toContain("--data-urlencode 'name=Tom'")
expect(formPreview.content).not.toContain('disabled-secret')

const binaryPreview = createCurlExportPreview(asset({
  method: 'POST',
  body: { type: 'binary', fileRef: null, contentType: 'application/octet-stream' },
}))
expect(binaryPreview.content).not.toMatch(/--data|--form|secret\.bin/)
expect(binaryPreview.warnings).toContainEqual({
  code: 'file-content-omitted', message: 'Local file content was omitted.',
})
```

Add explicit cases for multipart text plus one file entry, an existing Content-Type header, a text body, duplicate query keys, and an all-symbol request name. Assert respectively: `--form 'name=Tom'` exists; no file argument exists and `file-content-omitted` exists; Content-Type occurs once; `opaque-text` exists; both duplicate pairs occur in order; filename equals `request.sh`. Serialize every result and assert it excludes the test credentials, local path, and database-ID fixtures.

- [ ] **Step 4: Implement the minimum cURL generator**

Create `curl-export.ts` with the exact public signature:

```typescript
type HttpRequestAsset = Extract<RequestAssetV1, { protocol: 'http' }>

export function createCurlExportPreview(asset: HttpRequestAsset): ExportPreview
```

Private implementation rules:

1. `quote(value)` wraps one POSIX argument in single quotes and replaces each inner quote with the standard `'"'"'` sequence.
2. `encodePart(value)` percent-encodes query text while preserving complete `{{VARIABLE}}` placeholders.
3. `withQuery(url, entries)` appends enabled query entries in source order and preserves duplicates.
4. Add query-placed API-key auth to the same query list; render header API-key, Bearer, and Basic auth as cURL arguments.
5. Emit enabled request headers in source order.
6. Add Content-Type for JSON or typed text only when no enabled Content-Type header already exists.
7. Emit JSON/text with `--data-raw`, form-urlencoded with one `--data-urlencode` per enabled entry, and multipart text with `--form`.
8. Omit binary content and multipart file parts and add only the fixed `file-content-omitted` warning.
9. Add `sanitized-values` when the asset contains `[REDACTED]`; add `opaque-text` for text bodies.
10. Derive a lowercase ASCII slug of at most 80 characters from the request name, falling back to `request.sh`.
11. Join arguments into one deterministic multiline `curl` command. Never spawn a process or touch the filesystem.

Use only these fixed warnings:

```typescript
{ code: 'sanitized-values', message: 'Sensitive values were redacted.' }
{ code: 'opaque-text', message: 'Review unstructured text for opaque sensitive values.' }
{ code: 'file-content-omitted', message: 'Local file content was omitted.' }
```

- [ ] **Step 5: Run all focused asset/export tests to verify GREEN**

Run: `npx vitest run src/shared/assets/curl-export.test.ts src/shared/assets/request-export.test.ts src/shared/assets/request-asset.test.ts`

Expected: all focused tests PASS.

- [ ] **Step 6: Run typecheck and review Task 2 scope**

Run: `npm run typecheck`

Run: `git diff --check`

Expected: exit 0; no shell execution, filesystem access, logging, secret resolution, or non-HTTP cURL branch.

---

### Task 3: Regression Verification and Delivery

**Files:**
- Verify: `src/shared/assets/request-export.ts`
- Verify: `src/shared/assets/request-export.test.ts`
- Verify: `src/shared/assets/curl-export.ts`
- Verify: `src/shared/assets/curl-export.test.ts`

**Interfaces:**
- Consumes: completed C1 shared modules.
- Produces: one reviewed feature commit and push/PR/CI/main-closure evidence.

- [ ] **Step 1: Confirm scope and ignored-file hygiene**

Run:

```bash
git status --short --branch
git diff --stat
git diff --name-only
git diff --check
git status --ignored
```

Expected: only the four C1 shared files are uncommitted. No `.env`, database, log, resource, screenshot, `.codegraph`, `.ocr-results`, or user-data file is staged.

- [ ] **Step 2: Run the complete local validation matrix**

Run each command separately:

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

Expected: every command exits 0. If Electron smoke hits the Windows MSBuild FileTracker permission boundary, rerun the identical command with reasonable elevated permission and record the original error; do not change product code.

- [ ] **Step 3: Commit one coherent feature change**

Run:

```bash
git add src/shared/assets/request-export.ts src/shared/assets/request-export.test.ts src/shared/assets/curl-export.ts src/shared/assets/curl-export.test.ts
git diff --cached --check
git diff --cached --stat
git commit -m "feat: add request export foundation"
```

Expected: one feature commit containing only C1 shared code and tests.

- [ ] **Step 4: Publish through the normal PR flow**

Push the isolated `codex/` branch without force and open a PR titled `Milestone 6 C1 — Request Export Foundation`. The description records architecture, security behavior, cURL coverage, validation, and explicit non-goals. Wait for all required checks; do not amend, rebase, locally squash, force push, or bypass checks.

- [ ] **Step 5: Verify main closure and report**

After merge, update local `main` with `git pull --ff-only origin main`, then run:

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
git rev-list --left-right --count HEAD...origin/main
```

Expected: `HEAD = origin/main`, ahead/behind `0/0`, and clean working tree. The final Chinese report records Git, CodeGraph, architecture, security, cURL, tests, CI, differences from the prompt, workflow/Run/Job IDs, commit SHA, duration, and conclusion.
