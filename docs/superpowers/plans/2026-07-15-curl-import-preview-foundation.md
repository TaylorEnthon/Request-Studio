# cURL Import Preview Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure preview boundary that converts safe Phase B1 cURL parser output into a stable RequestAsset-compatible review model without storing credentials or performing imports.

**Architecture:** One shared module calls `parseCurl`, revalidates its HTTP request subtree through the Phase A1 asset schema, and returns a discriminated success/failure result. It normalizes parser warnings and sensitive placeholder metadata into deterministic UI-independent contracts while keeping blocking parser failures separate from successful previews.

**Tech Stack:** TypeScript, Zod through the existing RequestAsset schema, Vitest; no new dependency.

## Global Constraints

- Add only `src/shared/curl/curl-import-preview.ts` and `src/shared/curl/curl-import-preview.test.ts` as production/test files.
- Preserve the Phase B1 256 KiB input limit by calling `parseCurl`; do not duplicate the tokenizer.
- Never return or log raw tokens, passwords, API keys, file paths, complete cURL input, or runtime metadata.
- No React UI, IPC, Preload, SQLite, migration, Saved Request creation, Environment creation, filesystem, network, execution, export, or code generation changes.
- Functions are synchronous, deterministic, readonly, and free of global state.

---

### Task 1: Preview contract, normalization, and safe failures

**Files:**
- Create: `src/shared/curl/curl-import-preview.ts`
- Create: `src/shared/curl/curl-import-preview.test.ts`

**Interfaces:**
- Consumes: `parseCurl`, `ParsedCurlRequest`, `SensitiveField`, `CurlParseError`, `CurlDialect`, `CurlDialectOption`, `CurlErrorCode`, and `requestAssetV1Schema`.
- Produces: `CurlPreviewIssue`, `CurlSensitiveMapping`, `CurlImportPreview`, `CurlImportPreviewResult`, `normalizeCurlImportPreview(parsed)`, and `previewCurlImport(input, requestedDialect?)`.

- [ ] **Step 1: Write failing normal-preview tests**

Create tests that specify the public shape:

```ts
const get = previewCurlImport('curl https://example.com/users')
expect(get).toMatchObject({
  ok: true,
  preview: {
    protocol: 'http',
    dialect: 'posix',
    request: { method: 'GET', url: 'https://example.com/users', auth: { type: 'none' }, body: { type: 'none' } },
    warnings: [],
    sensitiveMappings: [],
  },
})

const post = previewCurlImport("curl -H 'Content-Type: application/json' -d '{\"a\":1}' https://example.com")
expect(post).toMatchObject({
  ok: true,
  preview: { protocol: 'http', request: { method: 'POST', body: { type: 'json', content: '{"a":1}' } } },
})
```

- [ ] **Step 2: Write failing sensitive, warning, and failure tests**

Use credentials assembled at runtime so test failure output does not contain a complete fixture credential:

```ts
const token = ['preview', 'bearer', 'fixture'].join('-')
const bearer = previewCurlImport(`curl -H "Authorization: Bearer ${token}" https://example.com`)
expect(bearer).toMatchObject({
  ok: true,
  preview: {
    request: { auth: { type: 'bearer', token: '{{TOKEN}}' } },
    sensitiveMappings: [{
      kind: 'bearer-token', placeholder: '{{TOKEN}}', location: 'auth.token', suggestedVariable: 'TOKEN',
    }],
  },
})
expect(JSON.stringify(bearer)).not.toContain(token)

const inferred = previewCurlImport("curl -d 'a=1' https://example.com")
expect(inferred).toMatchObject({
  ok: true,
  preview: { warnings: [{ code: 'METHOD_INFERRED', severity: 'warning' }] },
})

