# Request Studio Milestone 6 Phase C3 Code Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pure, deterministic, secret-safe code-generation core for JavaScript Fetch and Python requests.

**Architecture:** `generateCode` is the only public generation entry point. It passes `RequestAssetV1` through the existing export sanitizer rules, builds one normalized HTTP model, checks a private capability registry, and invokes a language adapter.

**Tech Stack:** TypeScript 6, Zod 4, Vitest 4, Node.js standard library APIs.

## Global Constraints

- Do not add UI, Tools entries, Preload APIs, IPC, file saving, database migrations, execution changes, Workspace Export, cloud behavior, AI generation, or template dependencies.
- Do not add an Axios dependency or TypeScript Axios adapter in Phase C3.
- Keep generators pure: no database, Environment, filesystem, network, time, randomness, or locale state.
- Preserve `{{VARIABLE}}` placeholders and replace unsafe sensitive values with `[REDACTED]`.
- Use fixed errors that never include asset values, generated content, paths, IDs, or caught exception messages.
- WebSocket and SSE are capability-only and must return an unsupported-protocol error.
- Every production behavior follows RED, GREEN, REFACTOR.

---

### Task 1: Shared Output Sanitizer

**Files:**
- Modify: `src/shared/assets/request-export.ts`
- Modify: `src/shared/assets/request-export.test.ts`

**Interfaces:**
- Consumes: `RequestAssetV1`, `requestAssetV1Schema`, and the existing `sanitizeText`, `sanitizeUrl`, `sanitizeEntries`, `sanitizeAuth`, and `sanitizeBody` helpers.
- Produces: `sanitizeRequestAssetForOutput(asset: RequestAssetV1): RequestAssetV1`.

- [ ] **Step 1: Write the failing sanitizer test**

Add an HTTP `RequestAssetV1` candidate containing a raw bearer value, raw
sensitive header and query values, a JSON password, a local path in the
description, and a safe `{{VISIBLE_TOKEN}}` placeholder. Cast the deliberately
unsafe fixture through `unknown` only at the test call.

```ts
it('sanitizes an existing request asset with the export rules', () => {
  const unsafe = {
    format: 'request-studio.request',
    version: 1,
    protocol: 'http',
    name: 'Users',
    description: 'source=C:\\Users\\me\\secret.txt',
    request: {
      method: 'POST',
      url: 'https://api.example.com/users?api_key=raw-query',
      params: [
        { id: 'p1', enabled: true, key: 'token', value: 'raw-param' },
        { id: 'p2', enabled: true, key: 'visible', value: '{{VISIBLE_TOKEN}}' },
      ],
      headers: [{ id: 'h1', enabled: true, key: 'X-Api-Key', value: 'raw-header' }],
      auth: { type: 'bearer', token: 'raw-bearer' },
      body: { type: 'json', content: '{"password":"raw-body","name":"Ada"}' },
      settings: { timeoutMs: 30000 },
    },
  }

  const result = sanitizeRequestAssetForOutput(unsafe as unknown as RequestAssetV1)
  const serialized = JSON.stringify(result)

  expect(serialized).not.toMatch(
    /raw-query|raw-param|raw-header|raw-bearer|raw-body|C:\\\\Users/,
  )
  expect(serialized).toContain('{{VISIBLE_TOKEN}}')
  expect(serialized).toContain('[REDACTED]')
  expect(requestAssetV1Schema.parse(result)).toEqual(result)
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run src/shared/assets/request-export.test.ts
```

Expected: FAIL because `sanitizeRequestAssetForOutput` is not exported.

- [ ] **Step 3: Implement the minimum shared sanitizer**

Import `requestAssetV1Schema` as a runtime value. Build a sanitized candidate
without mutating the input:

```ts
export function sanitizeRequestAssetForOutput(asset: RequestAssetV1): RequestAssetV1 {
  try {
    const request = asset.request
    const sanitizedRequest: Record<string, unknown> = {
      ...request,
      url: sanitizeUrl(request.url),
      params: sanitizeEntries(request.params),
      headers: sanitizeEntries(request.headers),
      auth: sanitizeAuth(request.auth),
    }
    if ('body' in request) sanitizedRequest.body = sanitizeBody(request.body)

    return requestAssetV1Schema.parse({
      ...asset,
      name: sanitizeText(asset.name),
      description: sanitizeText(asset.description),
      request: sanitizedRequest,
    })
  } catch {
    throw new TypeError(INVALID_EXPORT_DATA)
  }
}
```

Do not change `mapSavedRequestToExportAsset` behavior or duplicate any
sensitive-key regex.

- [ ] **Step 4: Verify GREEN and export compatibility**

Run:

