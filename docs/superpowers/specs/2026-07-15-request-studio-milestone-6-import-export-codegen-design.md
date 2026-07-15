# Request Studio Milestone 6 — API Import, Export & Code Generation Design

## 1. Background

Request Studio has completed local request editing and execution, response inspection, streaming, history, Experiments, and two-Run comparison. Milestone 6 turns those capabilities into a local API development workspace by adding three bounded asset operations:

1. Import one HTTP request from pasted cURL.
2. Export a request as cURL or a versioned JSON bundle, and export a workspace as versioned JSON.
3. Generate copyable or savable client code for the selected HTTP, WebSocket, or SSE request.

This is a design-only document. It does not authorize production code, database migrations, UI changes, IPC changes, tests, commits, or pushes.

### Goals

- Preserve Request Studio's current request semantics across import, export, and generation.
- Keep secrets and local filesystem paths out of previews, bundles, cURL, and generated code.
- Support deterministic, testable cURL parsing without executing a shell.
- Keep 10,000-request workspace export responsive and bounded.
- Produce stable versioned formats that can evolve without changing the database in Milestone 6.

### Non-goals

- AI code generation, cloud sync, team collaboration, OpenAPI platforms, GraphQL, gRPC, productized mock servers, Script systems, CI runners, API testing DSLs, or load testing.
- Importing JSON request bundles or workspace bundles in v1.
- Import/export/code-generation history.
- Exporting plaintext credentials.
- Reading local files referenced by a pasted cURL command.

## 2. Current Architecture Analysis

### Saved Request model

`saved_requests` already stores the required protocol-neutral envelope:

- identity and ownership: `id`, `workspace_id`, `collection_id`
- common request fields: `name`, `protocol`, `method`, `url`, `description`
- structured JSON: `params_json`, `headers_json`, `auth_json`, `body_json`, `settings_json`, `stream_config_json`

The Renderer maps those columns into HTTP, WebSocket, or SSE drafts. Main validates protocol-specific updates with Zod and serializes the structured fields back into the existing columns. Experiment snapshots already use the same logical shape: `version`, `protocol`, `name`, `method`, `url`, `params`, `headers`, `auth`, `body`, `settings`, and `streamConfig`.

The model is sufficient for cURL import, export, and code generation. Milestone 6 needs a versioned transfer DTO and conversion functions, not new database columns.

### Protocol architecture

- HTTP owns method, URL, query parameters, headers, auth, body, and timeout.
- WebSocket owns URL, query parameters, headers, auth, subprotocols, connection limits, ping, reconnect, and message limits. Saved message templates remain separate and are not part of request export v1.
- SSE owns GET/POST, URL, query parameters, headers, auth, body, connect/idle/session limits, and maximum event size.

The protocols should share a normalized asset envelope, secret policy, serialization helpers, and error contract. They should not share one permissive parser. cURL v1 parses HTTP only; each generator uses a protocol adapter that validates exactly the fields its target supports.

### Existing security

- Environment variables carry `is_secret` and are resolved only for execution.
- HTTP and streaming builders identify resolved secret values.
- streaming history uses `safeSnapshot` and redacts credential-shaped keys and known secret values.
- Experiment snapshots redact credential-shaped fields while retaining `{{VARIABLE}}` placeholders.
- `ResponseResourceRegistry` verifies managed roots and removes filesystem paths from public descriptors.
- file selection and Save As already cross the preload/Main boundary instead of exposing arbitrary filesystem access to Renderer.

Milestone 6 should extract one reusable request-asset sanitizer from these existing rules rather than create another independent redaction implementation.

### Existing IPC and UI

Preload exposes an explicit `contextBridge` whitelist. Main owns SQLite, network operations, managed resources, file dialogs, and writes. Renderer currently owns editing state and invokes validated request CRUD handlers. The header already contains workspace-level actions; the request editor is the correct request-level action surface.

## 3. CodeGraph Analysis

CodeGraph was initialized and up to date at design time. The principal paths were:

```text
App.asDraft / App.asStreamDraft
  -> preload.savedRequests
  -> requests:create / requests:update
  -> Zod HTTP or streaming update schema
  -> Repository
  -> saved_requests JSON columns
```

```text
Saved Request draft
  -> HTTP / WebSocket / SSE request builder
  -> resolveTemplate
  -> secretValues
  -> history safe snapshot / Experiment sanitizer
```

