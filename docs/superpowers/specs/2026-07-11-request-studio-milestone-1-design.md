# Request Studio Milestone 1 Design

## Scope

Milestone 1 delivers a secure, local-first Windows desktop application that persists workspaces, flat collections, environments and variables, saved request drafts, and application selections. It does not execute HTTP, WebSocket, or SSE requests and does not create placeholder implementations for later milestones.

The interface is English-only for this milestone. Request drafts auto-save and visibly report `Saving…`, `Saved`, or `Save failed`. The application uses the approved fixed three-pane layout.

## Architecture

The application uses Electron, electron-vite, React, TypeScript, SQLite through `better-sqlite3`, Zod, Zustand, TanStack Query, Vitest, ESLint, and Prettier.

Code is organized as vertical feature slices without speculative interfaces or dependency injection:

- `src/main`: Electron lifecycle, database connection and migrations, feature repositories, and typed IPC handlers.
- `src/preload`: the explicit `window.requestStudio` API and nothing else.
- `src/renderer`: React layout and feature UI. It has no Node.js, filesystem, SQLite, or unrestricted IPC access.
- `src/shared`: models, Zod input schemas, IPC result/error contracts, and stable constants shared across processes.

Repositories receive a database connection so production uses the user-data database and tests use isolated in-memory databases. No ORM is added; parameterized SQL is smaller and keeps schema behavior explicit.

## Electron and IPC Boundary

The browser window uses `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. The preload exposes named methods grouped by domain, such as `workspaces.list`, `environments.updateVariable`, and `savedRequests.duplicate`. It does not expose a generic invoke method, channel name, SQL, filesystem path, or network primitive.

Each IPC handler validates input with its shared Zod schema before calling a repository. Handlers return a discriminated result containing either typed data or a stable `RequestStudioError`. Raw stack traces and full user inputs never cross into the renderer.

The main process owns IPC registration and database lifetime. App shutdown closes the database connection.

## Data Model

Schema version 1 contains six domain tables plus migration metadata:

- `schema_migrations(version, applied_at)`
- `workspaces(id, name, created_at, updated_at)`
- `collections(id, workspace_id, name, created_at, updated_at)`
- `environments(id, workspace_id, name, created_at, updated_at)`
- `environment_variables(id, environment_id, key, value, is_secret, description, created_at, updated_at)`
- `saved_requests(id, workspace_id, collection_id, name, protocol, method, url, description, created_at, updated_at)`
- `app_settings(key, value, updated_at)`

IDs are UUID strings generated in the main process. Timestamps are ISO 8601 UTC strings. Foreign keys are enabled. Deleting a workspace cascades to collections, environments, variables, and requests. Deleting an environment cascades to variables. Deleting a collection cascades to its requests after explicit user confirmation. Repository writes use parameterized statements and multi-step mutations use transactions.

The saved-request compromise is relational columns for the stable identity and routing fields required now. Future Params, Headers, Auth, Body, Files, and timeout storage is deferred until Milestone 2 can define real behavior; no catch-all JSON column or speculative tables are created.

`app_settings` stores `currentWorkspaceId` and `currentEnvironmentId`. Invalid or deleted selections fall back to the first available item or no selection.

## Feature Behavior

### Workspaces and Collections

Users can create, list, rename, select, and delete workspaces. Collections are flat and scoped to one workspace. All destructive actions require confirmation. Empty and failure states remain usable.

### Environments and Variables

Users can create, rename, select, and delete environments and add, edit, or delete variables. Variable keys are unique within an environment. Secret values are masked by default and can be temporarily revealed in the current UI session. Logging utilities redact secret-bearing fields and tests assert that known secret values never appear.

Milestone 1 distinguishes secrets in the model and UI but stores them in SQLite as plain text. Electron `safeStorage` encryption is explicitly deferred; the UI and documentation state this limitation.

### Saved Requests

Users create HTTP, WebSocket, or SSE drafts in a collection. HTTP defaults to `GET`; WebSocket and SSE do not show a method control. Name, protocol, method where applicable, URL, and description auto-save after a short debounce. Users can also delete or duplicate a request. Changing protocol normalizes method: HTTP receives `GET` when absent; WebSocket and SSE persist `null`.

No request is executed. The Send control is disabled and explains that HTTP execution arrives in Milestone 2.

## Renderer Design

The dark desktop UI has:

- a top bar with workspace selection, environment selection, save status, and settings;
- a left pane with collections and saved requests plus create, rename, duplicate, and delete actions;
- a center pane with protocol, HTTP method when relevant, URL, name, and description fields;
- a right pane with the message `Send a request to see the response here.`;
- environment and settings dialogs or panels that do not replace the primary workspace unnecessarily.

CSS variables provide the small token set for colors, spacing, typography, borders, and focus states. Pane minimum widths and overflow behavior keep the application usable at reduced window sizes. Forms have labels, keyboard focus indicators, loading states, inline validation, and actionable save errors.

TanStack Query owns server-state caching and invalidation for IPC-backed entities. Zustand holds only transient renderer state such as the selected editor item and open panels; persisted selections remain in SQLite.

## Error Handling and Logging

Errors use `RequestStudioError` with `code`, `category`, `message`, optional safe `detail`, and `retryable`. Validation, database, IPC, security, file, and unknown categories map to stable user-facing messages. Development logs may include operation name and stable IDs but never variable values, authorization material, cookies, or full request input.

## Migration and Persistence

At startup the main process opens a database under Electron's `userData` directory, enables foreign keys, and applies unapplied migrations in order inside transactions. Tests inject `:memory:` or a temporary path. Reopening the same test path verifies persistence without touching real user data.

## Testing and Verification

The smallest useful checks cover:

- Zod validation and protocol/method normalization;
- migration versioning and repeatable initialization;
- CRUD and cascade behavior for each repository;
- setting selection and persistence after reopen;
- IPC validation and stable error mapping;
- secret redaction;
- exact preload API surface with no generic invoke;
- key React behaviors: selection, confirmation, protocol-specific method visibility, disabled Send explanation, masked secrets, and auto-save status.

Required verification is `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. A database smoke check and Electron main-process startup smoke are added where they are stable in the environment. GUI behavior is checked through component tests and, when the desktop session permits, a manual launch screenshot.

## Delivery

Implementation and documentation are committed separately when the diff divides naturally. The configured `origin` is pushed without force, then available GitHub Actions are observed. The final report identifies any GUI or CI verification that the environment could not perform.

## Deferred Work

HTTP execution, request history, response parsing, file upload, multimedia preview, WebSocket, SSE, Base64 handling, experiments, comparison, curl import, code generation, installer publication, scripts, cloud features, and collaboration remain outside Milestone 1.
