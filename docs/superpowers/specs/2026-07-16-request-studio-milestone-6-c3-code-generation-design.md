# Request Studio Milestone 6 Phase C3 — Code Generation Foundation Design

## 1. Scope

Phase C3 adds a pure code-generation core for sanitized `RequestAssetV1` values:

```text
RequestAssetV1
  -> shared output sanitizer
  -> HTTP code-generation model
  -> language adapter
  -> deterministic generated text
```

The phase supports JavaScript Fetch and Python requests. It adds no UI, IPC,
Preload API, file saving, database migration, request execution change,
Workspace Export, cloud feature, AI generation, or template dependency.

TypeScript Axios is intentionally deferred. Axios is not installed in Request
Studio and a third adapter would duplicate formatting behavior without a
current consumer. The registry can add it later without changing the public
generation entry point.

## 2. Existing Safety Boundary

`mapSavedRequestToExportAsset` is the established Saved Request to
`RequestAssetV1` boundary. It already owns the sensitive-key matcher,
placeholder preservation, `[REDACTED]` fallback, URL credential cleanup,
structured body sanitization, and local-path cleanup.

Phase C3 must not copy these rules into each adapter. Instead,
`request-export.ts` will expose one pure sanitizer for an existing
`RequestAssetV1`. It will reuse the same private helpers and validate the
result with `requestAssetV1Schema`. The export mapper and code-generation
pipeline therefore share one source of truth.

The sanitizer preserves fixed placeholders such as `{{TOKEN}}`. Raw values
under sensitive auth, query, header, form, multipart-text, or JSON keys become
`[REDACTED]`. Errors use fixed messages and never include source values.

## 3. Public Contract

The public module exposes:

```ts
type CodeGenerationLanguage = 'javascript-fetch' | 'python-requests'

type CodeGeneratorCapability = Readonly<{
  language: CodeGenerationLanguage
  displayName: string
  supportedProtocols: readonly RequestAssetV1['protocol'][]
}>

type GeneratedCode = Readonly<{
  language: CodeGenerationLanguage
  content: string
  warnings: readonly ExportWarning[]
}>

listCodeGenerators(): readonly CodeGeneratorCapability[]

generateCode(
  asset: RequestAssetV1,
  language: CodeGenerationLanguage,
): GeneratedCode
```

The adapter registry remains private so callers cannot bypass the sanitizer.
`listCodeGenerators` returns immutable metadata only. `generateCode` is the
single execution path.

Unknown languages use a fixed `Code generator is not available.` error.
WebSocket and SSE use a fixed `Code generator does not support this protocol.`
error. No adapter generates approximate streaming code.

## 4. Intermediate HTTP Model

After sanitization, the pipeline converts an HTTP asset into a small normalized
model containing:

- method;
- URL with enabled query parameters and query API-key auth;
- enabled headers plus header-based auth;
- optional body text and body kind;
- shared warnings.

This model prevents JavaScript and Python adapters from independently
reimplementing request semantics. Query encoding preserves `{{VARIABLE}}`
tokens while encoding ordinary values, matching the existing cURL exporter.

JSON, text, and form-urlencoded bodies are supported. Multipart file entries
and binary bodies contain no exportable file content; generation omits that
content and returns the existing `file-content-omitted` warning. Opaque text
returns the existing `opaque-text` warning.

## 5. Language Adapters

### JavaScript Fetch

The Fetch adapter emits stable JavaScript using JSON string escaping. It emits
`method`, optional `headers`, and optional `body` in a fixed order. JSON
bodies use their sanitized serialized content; form bodies use
`URLSearchParams`-compatible text and the appropriate content type.

### Python requests

The Python adapter emits:

```python
import requests

response = requests.request(
    "GET",
    "https://example.com",
)
```

Optional `headers` and `data` or `json` arguments follow in a fixed order.
A small local string-literal formatter handles quotes, backslashes, control
characters, and non-ASCII text. The generated snippet may import the target
application's `requests` package; Request Studio itself adds no dependency.

## 6. Determinism

Generators do not use time, randomness, locale-sensitive formatting, database
state, Environment values, filesystem state, or network state. Object and
argument ordering is explicit. Repeated generation from the same asset and
language must return deeply equal results.

## 7. Testing

Focused tests cover:

- registry metadata and HTTP-only capabilities;
- fixed unsupported-language and unsupported-protocol errors;
- sanitizer reuse, placeholder preservation, and raw-secret removal;
- JavaScript GET, headers/auth, and POST JSON;
- Python GET and POST JSON;
- safe escaping;
- multipart/binary omission warnings;
- repeated generation equality.

The full project validation remains:

```text
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

## 8. Files and Boundaries

The implementation should stay inside `src/shared/assets/request-export.ts`
and a small `src/shared/codegen/` directory with colocated tests. No Main,
Renderer, Preload, IPC, database, execution, or CI file needs modification.
