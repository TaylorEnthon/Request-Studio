# Request Studio Milestone 6 D1 Code Generation UI Design

## Goal

Expose the existing deterministic JavaScript Fetch and Python requests generators through the desktop UI without giving the Renderer direct generator, database, filesystem, environment, or Node access.

## Chosen Design

Add one `code-generation:preview` IPC channel and one `CodeGenerationPanel` opened from the existing Tools menu. The panel selects a saved request and language, asks Main for a preview, displays its warnings and code, and copies the reviewed code with the browser Clipboard API already used by the Renderer.

Alternatives rejected:

- Extending Request Export would mix file export and clipboard-only code generation lifecycles.
- Adding a template registry or clipboard IPC would duplicate capabilities that already exist.
- Calling `generateCode()` from Renderer would violate the Main security boundary.

## Data Flow

1. Renderer sends `{ workspaceId, requestId, language }` through the preload whitelist.
2. Main validates the strict input schema.
3. Repository lookup enforces request ownership with both request and workspace IDs.
4. Main maps the saved row to `RequestAssetV1` and calls `generateCode()`.
5. The generator sanitizes the asset before an adapter receives it.
6. Renderer receives only `{ language, content, warnings }` and displays it.
7. Copy writes only the displayed `content` to `navigator.clipboard`.

## UI

The Tools menu gains `Generate Code...`. The modal follows `RequestExportPanel`: saved-request selector, language selector, Generate button, warning list, code `<pre>`, Copy button, Escape/Close handling, busy state, fixed safe errors, and a copied status message.

Only the C3 languages are listed:

- JavaScript Fetch
- Python requests

## Security and Errors

- Main owns repository access and generator invocation.
- Renderer receives no database identifiers beyond its existing request selection input; generated output contains no request/workspace ID metadata.
- Existing deterministic placeholders such as `{{TOKEN}}` remain visible.
- Raw credentials, resolved environment values, and local paths are redacted by the existing output sanitizer.
- Invalid language/input returns `INVALID_INPUT`; missing or cross-workspace requests return `REQUEST_NOT_FOUND`; unsupported protocol or generation failures return `GENERATION_FAILED` with a fixed message.
- Clipboard failure produces a fixed Renderer message and does not regenerate or log content.

## Tests

- IPC: valid languages, invalid language, missing request, workspace mismatch, unsupported protocol, and secret/path/runtime-metadata absence.
- UI: language selection, preview, warnings, copy success/failure.
- App: Tools entry opens and closes the panel.
- Existing generator tests remain the source of truth for deterministic formatting and sanitizer behavior.

## Non-Goals

No AI, code execution, file save, workspace/project generation, template engine, new dependency, database schema change, request execution change, Axios adapter, or environment-secret resolution.
