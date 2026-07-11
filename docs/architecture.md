# Architecture

Electron Main owns window lifecycle, SQLite, repositories, and explicit IPC handlers. Preload exposes named domain methods under `window.requestStudio`. React Renderer provides the fixed explorer/editor/response layout without Node.js access. Shared Zod schemas and TypeScript models define process contracts.

Future network execution belongs in new Main-process HTTP, WebSocket, and SSE slices and can emit typed execution events without changing Renderer privileges.

The last selected environment is stored as `selectedEnvironment:<workspaceId>` in `app_settings`. Main validates membership and returns the first remaining environment, or no selection, when a saved ID is stale.

Milestone 2 adds focused `http`, `history`, `files`, and IPC modules. Renderer sends a current typed draft; Main resolves the selected Environment, owns fetch/AbortController/timeout, incrementally reads responses, and records immutable history. Responses above 10 MiB use the managed response directory; 50 MiB is the hard maximum.

Milestone 3 stores binary/media responses as History-owned assets addressed by random resource IDs. `request-studio-resource://` resolves only registry entries below `history-assets`, streams with Range semantics, and never exposes paths. Inline JSON/text remains IPC data; large textual bodies expose only a bounded prefix.
