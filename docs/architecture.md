# Architecture

Electron Main owns window lifecycle, SQLite, repositories, and explicit IPC handlers. Preload exposes named domain methods under `window.requestStudio`. React Renderer provides the fixed explorer/editor/response layout without Node.js access. Shared Zod schemas and TypeScript models define process contracts.

Future network execution belongs in new Main-process HTTP, WebSocket, and SSE slices and can emit typed execution events without changing Renderer privileges.
