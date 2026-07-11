# Request Studio

Request Studio is a local-first Windows desktop workspace for developer API experiments. Milestone 1 manages workspaces, flat collections, environments, secret-marked variables, and HTTP/WebSocket/SSE request drafts in SQLite through a secure Electron boundary.

[![CI](https://github.com/TaylorEnthon/Request-Studio/actions/workflows/ci.yml/badge.svg)](https://github.com/TaylorEnthon/Request-Studio/actions/workflows/ci.yml)

## Status

Milestone 2 adds Main-process HTTP execution, Params, Headers, Auth, six body modes, environment resolution, timeout/cancel, response inspection, controlled file selection, and persistent redacted history. WebSocket, SSE, media preview, experiments, comparison, curl import, code generation, and installer publication are not implemented.

## Development

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
npm run test:http
npm run smoke:database
npm run smoke:electron
```

Production data is stored in `request-studio.db` under Electron's standard `userData` directory. Tests use in-memory SQLite and never touch that file.

## Security

The renderer is sandboxed with context isolation and no Node integration. Real HTTP requests, files, SQLite, cancellation, and history remain in Main behind named Zod-validated IPC methods. HTML/XML responses are text only. Secret variables are redacted from history/logs but remain plain text in the local Environment table; `safeStorage` remains a later security increment.

Milestone 3 adds smart MIME/signature classification, managed image/audio/video/PDF previews, bounded Binary Hex inspection, manual JSON Base64 extraction, Range streaming, and safe Save As. Playback depends on Chromium codec support; response HTML and SVG are never executed.