```bash
npx vitest run src/shared/assets/request-export.test.ts src/shared/assets/request-asset.test.ts src/shared/assets/curl-export.test.ts
npm run typecheck
git diff --check
```

Expected: focused tests and typecheck pass with no secret-bearing diagnostics.

---

### Task 2: Generator Contract, HTTP Model, and JavaScript Fetch

**Files:**
- Create: `src/shared/codegen/code-generation.ts`
- Create: `src/shared/codegen/code-generation.test.ts`
- Create: `src/shared/codegen/javascript-fetch-generator.ts`
- Create: `src/shared/codegen/javascript-fetch-generator.test.ts`

**Interfaces:**
- Consumes: `sanitizeRequestAssetForOutput`, `RequestAssetV1`, and `ExportWarning`.
- Produces: `CodeGenerationLanguage`, `CodeGeneratorCapability`, `GeneratedCode`, `HttpCodeGenerationModel`, `listCodeGenerators()`, `generateCode(asset, language)`, and `generateJavaScriptFetch(model)`.

- [ ] **Step 1: Write failing contract and capability tests**

```ts
it('registers deterministic HTTP-only generator capabilities', () => {
  expect(listCodeGenerators()).toEqual([
    {
      language: 'javascript-fetch',
      displayName: 'JavaScript Fetch',
      supportedProtocols: ['http'],
    },
  ])
  expect(listCodeGenerators()).toEqual(listCodeGenerators())
})

it('rejects missing generators and unsupported protocols with fixed errors', () => {
  expect(() => generateCode(httpAsset, 'missing' as CodeGenerationLanguage))
    .toThrow('Code generator is not available.')
  expect(() => generateCode(webSocketAsset, 'javascript-fetch'))
    .toThrow('Code generator does not support this protocol.')
})
```

Add a security/determinism test that passes an unsafe HTTP asset containing
`raw-generator-secret`, calls `generateCode` twice, and asserts:

```ts
expect(first).toEqual(second)
expect(first.content).toContain('{{TOKEN}}')
expect(JSON.stringify(first)).not.toContain('raw-generator-secret')
```

- [ ] **Step 2: Write failing JavaScript output tests**

Cover:

```ts
expect(generateCode(getAsset, 'javascript-fetch').content).toBe(
  [
    'const response = await fetch("https://api.example.com/users", {',
    '  method: "GET",',
    '});',
  ].join('\n'),
)
```

For POST JSON with a bearer token and an ordinary header, assert exact output
contains the fixed order `method`, `headers`, then `body`; assert the body
uses the sanitized JSON string and the Authorization header retains
`Bearer {{TOKEN}}`.

Add one escaping fixture containing quotes, backslashes, and a query placeholder.

- [ ] **Step 3: Run both new tests and verify RED**

Run:

```bash
npx vitest run src/shared/codegen/code-generation.test.ts src/shared/codegen/javascript-fetch-generator.test.ts
```

Expected: FAIL because the code-generation modules do not exist.

- [ ] **Step 4: Implement the public types and private registry**

Define:

```ts
export type CodeGenerationLanguage = 'javascript-fetch' | 'python-requests'

export type CodeGeneratorCapability = Readonly<{
  language: CodeGenerationLanguage
  displayName: string
  supportedProtocols: readonly RequestAssetV1['protocol'][]
}>

export type GeneratedCode = Readonly<{
  language: CodeGenerationLanguage
  content: string
  warnings: readonly ExportWarning[]
}>

export type HttpCodeGenerationModel = Readonly<{
  method: Extract<RequestAssetV1, { protocol: 'http' }>['request']['method']
  url: string
  headers: readonly Readonly<{ key: string; value: string }>[]
  basicAuth: Readonly<{ username: string; password: string }> | null
  body: Readonly<{
    kind: 'json' | 'text' | 'form-urlencoded'
    content: string
  }> | null
  warnings: readonly ExportWarning[]
}>
```

Use a private adapter type and a fixed array containing the JavaScript adapter.
`listCodeGenerators` maps only metadata and returns fresh frozen-compatible
objects. Task 3 adds the Python adapter after its test observes the missing
capability.

- [ ] **Step 5: Implement the centralized HTTP model**

In `generateCode`, locate the adapter, sanitize the asset, check
`supportedProtocols`, build the model, and call the adapter.

The model builder must:

1. append enabled query entries and query API-key auth;
2. preserve placeholder tokens while URI-encoding ordinary query text;
3. include enabled headers;
4. convert bearer and header API-key auth into headers;
5. preserve basic auth separately;
6. support JSON, text, and form-urlencoded body text;
7. omit multipart/binary file content and emit `file-content-omitted`;
8. emit `opaque-text` for text bodies;
9. prepend `sanitized-values` when the sanitized asset contains `[REDACTED]`.

