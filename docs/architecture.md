# Architecture

Electron Main owns window lifecycle, SQLite, repositories, and explicit IPC handlers. Preload exposes named domain methods under `window.requestStudio`. React Renderer provides the fixed explorer/editor/response layout without Node.js access. Shared Zod schemas and TypeScript models define process contracts.

Future network execution belongs in new Main-process HTTP, WebSocket, and SSE slices and can emit typed execution events without changing Renderer privileges.

The last selected environment is stored as `selectedEnvironment:<workspaceId>` in `app_settings`. Main validates membership and returns the first remaining environment, or no selection, when a saved ID is stale.
