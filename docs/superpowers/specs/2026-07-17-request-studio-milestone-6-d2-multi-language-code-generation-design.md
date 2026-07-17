# Request Studio Milestone 6 D2 Multi-language Code Generation Design

## Goal

Extend deterministic code generation with TypeScript Axios for HTTP, Fetch streaming for SSE, and browser WebSocket code while preserving the existing sanitizer and Main-process security boundary.

## Chosen Design

Keep one adapter registry in `src/shared/codegen/code-generation.ts`. Each adapter declares its language, display name, supported protocols, and generator. `generateCode()` sanitizes the `RequestAssetV1`, performs an exact capability check, creates the protocol-specific model, and invokes only the selected adapter.

Add a read-only `code-generation:list` IPC backed by `listCodeGenerators()`. The Renderer loads this metadata and filters languages by the selected saved request protocol. This removes the current duplicate UI language list without importing generator code into the Renderer.

Alternatives rejected:

- Sharing the generator module directly with Renderer risks bundling implementation code across the security boundary.
- Keeping hard-coded UI options duplicates registry state and can drift.
- A new template framework or generic factory adds no value for five fixed adapters.

## Adapter Models

- HTTP adapters reuse `HttpCodeGenerationModel`; TypeScript Axios emits `axios.request()` with method, URL, headers, optional basic auth, and body.
- SSE Fetch uses an SSE-specific model with method, URL, headers, optional body, and warnings. It emits `fetch()`, validates `response.ok` and `response.body`, obtains a reader, and includes a deterministic UTF-8 reader loop.
- Browser WebSocket uses a WebSocket-specific model with URL, subprotocols, and warnings. Query parameters remain in the URL. Custom headers and header-based authentication are omitted with a fixed warning because the browser API cannot express them.

No adapter accesses the database, environment, filesystem, network, Electron, or execution services.

## Capability and Error Handling

Language identifiers are:

- `javascript-fetch`
- `python-requests`
- `typescript-axios`
- `sse-fetch`
- `browser-websocket`

An adapter may generate only for a protocol listed in its capability. Missing adapters and unsupported protocol combinations keep fixed safe errors; no approximate output is generated. The UI lists only capabilities compatible with the selected request and resets stale previews when request, protocol, or language changes.

## Security

The existing `sanitizeRequestAssetForOutput()` remains the single sanitization boundary before model creation. Deterministic placeholders such as `{{TOKEN}}` remain intact. Raw credentials, resolved environment values, local paths, database IDs, and runtime metadata must not appear in generated content, warnings, errors, logs, or UI output.

Browser WebSocket warnings disclose only unsupported capability categories, never header values. File-backed HTTP content remains omitted by the existing warning path.

## IPC and UI Flow

1. Renderer calls `code-generation:list` through preload to obtain capability metadata.
2. Renderer filters capabilities by the selected request protocol.
3. Renderer sends `{ workspaceId, requestId, language }` to `code-generation:preview`.
4. Main validates input and request ownership, maps the saved row, sanitizes it, and invokes `generateCode()`.
5. Renderer displays returned code and fixed warnings, then copies only reviewed content with the browser Clipboard API.

## Tests

- Adapter tests cover Axios GET/JSON POST/headers, SSE GET/POST/body/reader loop, and WebSocket URL/subprotocol/unsupported-header warning.
- Contract and security tests cover exact capabilities, unsupported combinations, deterministic repeated output, placeholders, and absence of secrets, paths, IDs, and runtime metadata across all adapters.
- IPC tests cover the capability list and all accepted language identifiers.
- UI tests verify dynamic protocol filtering, new language options, previews, warnings, and stale-state clearing.
- The full project validation and smoke matrix remains unchanged.

## Non-Goals

No AI, template engine, generated-code execution, project generation, file output, dependency installation, database/schema change, request execution change, or cloud synchronization.