```text
Renderer resource view
  -> preload.responseResources
  -> Main resource handlers
  -> ResponseResourceRegistry.safe
  -> public descriptor without path
```

The likely implementation blast radius is limited to new shared asset contracts/parsers/generators, a Main asset service and IPC handler, preload declarations, an English Tools dialog, focused tests, and registration in `src/main/index.ts`. Execution services, response viewers, history, Experiments, Compare, and Schema v5 should remain unchanged except for extracting shared sanitization from the existing Experiment implementation.

## 4. Product Goals and Recommended Architecture

### Considered approaches

1. **One universal parser and generator:** compact API surface, but it produces a permissive type full of invalid field combinations and weak protocol errors. Rejected.
2. **Independent models for every feature and protocol:** locally simple but duplicates redaction, escaping, and field conversion. Rejected.
3. **Versioned normalized asset plus protocol adapters:** one stable transfer format and security policy, with strict protocol-specific parsing and generation. Recommended.

### Core flow

```text
External text / Saved Request rows
  -> strict source parser or row mapper
  -> RequestAssetV1
  -> shared sanitizer and policy
  -> protocol adapter
  -> Saved Request transaction / export serializer / code generator
```

`RequestAssetV1` is a discriminated union with a common envelope and strict protocol payloads:

```typescript
type RequestAssetV1 = {
  format: 'request-studio.request'
  version: 1
  name: string
  description: string
  protocol: 'http' | 'websocket' | 'sse'
  request: HttpAsset | WebSocketAsset | SseAsset
  context?: {
    collection?: { name: string }
    environment?: EnvironmentStructure
  }
}
```

IDs, timestamps, database column names, absolute paths, history, results, resources, and Experiment data never enter this public model.

## 5. cURL Import Design

### Scope

cURL import v1 creates one HTTP Saved Request and supports:

- command: `curl` or `curl.exe`
- URL: positional URL or `--url`
- method: `-X`, `--request`, or inferred POST when body data is present
- headers: `-H`, `--header`, preserving repeated headers
- body: `-d`, `--data`, `--data-raw`; repeated data fragments join with `&`, matching ordinary cURL form behavior
- basic auth: `-u`, `--user`
- multiline POSIX backslash, PowerShell backtick, and CMD caret continuation
- POSIX single/double quotes, PowerShell single/double quotes, and CMD double quotes

Unsupported flags are reported explicitly. Flags that can read local files or credentials are rejected: `@file` data, `--data-binary @...`, `-F/--form`, `--upload-file`, `--cert`, `--key`, `--config`, and `file://` URLs. Pipes, redirects, command substitution, backticks used as command substitution, `&&`, `||`, and shell variable expansion are never executed or expanded.

### Parser choice

Use a small in-repository lexer and parser. No current dependency covers the required constrained POSIX, PowerShell, and CMD behavior. A generic shell parser would add bundle and license review cost, accept features this product must reject, and still not map cURL semantics. No npm dependency or template engine is recommended for v1.

The lexer operates in explicit dialects: `posix`, `powershell`, and `cmd`. Auto-detection selects a dialect from continuation and quoting evidence; ambiguous input defaults to POSIX and the UI lets the user switch dialect before preview. The parser consumes tokens without spawning `curl`, a shell, PowerShell, or CMD.

### Mapping

- Query pairs already present in the URL are normalized into `params` in occurrence order.
- `Content-Type: application/json` plus a valid JSON body maps to JSON body; invalid JSON remains text with its content type.
- `application/x-www-form-urlencoded` maps to enabled form entries when parsing is lossless; otherwise it remains text.
- `Authorization: Bearer ...` maps to bearer auth.
- `-u username:password` maps to basic auth.
- recognized API-key header/query names map to API-key auth only when the mapping is unambiguous; otherwise they remain ordinary entries but are still classified as secret candidates.
- Header order and duplicate occurrences are preserved in the asset even though execution may later coalesce them according to existing behavior.

### Secret preview and commit

`api-assets:preview-curl` executes in Main with a 256 KiB UTF-8 input limit. Main parses and classifies secret candidates, creates an in-memory preview session with a random ID and ten-minute expiry, and returns only a tokenized asset plus masked candidate metadata. The pasted command is not logged or persisted.