Use the existing warning codes and messages from `curl-export.ts` verbatim.

- [ ] **Step 6: Implement JavaScript Fetch formatting**

`generateJavaScriptFetch(model)` builds a string array. Use `JSON.stringify`
for every JavaScript string literal. Render headers only when present or basic
auth exists. For basic auth emit:

```js
"Authorization": `Basic ${btoa("username:{{BASIC_PASSWORD}}")}`,
```

Render `body` only when present. The final line is always `});` and the
result has no trailing newline.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
npx vitest run src/shared/codegen/code-generation.test.ts src/shared/codegen/javascript-fetch-generator.test.ts src/shared/assets/request-export.test.ts
npm run typecheck
git diff --check
```

Expected: contract, security, determinism, and JavaScript tests pass.

---

### Task 3: Python requests Adapter and Complete Delivery

**Files:**
- Create: `src/shared/codegen/python-requests-generator.ts`
- Create: `src/shared/codegen/python-requests-generator.test.ts`
- Modify: `src/shared/codegen/code-generation.ts`
- Verify: all Phase C3 files

**Interfaces:**
- Consumes: `HttpCodeGenerationModel`.
- Produces: `generatePythonRequests(model): string` and a completed `python-requests` registry adapter.

- [ ] **Step 1: Write failing Python GET and POST tests**

First extend the registry assertion in `code-generation.test.ts` with:

```ts
{
  language: 'python-requests',
  displayName: 'Python requests',
  supportedProtocols: ['http'],
}
```

Assert exact GET output:

```python
import requests

response = requests.request(
    "GET",
    "https://api.example.com/users",
)
```

For POST JSON, headers, and basic auth, assert exact stable argument order:

```text
method
URL
headers
auth
data
```

Assert placeholders remain literal, and quotes, backslashes, newlines, and
non-ASCII text produce a valid deterministic double-quoted Python string.

- [ ] **Step 2: Run the Python test and verify RED**

Run:

```bash
npx vitest run src/shared/codegen/python-requests-generator.test.ts
```

Expected: FAIL because the Python adapter module and registry capability do not
exist.

- [ ] **Step 3: Implement the minimum Python formatter**

Use a local:

```ts
const pythonString = (value: string): string =>
  JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
```

Build the request call as fixed lines. Render dictionaries with one entry per
line and four additional spaces of indentation. Use `auth=(username,
password)` only for basic auth. Use `data=content` for all supported body
kinds so the adapter never has to parse or reinterpret sanitized JSON.

- [ ] **Step 4: Register Python and verify focused GREEN**

Append the Python capability and `generatePythonRequests` function to the
private registry after JavaScript. Run:

```bash
npx vitest run src/shared/codegen src/shared/assets/request-export.test.ts src/shared/assets/curl-export.test.ts
npm run typecheck
git diff --check
```

Expected: all C3, export, and cURL tests pass.

- [ ] **Step 5: Review C3 scope with CodeGraph**

Run:

```bash
codegraph sync
codegraph explore "Trace Phase C3 from generateCode through sanitizeRequestAssetForOutput, the HTTP model, JavaScript Fetch, and Python requests. Confirm no Renderer, Main, database, filesystem, Environment, network, or execution-engine path is reachable."
git diff --name-only
git status --ignored
```

Expected: only shared codegen, shared sanitizer tests, and C3 docs are in scope;
`.codegraph`, `node_modules`, build output, logs, databases, screenshots,
resources, and secrets remain ignored and unstaged.

- [ ] **Step 6: Run the complete validation matrix**

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

If Electron smoke fails only with Windows MSBuild FileTracker permission
denial, rerun the identical command with elevated permission and record both
results. Do not change code to bypass the environment.

- [ ] **Step 7: Commit the feature**

Verify scope, then commit:

```bash
git status --short --branch
git diff --stat
git diff --name-only
git diff --check
git add src/shared/assets/request-export.ts src/shared/assets/request-export.test.ts src/shared/codegen
git diff --cached --check
git diff --cached --stat
git commit -m "feat: add code generation foundation"
```

- [ ] **Step 8: Publish and close Phase C3**

Push `codex/milestone-6-c3-codegen` without force. Create a ready PR titled
`Milestone 6 C3 — Code Generation Foundation`. Wait for required CI, merge
through the repository's normal squash flow, fetch and fast-forward local
`main`, then remove only the merged C3 worktree and local branch.

Final verification:

```text
HEAD = origin/main
ahead / behind = 0 / 0
working tree clean
main CI success
```

The final Chinese report records CodeGraph, architecture, supported languages,
security behavior, test counts, PR, CI Run/Job/commit/conclusion, prompt
adjustments, cleanup, and the explicit absence of UI, Axios, database, and
execution-engine changes.
