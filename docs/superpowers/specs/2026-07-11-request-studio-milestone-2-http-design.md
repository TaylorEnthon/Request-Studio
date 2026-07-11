# Request Studio Milestone 2 HTTP Design

## Scope and architecture

Milestone 2 adds a complete HTTP request loop without changing Electron's security boundary. Renderer edits a typed request draft; Preload exposes named save/execute/cancel/history/file methods; Main validates again, resolves environment values, builds and executes the request with built-in `fetch`, persists immutable history, and returns a safe response model.

HTTP, history, and file code live in focused feature modules. Existing generic repositories remain for Milestone 1 CRUD but do not absorb network behavior.

## Request configuration

Saved requests gain five independently validated JSON columns: `params_json`, `headers_json`, `auth_json`, `body_json`, and `settings_json`. This matches the aggregate nature of request configuration while avoiding one untyped catch-all blob or many entry tables. Each column has a Zod schema and defaults; schema evolution remains explicit through SQLite migrations.

Supported methods are GET, POST, PUT, PATCH, DELETE, HEAD, and OPTIONS. Key/value entries preserve order, enabled state, duplicate keys, and descriptions. Auth supports none, bearer, UTF-8 Basic, and API key in header or query. Body supports none, JSON, text, URL-encoded form, multipart text/file entries, and one binary file reference. Timeout defaults to 30 seconds, with a 100 ms minimum and 300 second maximum.

## Migration and history

Schema version 2 adds the five saved-request columns and `request_history`. Existing rows receive valid defaults and remain intact. History belongs to a workspace, references saved requests with `ON DELETE SET NULL`, and cascades with workspace deletion. It records immutable redacted request snapshots, response metadata, inline body text or a managed response file reference, cancellation/error state, and timing. An index supports workspace/time listing.

History retains at most 500 records per workspace. Pruning deletes only files created inside Request Studio's managed response directory.

## Variable resolution and request building

Main loads the selected environment for the workspace. Placeholder names match `[A-Za-z_][A-Za-z0-9_]*`. Resolution is one pass: values containing placeholders are not recursively expanded. Missing variables and unmatched `{{` stop execution. Secrets exist only in the resolved in-memory request.

Build order is URL template, enabled params, API-key query, body, auth headers, then explicit headers. Existing URL query values are retained; duplicates are appended. Header names are case-insensitive. Explicit user headers override automatic body/auth headers, except multipart `Content-Type` is owned by `FormData` so its boundary cannot be corrupted. GET and HEAD reject non-none bodies.

JSON templates are resolved and parsed again before sending. Text and form values resolve normally. Basic credentials use UTF-8 before Base64 encoding.

## Controlled files

Renderer can only open Electron's file picker and receive an opaque file reference plus safe metadata. Main keeps the reference/path registry and revalidates existence, regular-file status, symlinks, and a 100 MiB request-file maximum before execution. Paths never appear in Renderer logs or history summaries. References are session-scoped; after restart a saved file body requires reselection, a deliberate safer limitation for this milestone.

## Execution lifecycle

`HttpExecutionService` owns a maximum of 20 active executions and permits one active execution per saved request. It creates execution IDs, AbortControllers, timeout timers, and typed events. Cancel and timeout have distinct error codes. Registry entries and timers are removed in `finally`; application shutdown cancels everything.

Renderer executes its current validated draft, not a potentially stale database copy. It attempts save first; a save failure blocks execution. Main validates workspace/request ownership and the complete draft.

## Response handling

Main reads the response stream incrementally. Up to 10 MiB remains in memory. Larger responses stream to a randomly named file under the managed user-data response directory. A hard 50 MiB maximum aborts reading and removes partial files. JSON, text, HTML, XML, empty, and binary/unknown kinds are identified from status, content type, and bytes. HTML/XML remain escaped text; they are never executed.

HTTP 4xx and 5xx are successful executions and enter the viewer/history. Network, timeout, cancellation, decode, and size failures use stable error categories without raw secrets or stacks.

## Renderer

The request editor is split into Params, Auth, Headers, Body, and Settings components. Send/Cancel states are keyed by request ID. Response tabs provide Overview, Headers, Pretty, and Raw. History lists immutable executions, shows details, reruns the stored redacted/template draft after current environment resolution, creates a new saved request, deletes one record, or clears after confirmation.

## Testing and boundaries

Pure tests cover schemas, variable resolution, request building, and redaction. SQLite tests cover v1→v2 migration, history relationships, retention, and restart. A Node `http` server on `127.0.0.1` with a random port covers execution, statuses, body kinds, timeout, cancel, concurrency, and limits without public network access. Component tests cover editors, execution states, response tabs, and history actions. Existing Electron/database smoke remain and HTTP smoke uses only the local server.

WebSocket, SSE, streaming UI, media preview, Base64 extraction, comparison, scripts, import/code generation, installer, and `safeStorage` migration remain out of scope.
