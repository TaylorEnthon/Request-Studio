# Request Studio

Request Studio is a local-first Windows desktop workspace for HTTP, WebSocket, and SSE request development, execution, inspection, experiments, comparison, and portable request assets.

[![CI](https://github.com/TaylorEnthon/Request-Studio/actions/workflows/ci.yml/badge.svg)](https://github.com/TaylorEnthon/Request-Studio/actions/workflows/ci.yml)

## Status

Milestones 1–6 are complete. The English desktop UI supports:

- cURL import for a controlled common subset, with deterministic credential placeholders and empty Environment secret slots;
- Request export as HTTP cURL or versioned HTTP/WebSocket/SSE Request JSON;
- JavaScript Fetch, TypeScript Axios, Python requests, SSE Fetch, and Browser WebSocket code previews;
- one-way deterministic Workspace JSON export for Collections, Requests, Environments, and variable slots;
- Main-owned HTTP/WebSocket/SSE execution, persistent redacted history, managed media resources, Experiments, and Compare.

Request Studio does not currently support Workspace import, OpenAPI/Postman import, arbitrary cURL flags, Browser WebSocket custom handshake headers, code execution, dependency installation, project generation, or secret export.

## Development

```bash
npm ci
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
npm run smoke:database
npm run smoke:media
npm run smoke:streaming
npm run smoke:assets
npm run smoke:electron
```

Production data is stored in `request-studio.db` under Electron's standard `userData` directory. Tests and smoke commands use temporary local data and never touch that file or the public network.

## Security

The Renderer is sandboxed with context isolation and no Node integration. SQLite, parsing, request execution, export serialization, save dialogs, paths, and file writes remain in Main behind named validated IPC methods. Preview capabilities are sender-scoped; exported and generated output passes through shared sanitization and excludes real credentials, local paths, database IDs, runtime metadata, History, Experiments, Compare data, and Resources.

Environment secrets remain plain text in local SQLite. A future `safeStorage` migration is a separate security increment; it is not part of Milestone 6.