Suggested variables use deterministic names such as `TOKEN`, `API_KEY`, `BASIC_USERNAME`, and `BASIC_PASSWORD`, with numeric suffixes for collisions. Credential values are replaced with `{{VARIABLE}}`; secret candidates default to `isSecret: true`.

`api-assets:commit-curl` consumes the preview session exactly once. It creates the request and confirmed environment variables in one SQLite transaction. It never overwrites an existing environment variable silently. A collision must bind to the existing variable or use a new name. Expired sessions require a new preview.

### Errors

Errors include a stable code, dialect, token index or source range, user-facing message, and optional unsupported flag. Partial parse results cannot be committed. The preview distinguishes warnings, such as method inference, from blocking errors, such as an unterminated quote or local-file reference.

## 6. Export Design

### Export policy

Milestone 6 v1 offers only:

- **Replace with variables** — default; replaces credential literals and known environment values with `{{VARIABLE}}` and exports variable structure.
- **Mask** — writes `[REDACTED]`; useful for support/debug sharing but intentionally not directly executable.

`Include secrets` is not offered in v1. This removes a dangerous confirmation path and guarantees that every export operation can use the same leak scan.

### cURL export

cURL export supports HTTP requests only. It emits a deterministic POSIX-compatible multiline command:

- explicit `--request` only when needed for clarity
- one `--header` per enabled header
- auth rendered from sanitized placeholders
- `--data-raw` for JSON, text, or form bodies
- shell-safe single-quote escaping

The preview and copied text use the same generator. Unsupported body types fail rather than silently omit content. Local file references are never emitted.

### Request JSON bundle

The `.request-studio-request.json` bundle contains:

```json
{
  "format": "request-studio.request",
  "version": 1,
  "exportedAt": "ISO-8601",
  "request": {},
  "context": {
    "collection": { "name": "Collection" },
    "environment": { "name": "Environment", "variables": [] }
  }
}
```

Environment entries contain `key`, `isSecret`, and `description`. Secret values are omitted; non-secret values are included only under Replace with variables when needed to make the bundle understandable. Requests contain placeholders, never resolved secret values.

### Workspace JSON export

`workspace.json` contains format/version metadata, workspace display metadata, collections, requests as `RequestAssetV1`, and environment structures. It excludes database IDs, settings unrelated to the workspace, selected-environment state, history, sessions, message records/templates, Experiments, comparison results, managed assets, userData, logs, and all local paths.

Main loads rows in stable `(created_at, id)` pages and streams JSON to a temporary file in the user-selected directory. On success it atomically renames the temporary file; cancellation or failure removes it. A final recursive leak scan rejects credential-shaped literal values or path fields before rename.

## 7. Code Generation Design

### Pipeline

```text
Saved Request rows
  -> RequestAssetV1 mapper
  -> sanitizer (Replace with variables or Mask)
  -> protocol/target adapter
  -> escaping helpers
  -> generated text + warnings + required dependencies
```

Targets in v1:

- JavaScript: Fetch API for HTTP.
- TypeScript: Axios for HTTP, with `axios` listed as a generated-project dependency rather than an application dependency.
- Python: `requests`, with the dependency stated in the preview.
- WebSocket: browser-standard `WebSocket`; custom headers and Basic/API-key header auth are reported as unsupported because browsers cannot set arbitrary handshake headers.
- SSE: `fetch` plus `ReadableStream`, covering the current GET/POST, headers, auth, body, and incremental event stream shape.

Generators use direct string builders and small target-specific escaping helpers. A template engine is unnecessary for five bounded adapters and would make escaping/security behavior less explicit. Each adapter declares supported protocol, runtime assumptions, dependency note, and unsupported-field diagnostics.

Generated code never resolves environment values. It creates variable reads appropriate to the target, for example `process.env.TOKEN`, `os.environ['TOKEN']`, or an explicit placeholder constant when the target runtime has no environment convention. The preview includes warnings when semantics cannot be represented exactly.

Generation is deterministic: identical sanitized asset, target, and options produce identical text. Copy occurs in Renderer; Save uses a Main-owned save dialog and atomic write. Generated code is not persisted in SQLite.

## 8. Data Model Analysis

Schema v5 is sufficient. Milestone 6 should not add Schema v6 because:

- imported requests and environment variables already have durable tables;
- export files are derived artifacts;
- generated code is derived text;
- history would retain sensitive input/output and create cleanup/UI requirements with no v1 product value.

