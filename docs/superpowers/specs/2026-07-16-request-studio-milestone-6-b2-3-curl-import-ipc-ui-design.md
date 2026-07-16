# Request Studio Milestone 6 Phase B2.3 — cURL Import IPC & UI Flow Design

## 1. Scope

Phase B2.3 exposes the existing safe cURL preview and import-save foundations through a Main-owned IPC boundary and an English Renderer workflow:

```text
Tools -> Import cURL... -> Parse Preview -> Review -> Map -> Import
```

It adds no parser behavior, database migration, export, code generation, workspace import, OpenAPI, GraphQL, or HTTP/WebSocket/SSE execution changes.

## 2. Architecture

The Renderer never imports the parser, mapper, repository, filesystem, network, or database code. Preload exposes only two whitelisted calls:

- `curlImport.preview(input)`
- `curlImport.save(input)`

A dedicated Main handler validates both calls with Zod. Preview delegates to `previewCurlImport`. Save delegates to `mapCurlImportSave` and the existing transactional `Repository.importCurl` method.

The handler retains only the latest sanitized `CurlImportPreview` with a random one-time `previewId`. The Renderer receives that identifier and the sanitized preview, then sends only the identifier, destination IDs, request name, and placeholder mappings when saving. A successful import consumes the identifier. This avoids trusting a Renderer-supplied preview without introducing a cache service or persistence layer.

## 3. Renderer Flow

The existing application header gains a native `Tools` menu with `Import cURL...`. The action is disabled without a selected workspace.

A focused `CurlImportPanel` modal owns the workflow:

1. Paste cURL and select Auto, POSIX, PowerShell, or Command Prompt dialect.
2. Select `Parse Preview`.
3. Review dialect, method, URL, sanitized headers, sanitized body, and warnings.
4. Rename each sensitive placeholder to a valid environment variable name.
5. Choose the target Collection and, when mappings exist, Environment.
6. Select `Import` to create the Saved Request.

The cURL textarea is uncontrolled. Its value is read only for the IPC call and cleared immediately after a successful preview, so raw credentials are not copied into React state. Preview state contains only the parser's sanitized contract. On success, the App reloads the current workspace and selects the imported request.

The component uses existing modal, form, button, and error styles with a small CSS extension. No UI dependency or global state store is added.

## 4. Validation and Security

Main validates source size, dialect, `previewId`, workspace, collection, optional environment, request name, and mappings. Variable names must match `[A-Za-z_][A-Za-z0-9_]*` and remain within the existing 100-character limit.

The parser's deterministic placeholders remain unchanged and contain no secret-derived information. Sensitive rows show only type, location, placeholder, and editable variable name. Headers, body, warnings, errors, logs, and test output must not reveal raw credentials.

Errors cross IPC as fixed safe result objects. Parser issues may return their existing sanitized message; validation, expired-preview, ownership, and persistence failures use fixed messages without echoing input or underlying exception details.

Execution and persistence remain Main-only. Context isolation, sandboxing, the Preload whitelist, RequestAsset revalidation, workspace ownership checks, empty secret-variable creation, and repository transaction semantics remain the security boundaries.

## 5. Minimal File Boundary

- Add one Main IPC handler module and its focused test.
- Add one Renderer modal component and its focused test.
- Extend Preload with the two whitelisted methods.
- Register the handler from Main and mount the modal from `App.tsx`.
- Extend existing Renderer styles only as needed.

No service class, interface, route, Zustand store, cache abstraction, migration, or dependency is required.

## 6. Tests

IPC tests cover valid preview, invalid input, expired or mismatched preview IDs, successful save, collection/workspace isolation, environment/workspace isolation, and fixed safe errors.

Renderer tests cover opening from Tools, preview rendering, warning rendering, sensitive-variable editing and validation, destination selection, successful import, and friendly failure states.

Security assertions use known credential fixtures and verify they do not appear in returned previews, rendered UI, error objects, or captured logs. Existing parser, preview, mapper, repository, and application tests remain regression coverage.

The final validation matrix is lint, typecheck, unit tests, build, `test:all`, database smoke, media smoke, streaming smoke, Electron smoke, and `git diff --check`.

## 7. Acceptance Boundary

The phase is complete when a user can import one cURL command into an existing Collection through the English UI, map sanitized sensitive placeholders to empty secret Environment variables, and open the resulting Saved Request without any raw credential leaving the transient paste field.
