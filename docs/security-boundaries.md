# Security boundaries

- BrowserWindow: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- Renderer receives no generic IPC, SQL, filesystem path, child process, or network primitive.
- Main uses parameterized SQL for values and enables SQLite foreign keys.
- Errors crossing IPC are stable display-safe objects without stack traces.
- Secret-bearing keys are recursively redacted. Local secret encryption is not yet implemented.

Future secret-at-rest work will encrypt values in Main with Electron `safeStorage`, store an encryption version beside the payload, migrate existing plaintext transactionally, handle `safeStorage` unavailability explicitly, and document that encrypted backups are machine-bound.

HTTP does not weaken the boundary: Renderer has no target fetch or path-reading API. File selection returns opaque session references; Main rejects symlinks/non-files and files above 100 MiB. TLS verification is never disabled, response HTML is never executed, and credential-bearing fields are redacted from history.

Media uses a secure custom protocol with UUID lookup, realpath containment, bounded preview reads, and Range streaming. CSP permits the scheme only for images, media, and frames. HTML/SVG are escaped, PDF uses a sandboxed iframe, popups/navigation are denied, and saved files are never opened automatically. Environment secrets remain plaintext in local SQLite and redacted History still cannot be rerun.

WebSocket and SSE connections are owned by Main. Renderer receives named connection, send/stop, history, template, and resource operations only; it never receives a generic socket, fetch, path, or IPC primitive. Custom headers remain in Main, TLS verification stays enabled, payload/event/session limits are enforced, selected files use opaque references, and history snapshots/previews redact known credentials. Inbound binary frames are written beneath the per-workspace stream asset root and exposed only through the managed resource protocol.
