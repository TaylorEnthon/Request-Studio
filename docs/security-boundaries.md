# Security boundaries

- BrowserWindow: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Renderer receives no generic IPC, SQL, filesystem path, child process, or network primitive.
- Main uses parameterized SQL for values and enables SQLite foreign keys.
- Errors crossing IPC are stable display-safe objects without stack traces.
- Secret-bearing keys are recursively redacted. Local secret encryption is not yet implemented.

Future secret-at-rest work will encrypt values in Main with Electron `safeStorage`, store an encryption version beside the payload, migrate existing plaintext transactionally, handle `safeStorage` unavailability explicitly, and document that encrypted backups are machine-bound.

HTTP does not weaken the boundary: Renderer has no target fetch or path-reading API. File selection returns opaque session references; Main rejects symlinks/non-files and files above 100 MiB. TLS verification is never disabled, response HTML is never executed, and credential-bearing fields are redacted from history.
