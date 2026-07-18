# Architecture

Electron Main owns window lifecycle, SQLite, repositories, and explicit IPC handlers. Preload exposes named domain methods under `window.requestStudio`. React Renderer provides the fixed explorer/editor/response layout without Node.js access. Shared Zod schemas and TypeScript models define process contracts.

HTTP, WebSocket, and SSE execution live in Main-process protocol slices and emit typed results without changing Renderer privileges.

The last selected environment is stored as `selectedEnvironment:<workspaceId>` in `app_settings`. Main validates membership and returns the first remaining environment, or no selection, when a saved ID is stale.

Milestone 2 adds focused `http`, `history`, `files`, and IPC modules. Renderer sends a current typed draft; Main resolves the selected Environment, owns fetch/AbortController/timeout, incrementally reads responses, and records immutable history. Responses above 10 MiB use the managed response directory; 50 MiB is the hard maximum.

Milestone 3 stores binary/media responses as History-owned assets addressed by random resource IDs. `request-studio-resource://` resolves only registry entries below `history-assets`, streams with Range semantics, and never exposes paths. Inline JSON/text remains IPC data; large textual bodies expose only a bounded prefix.

Milestones 4 and 5 add Main-owned WebSocket/SSE sessions, persistent bounded timelines, managed streaming resources, Experiments, and Worker-backed Compare. Renderer panels receive contracts and opaque resource IDs rather than sockets, database handles, or paths.

Milestone 6 uses `RequestAssetV1` as the versioned portable request boundary. cURL import is parsed and saved through sender-scoped Main capabilities and a Repository transaction. Request export and code generation share the output sanitizer. Workspace export takes a Workspace-scoped Repository snapshot, maps stable internal collection references, serializes deterministically in chunks, and writes through the existing atomic export helper. Renderer previews are bounded and never choose or receive filesystem paths.
