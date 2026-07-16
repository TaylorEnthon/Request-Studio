# Request Studio Milestone 6 Phase C1 — Request Export Foundation Design

## 1. Scope

Phase C1 adds a pure shared export path:

```text
Saved Request snapshot
  -> export sanitizer
  -> existing RequestAssetV1 mapper and schema
  -> HTTP cURL generator
  -> sanitized ExportPreview
```

It includes HTTP, WebSocket, and SSE export-asset mapping, secret sanitization, an HTTP-only cURL generator, preview metadata, and focused tests. It adds no UI, IPC, file writing, database migration, workspace export, code generation, OpenAPI, GraphQL, installer, or execution-engine change.

## 2. Existing Foundation

`src/shared/assets/request-asset.ts` already defines the strict `RequestAssetV1` contract. Protected values accept only fixed placeholders or `[REDACTED]`, local file references are rejected, and database/runtime metadata is outside the schema.

`src/shared/assets/request-asset-mapper.ts` already maps Saved Request rows for HTTP, WebSocket, and SSE into that contract. Phase C1 reuses this structural mapper instead of creating a second representation or changing its existing fail-closed behavior.

The new export boundary accepts a Saved Request snapshot as data. It does not read SQLite, resolve Environment variables, access files, or call the network.

## 3. Architecture

A pure `mapSavedRequestToExportAsset` function sanitizes the serialized Saved Request fields and delegates structural conversion and final validation to the existing `mapSavedRequestToAsset` function.

This keeps two responsibilities explicit:

- the existing mapper validates the canonical asset shape;
- the export mapper guarantees that exportable data contains no known credential literal or local file reference.

No service class, interface, factory, registry, or dependency is required. The minimum implementation is one export module for the sanitized asset and preview contract, one cURL module, and focused tests.

## 4. Sanitization Policy

Sanitization is deterministic and does not use secret-derived placeholder names.

- Existing `{{VARIABLE}}` placeholders and `[REDACTED]` remain unchanged.
- Bearer tokens, Basic passwords, and API-key auth values become `[REDACTED]`.
- Values under credential-shaped header, query, form, multipart, or JSON keys become `[REDACTED]`.
- JSON bodies are parsed and recursively sanitized. Invalid JSON fails with a fixed message that does not include source content.
- Credential-shaped assignments or authorization values in text bodies are redacted. Ordinary text is retained.
- Absolute filesystem paths detected in text are redacted.
- Multipart and binary file references become `null`; their paths are never included in output or warnings.
- Disabled entries follow the same sanitization policy because previews may still display them.

The sanitizer never resolves Environment placeholders, so known Environment secret values cannot enter this path. Opaque secrets embedded in otherwise unstructured ordinary text cannot be identified with certainty; the preview reports this limitation through a fixed warning without echoing input.

Errors and warnings are stable safe strings. They never interpolate a request URL, header value, body fragment, path, database ID, or caught exception message.

## 5. Export Preview Contract

The preview contains only presentation-safe export output:

```typescript
type ExportPreview = {
  format: 'curl'
  protocol: 'http'
  filenameSuggestion: string
  content: string
  warnings: ExportWarning[]
}
```

`ExportWarning` contains a stable code and safe message. The filename is derived only from the sanitized request name and has a deterministic `.sh` suffix. The preview contains no Saved Request ID, workspace or collection ID, timestamps, database fields, absolute paths, history, Experiment data, resolved secrets, or resource descriptors.

## 6. cURL Generator

The cURL generator is a pure function whose input is an HTTP `RequestAssetV1` variant. WebSocket and SSE requests can be mapped to safe export assets in C1 but are not represented as cURL commands.

The generator emits deterministic POSIX-compatible cURL and supports:

- method and URL;
- enabled query parameters in source order;
- enabled headers;
- bearer, basic, and API-key auth using sanitized placeholders or `[REDACTED]`;
- JSON and text bodies through `--data-raw`;
- form-urlencoded entries through `--data-urlencode`;
- multipart text entries through `--form`.

Every shell argument uses one POSIX single-quote escaping helper. The generator does not execute a shell or cURL. Binary bodies and multipart file parts are omitted with fixed warnings because their `fileRef` is intentionally absent. No new body or protocol behavior is added to make export appear more complete.

## 7. Tests

Focused mapper tests cover:

- HTTP, WebSocket, and SSE mapping;
- auth, headers, query, form, multipart, JSON, and recognizable text credentials;
- preservation of fixed placeholders;
- local path removal;
- exclusion of IDs, history, Experiments, and runtime metadata;
- fixed safe errors for malformed JSON.

Focused cURL tests cover:

- GET with query parameters;
- POST JSON;
- headers and POSIX quoting;
- bearer, basic, and API-key placeholders;
- form bodies;
- file omission warnings;
- absence of known credentials, paths, and IDs from content, warnings, and errors.

Existing RequestAsset and import tests remain regression coverage. Final verification runs lint, typecheck, unit tests, build, `test:all`, database smoke, media smoke, streaming smoke, Electron smoke, and `git diff --check`.

## 8. Acceptance Boundary

Phase C1 is complete when a Saved Request snapshot for HTTP, WebSocket, or SSE can be converted to a sanitized `RequestAssetV1`, and an HTTP asset can produce a deterministic safe cURL `ExportPreview`, without database, filesystem, network, Main/IPC, Renderer, schema, or execution changes.