The implementation should add Zod contracts for `RequestAssetV1`, request/workspace bundles, export policies, target IDs, preview sessions, and IPC inputs/results. These are transfer-format versions, independent of SQLite `user_version`.

An import commit uses existing rows and generates fresh IDs. It must verify workspace/collection/environment ownership in Main and use one transaction. Export always reads an authoritative snapshot from Main by ID instead of accepting a complete request object from Renderer.

## 9. Security Design

### Trust boundaries

- Pasted cURL, bundle metadata, names, URLs, headers, bodies, and generator options are untrusted.
- Renderer cannot choose database tables, local paths, or export destinations.
- Main validates every IPC input with strict Zod schemas and checks workspace ownership.
- Import never executes external commands or performs network requests.

### Shared sanitizer

Extract a Main-only request-asset sanitizer from the current Experiment and streaming rules. It must:

- recognize authorization, cookie, token, password, secret, and API-key fields case-insensitively;
- replace known environment values before generic key-based masking;
- preserve valid `{{VARIABLE}}` placeholders;
- inspect URL userinfo and credential-shaped query keys;
- recurse through JSON bodies without treating arbitrary prose as a credential;
- remove all keys named `path`, `filePath`, `resourcePath`, and database-only fields;
- return structured findings so UI can explain each replacement.

Every export and generator performs a final invariant check: no known secret value, credential literal, `file://` URL, absolute Windows/POSIX path field, managed resource path, or userData prefix may remain. Failure blocks Copy and Save.

### Import session handling

Raw pasted credentials live only in the Main preview-session map, expire after ten minutes, are consumed on commit, and are cleared on app shutdown. They never enter logs, error details, telemetry, history, clipboard output, or preview responses. Renderer should clear the raw paste field after a successful preview and show only the tokenized command/request.

## 10. UI Design

The English interface adds one **Tools** button to the existing header instead of multiple permanent buttons.

### Tools menu

- **Import cURL…** — workspace-level.
- **Export Workspace…** — workspace-level.
- **Export Request…** — enabled when a request is selected.
- **Generate Code…** — enabled when a request is selected.

### Import flow

```text
Paste cURL
  -> choose/confirm dialect
  -> Preview detected request
  -> Review secret-to-variable mappings and destination collection/environment
  -> Save
```

Preview shows method, URL, ordered query/header rows, auth type, body type, warnings, unsupported flags, and masked secret findings. Save remains disabled while blocking errors or variable collisions are unresolved. Success selects the created request in the existing editor.

### Export flow

The dialog selects cURL, Request JSON, or Workspace JSON and Replace with variables or Mask. cURL and Request JSON show a text preview with Copy and Save. Workspace export shows counts, estimated size, policy, progress, Cancel, and final destination filename; it does not render the entire workspace JSON in Renderer.

### Code generation flow

The dialog selects a compatible target, shows dependency/runtime notes and semantic warnings, then displays generated code with Copy and Save. Incompatible targets are hidden or disabled with a reason. The dialog uses native controls, labeled error regions, keyboard focus return, and an `aria-live` status message.

## 11. Performance Design

- Limit pasted cURL to 256 KiB and return a validation error before lexing larger input.
- Parse one cURL and generate one request synchronously in Main; these bounded operations do not justify a Worker.
- Export requests, collections, and environments in pages of 500 rows with stable keyset ordering.
- Stream workspace JSON through Node streams to a temporary file; never materialize the full export in Renderer or one giant IPC payload.
- Emit throttled progress at most ten times per second and support cancellation between pages.
- Load the request export/codegen source by ID only when a dialog opens.
- Use compact bundle JSON by default; an optional pretty format is acceptable for single-request bundles but not required for workspace v1.

A Worker should be added only if measurement shows the 256 KiB parser or single-request generator causes visible Renderer/Main latency. The large operation is filesystem export, already isolated to Main streaming.

## 12. Testing Strategy

### cURL parser

- GET and explicit/inferred POST.
- `-X/--request`, `-H/--header`, `-d/--data/--data-raw`, `--url`, and `-u/--user`.
- repeated headers, query keys, and data fragments.
- JSON, text, and form body classification.
- POSIX, PowerShell, and CMD quotes, escapes, and multiline continuations.
- unterminated quotes, unknown flags, shell operators, file references, and input-size limit.
- golden fixtures that prove parsing never invokes a process or reads a file.

### Export

