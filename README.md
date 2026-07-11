# Request Studio

Request Studio is a local-first Windows desktop workspace for developer API experiments. Milestone 1 manages workspaces, flat collections, environments, secret-marked variables, and HTTP/WebSocket/SSE request drafts in SQLite through a secure Electron boundary.

## Status

The desktop foundation and local data model are implemented. Network execution, response viewing, uploads, media, history, experiments, comparison, curl import, code generation, and installer publication are not implemented.

## Development

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

Production data is stored in `request-studio.db` under Electron's standard `userData` directory. Tests use in-memory SQLite and never touch that file.

## Security

The renderer is sandboxed with context isolation and no Node integration. It can call only named preload methods. SQLite stays in the main process. Secret variables are masked in the UI and redacted from logs, but Milestone 1 stores them as plain text locally; `safeStorage` encryption is planned for a later security increment.
