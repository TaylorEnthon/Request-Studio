# Request Studio Milestone 6 Phase B2.1 — cURL Import Preview Design

## 1. Scope

Phase B2.1 adds a pure preview boundary between the Phase B1 cURL parser and a future importer. It normalizes safe parser output into a stable review contract but does not render UI, call IPC, persist data, create Saved Requests or Environments, access files or networks, execute requests, export assets, or generate code.

The data flow is deliberately one-way:

```text
cURL text -> parseCurl -> previewCurlImport -> future importer
```

The parser does not create previews, and the preview layer does not save requests.

## 2. File Boundary

Add only two files under `src/shared/curl/`:

- `curl-import-preview.ts`: contract types, normalization, safe issue mapping, and the public preview function.
- `curl-import-preview.test.ts`: normal, sensitive, warning, failure, and regression tests.

No class or dependency is needed because the layer is stateless, deterministic, and synchronous.

## 3. Preview Contract

`CurlImportPreview` contains:

- `protocol: 'http'`;
- selected parser dialect: `posix | powershell | cmd`;
- the complete HTTP RequestAsset-compatible request subtree, including method, URL, params, headers, auth, body, and settings;
- structured `warnings`;
- structured `sensitiveMappings`.

The request subtree is revalidated through `requestAssetV1Schema` using a fixed temporary envelope. This reuses the Phase A1 trust boundary without changing the Asset contract.

The public entrypoint returns a discriminated result:

```text
{ ok: true, preview }

or

{ ok: false, dialect, issues }
```

Blocking parser failures do not produce partial previews.

## 4. Warning and Failure Model

Every preview issue contains a stable `code`, fixed user-facing `message`, and `severity: 'warning' | 'error'`.

- The B1 method-inference warning maps to `METHOD_INFERRED`.
- Other safe parser warnings map to `PARSER_WARNING` with a generic message.
- `CurlParseError` codes map to stable `CURL_<CODE>` failures.
- An unsupported requested dialect maps to `UNKNOWN_DIALECT`, `dialect: 'unknown'`, and never reaches the parser.
- Unexpected failures map to `PREVIEW_FAILED` with a generic message.

Unsupported flags and file references remain blocking errors. They are not downgraded to warnings. Messages never contain the command, token value, header value, body, file path, or credential.

## 5. Sensitive Mapping

Each mapping contains only:

- normalized kind;
- placeholder;
- location in the already-sanitized request;
- suggested variable name derived from the placeholder.

Examples:

- bearer token -> `auth.token`, `{{TOKEN}}`, `TOKEN`;
- Basic password -> `auth.password`, `{{BASIC_PASSWORD}}`, `BASIC_PASSWORD`;
- API-key header -> `header.X-API-Key`, `{{API_KEY}}`, `API_KEY`;
- sensitive query -> `query.<key>`;
- sensitive JSON content -> `body`.

Location discovery compares placeholders, never original values. `suggestedVariable` is extracted only from the fixed `{{VARIABLE}}` placeholder syntax. No secret, hash, prefix, suffix, or length is stored or derived.

## 6. Pure Functions

`normalizeCurlImportPreview(parsed)` consumes a successful `ParsedCurlRequest`, validates its HTTP request through the Asset schema, maps warnings and sensitive fields, and returns a new preview object.

`previewCurlImport(input, requestedDialect = 'auto')` validates the dialect, calls `parseCurl`, delegates successful normalization, and converts all failures into safe result objects.

Neither function mutates input or touches database, filesystem, network, IPC, Preload, Electron, or global state. The Phase B1 256 KiB input limit remains authoritative.

## 7. Tests

Focused tests cover:

- GET preview;
- POST JSON preview;
- headers, auth, body, params, and default settings;
- Bearer, Basic, API-key, query, and JSON-body mappings;
- deterministic location and suggested-variable generation;
- method-inference warning normalization;
- unsupported flag and file-reference blocking issues;
- unknown dialect;
- unexpected normalization failure;
- proof that serialized previews, issues, and thrown values contain no credential fixture or file path;
- all existing Phase B1 parser tests as regression coverage.

Implementation follows RED -> GREEN -> refactor. Full repository lint, typecheck, tests, build, database/media/streaming/Electron smoke, and `git diff --check` run before integration.

## 8. Impact Boundary

CodeGraph currently shows `parseCurl` is called only by its test. Phase B2.1 adds the preview function as the only new production caller. The preview remains unreferenced by Renderer, Main, repositories, execution services, IPC, Preload, and SQLite until a separately designed import phase.