- deterministic cURL quoting and round-trip through the supported parser subset.
- Request JSON schema/version and stable ordering.
- 10,000-request workspace streaming, cancellation, temporary-file cleanup, and atomic completion.
- exclusion of history, resources, Experiments, IDs, timestamps not in the public format, and paths.

### Generators

- golden output for JavaScript Fetch, TypeScript Axios, Python requests, browser WebSocket, and SSE Fetch/ReadableStream.
- correct escaping for quotes, Unicode, newlines, JSON, query parameters, headers, and bodies.
- dependency/runtime notes and unsupported-field diagnostics.
- deterministic output snapshots.

### Security

- bearer, Basic, API key, cookie, password, URL userinfo, sensitive query, nested JSON secret, and known environment value replacement.
- placeholders preserved without resolving values.
- no secret echo in preview/error results.
- no absolute Windows/POSIX path, userData path, resource path, or file URL in exports/code.
- workspace ownership checks and expired/consumed import sessions.

### Integration and smoke

- Main IPC contract tests with invalid and cross-workspace IDs.
- import transaction rollback on variable/request collision.
- preload whitelist contract and Renderer dialog accessibility tests.
- database smoke proving an imported request executes through existing services without migration.
- export-to-temporary-directory smoke and Electron save-dialog boundary smoke using stubs.

## 13. Implementation Phases

### Phase 6A — Asset contract and security core

Add versioned asset schemas, Saved Request row mappers, protocol adapters, sanitizer findings, and secret/path invariant tests. Extract existing Experiment sanitization to the shared Main security seam without changing stored behavior.

### Phase 6B — cURL import

Add dialect lexers, supported-option parser, secret preview sessions, transactional commit service, IPC/preload contracts, and the Import cURL dialog. Finish with parser/security/integration tests.

### Phase 6C — Request export and code generation

Add deterministic cURL/JSON exporters, five target generators, Copy/Save flows, compatibility warnings, and golden tests. No database changes.

### Phase 6D — Workspace export

Add paged authoritative reads, streaming/atomic JSON writer, progress/cancellation, workspace export UI, 10,000-request performance fixture, and path/secret leak scan.

Each phase should be independently reviewable and keep `npm run test:all` plus database, media, streaming, and Electron smoke green. Implementation should use TDD and separate commits by these four deliverables, not by scaffolding layer.

## 14. Risk Analysis

| Risk | Impact | Mitigation |
|---|---|---|
| Shell dialect ambiguity | Incorrect URL/header/body | Explicit detected dialect, switchable preview, source-range errors, no shell execution |
| Unsupported cURL semantics | Silent behavior loss | Reject unsupported flags; never ignore a value-taking flag |
| Credential leakage | High-severity data exposure | Main-only sanitizer, tokenized preview, no Include secrets, final invariant scan |
| Existing literal secrets in Saved Requests | Export/code leak | Sanitize authoritative rows and block output when a credential cannot be tokenized safely |
| Generated client cannot represent request | Misleading code | Adapter capability matrix and blocking/warning diagnostics |
| Large workspace blocks UI | Poor usability or memory pressure | Keyset pages, Node stream, progress, cancellation, no full Renderer payload |
| Partial/corrupt export | Invalid artifact | Temporary file, flush/close, atomic rename, cleanup on cancellation/error |
| Format evolution | Future incompatibility | Strict `format` and integer `version`, reject unknown major versions |
| Sanitizer drift across history/Experiment/export | Inconsistent security | Extract and reuse one Main security module with regression tests |

## 15. Differences From the Prompt

- No third-party cURL parser is selected, so npm version, license, bundle impact, and Electron compatibility are not applicable. This is deliberate because the required safe subset is smaller than a shell parser and current dependencies do not provide it.
- TypeScript generation uses Axios as requested, but Axios is only a dependency of the generated sample project; Request Studio itself does not add Axios.
- v1 does not offer **Include secrets**. It offers only Replace with variables and Mask.
- No Schema v6 or history tables are proposed. Import history, export history, and generated-code history are omitted by design.
- No Worker is proposed for bounded single-request parsing/generation. Workspace export uses Main-process paging and streaming, which addresses the actual large-data path.
- JSON and workspace bundles are export-only in Milestone 6 v1; importing those formats is deferred until their versioning and conflict semantics have real usage evidence.
- WebSocket code generation targets the browser API and explicitly rejects handshake features the browser cannot represent rather than generating misleading code.