expect(previewCurlImport('curl --compressed https://example.com')).toMatchObject({
  ok: false,
  issues: [{ code: 'CURL_UNSUPPORTED_FLAG', severity: 'error' }],
})
expect(previewCurlImport('curl -d @private.json https://example.com')).toMatchObject({
  ok: false,
  issues: [{ code: 'CURL_FILE_REFERENCE', severity: 'error' }],
})
expect(previewCurlImport('curl https://example.com', 'fish')).toEqual({
  ok: false,
  dialect: 'unknown',
  issues: [{ code: 'UNKNOWN_DIALECT', message: 'The selected shell dialect is not supported.', severity: 'error' }],
})
```

Also assert API-key header, Basic auth, sensitive query, and JSON-body locations; serialized results and issues must exclude their credential/path fixtures.

- [ ] **Step 3: Run RED**

Run: `npm test -- src/shared/curl/curl-import-preview.test.ts`

Expected: FAIL because `./curl-import-preview` does not exist.

- [ ] **Step 4: Implement the minimal preview module**

Create these exact public contracts:

```ts
export type CurlPreviewSeverity = 'warning' | 'error'
export interface CurlPreviewIssue {
  readonly code: string
  readonly message: string
  readonly severity: CurlPreviewSeverity
}
export interface CurlSensitiveMapping {
  readonly kind: 'bearer-token' | 'basic-username' | 'basic-password' | 'api-key' | 'header-secret'
  readonly placeholder: string
  readonly location: string
  readonly suggestedVariable: string
}
export interface CurlImportPreview {
  readonly protocol: 'http'
  readonly dialect: CurlDialect
  readonly request: ParsedCurlRequest['request']
  readonly warnings: readonly CurlPreviewIssue[]
  readonly sensitiveMappings: readonly CurlSensitiveMapping[]
}
export type CurlImportPreviewResult =
  | Readonly<{ ok: true; preview: CurlImportPreview }>
  | Readonly<{ ok: false; dialect: CurlDialect | 'unknown'; issues: readonly CurlPreviewIssue[] }>
```

Implementation rules:

1. `normalizeCurlImportPreview(parsed)` validates `{ format: 'request-studio.request', version: 1, name: 'cURL Import Preview', description: '', protocol: 'http', request: parsed.request }` through `requestAssetV1Schema` and uses the validated request.
2. Map `Method inferred as POST from request data.` to `{ code: 'METHOD_INFERRED', message: 'POST was inferred from request data.', severity: 'warning' }`; map any future parser warning to a fixed `PARSER_WARNING` message.
3. Map B1 kinds to preview kinds, converting `bearer` to `bearer-token`.
4. Extract `suggestedVariable` only with `/^\{\{([A-Z][A-Z0-9_]*)\}\}$/`; reject an invalid placeholder instead of returning it.
5. Resolve location by comparing the placeholder against auth fields, header values, query values, then body content. Throw a fixed internal error if no location exists.
6. `previewCurlImport(input, requestedDialect: string = 'auto')` validates dialect against `auto | posix | powershell | cmd` before calling `parseCurl`.
7. Catch `CurlParseError` and return a code built as ``CURL_${error.code}`` with a fixed message selected from a complete `Record<CurlErrorCode, string>`; omit flag, token, and source excerpts.
8. Catch any other error and return `PREVIEW_FAILED` with `The cURL preview could not be created.`.

- [ ] **Step 5: Run GREEN and regression checks**

Run:

```bash
npm test -- src/shared/curl/curl-import-preview.test.ts
npm test -- src/shared/curl/curl-parser.test.ts src/shared/curl/curl-import-preview.test.ts src/shared/assets/request-asset.test.ts
npm run lint
npm run typecheck
```

Expected: all focused tests PASS; lint and typecheck exit 0.

- [ ] **Step 6: Commit preview foundation**

```bash
git add src/shared/curl/curl-import-preview.ts src/shared/curl/curl-import-preview.test.ts
git commit -m "feat: add curl import preview foundation"
```

---

### Task 2: Impact audit and delivery closure

**Files:**
- No production changes expected.

**Interfaces:**
- Consumes: completed preview module and repository scripts.
- Produces: verified main commits, successful CI, and clean Git state.

- [ ] **Step 1: Refresh CodeGraph and confirm isolation**

```bash
codegraph sync .
codegraph status .
codegraph explore "previewCurlImport normalizeCurlImportPreview callers IPC preload database network execution"
```

Expected: index up to date; preview calls parser, tests call preview, and no product layer calls preview yet.

- [ ] **Step 2: Run complete local verification**

Run each independently and require exit 0:

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

If Windows MSBuild FileTracker returns `E_ACCESSDENIED`, rerun the unchanged Electron smoke with reasonable permission and record the cause; never modify code to bypass it.

- [ ] **Step 3: Audit scope**

```bash
git status --short --branch
git status --ignored --short
git diff origin/main...HEAD --stat
git diff origin/main...HEAD --name-only
```

Expected: only the B2.1 design/plan and two `curl-import-preview` files differ; ignored index, dependency, build, and tsbuildinfo files remain uncommitted.

- [ ] **Step 4: Fast-forward main, clean worktree, push, and verify CI**

Use the already-authorized repository workflow: fast-forward the verified feature branch into `main`, rerun `npm test` on merged main, remove the owned `.worktrees/` worktree, delete only the merged local branch, push `main`, watch its exact commit CI, fetch origin, and verify:

```text
HEAD = origin/main
ahead/behind = 0/0
working tree clean
```
