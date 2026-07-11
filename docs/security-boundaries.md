# Security boundaries

- BrowserWindow: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Renderer receives no generic IPC, SQL, filesystem path, child process, or network primitive.
- Main uses parameterized SQL for values and enables SQLite foreign keys.
- Errors crossing IPC are stable display-safe objects without stack traces.
- Secret-bearing keys are recursively redacted. Local secret encryption is not yet implemented.
