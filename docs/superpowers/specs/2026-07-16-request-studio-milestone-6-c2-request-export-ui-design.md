# Request Studio Milestone 6 Phase C2 — Request Export UI Design

## 1. Scope

Phase C2 exposes the Phase C1 export foundation through an English desktop workflow:

```text
Saved Request
  -> Main-owned preview capability
  -> sanitized RequestAssetV1
  -> cURL or Request JSON preview
  -> Main Save dialog
  -> atomic file write
```

It adds an Export Request Tools entry, a preview modal, two IPC methods, safe file saving, and focused tests. It does not add code generation, Workspace export, cloud sync, OpenAPI, GraphQL, an installer, a database migration, or execution-engine changes.

## 2. Selected Approach

Use a Main-owned one-time preview capability. `export-request:preview` accepts `workspaceId`, `requestId`, and `format`; Main loads the request within that workspace, sanitizes it, generates the preview, and stores `{ previewId, preview }` per renderer sender. `export-request:save` accepts only `previewId`; Main opens the native Save dialog and writes the exact reviewed content.

This is preferred over reusing `response-resources:save-inline`, because returning content from Renderer would let Renderer replace the reviewed preview before saving. Combining preview and save was also rejected because users must inspect warnings and sanitized content before writing a file.

## 3. Formats

- `curl`: HTTP only; reuse `createCurlExportPreview` unchanged.
- `request-json`: HTTP, WebSocket, and SSE; serialize the sanitized `RequestAssetV1` with two-space indentation and one trailing newline.

Request JSON uses a sanitized ASCII filename ending in `.request-studio.json`. cURL keeps the existing `.sh` suggestion. No format resolves Environment variables or restores redacted secrets.

## 4. Main and IPC Boundary

The Renderer never imports export generators or Node APIs. Preload exposes only:

```ts
requestExport.preview(input)
requestExport.save(previewId)
```

Main validates all inputs with strict schemas. Preview lookup uses both request ID and workspace ID, so a renderer cannot export a request through the wrong workspace context. Preview IDs are random, sender-scoped, replaced by the next preview, and consumed after a successful save.

Fixed errors cover invalid input, missing or unauthorized requests, unsupported formats, expired previews, and file failures. Errors never include request data, preview content, paths, or caught exception messages.

## 5. File Safety

Main owns `dialog.showSaveDialog`, path handling, and filesystem writes.

- Suggested filenames are reduced to a basename, invalid Windows characters and trailing dots/spaces are replaced, reserved device names are prefixed, and length is bounded.
- Renderer cannot submit a destination path.
- A selected destination inside Electron `userData` is rejected.
- Content is written to a random sibling temporary file and renamed over the destination. Failed writes remove the temporary file.
- Cancellation returns `{ saved: false }` and does not consume the preview.

The native dialog decides the user-selected destination. No arbitrary path is returned to Renderer.

## 6. UI

The existing Tools popup gains `Export Request...`. The modal follows the existing restrained dark, industrial Request Studio styling and reuses established modal, titlebar, warning, code-preview, row, and focus patterns.

The workflow is:

1. Select a Saved Request.
2. Select a supported format.
3. Generate Preview.
4. Review format, filename, warnings, and read-only content.
5. Save File.

For WebSocket and SSE, cURL is disabled and Request JSON is selected. The modal renders no request ID or filesystem destination. Busy, error, canceled, and saved states use accessible labels and status/alert semantics.

## 7. Security Properties

- Every preview starts with `mapSavedRequestToExportAsset`.
- Existing placeholders such as `{{TOKEN}}` remain unchanged; raw credentials become `[REDACTED]`.
- Database IDs, history, Experiment metadata, local file references, and local paths remain outside serialized assets.
- Main generates and stores preview content; Renderer only displays it.
- Save uses the Main-held preview, not Renderer-supplied content.
- Context isolation, sandboxing, navigation restrictions, and the explicit Preload whitelist remain unchanged.

## 8. Testing

Use TDD for each behavior:

- Pure preview tests: both formats, protocol support, filename safety, secret/path/ID exclusion, and fixed unsupported-format errors.
- File tests: filename sanitization, sibling temporary write plus rename, `userData` rejection, cancellation, and temporary-file cleanup on failure.
- IPC tests: valid preview/save, invalid request, unknown format, workspace ownership, sender isolation, expired preview, and safe failures.
- UI tests: Tools entry, request and format selection, preview details, warnings, save, cancellation, error handling, and no secret/path/ID rendering.

The complete repository validation matrix remains lint, typecheck, tests, build, database/media/streaming/Electron smoke, and `git diff --check`.

## 9. Actual-Repository Adjustments

The prompt's example Save input included `destination`. The implementation intentionally omits it: Main opens the native dialog so Renderer never handles a path. Preview input includes `workspaceId` in addition to `requestId` and `format` to enforce workspace ownership. Request JSON is added as a small pure serializer because Phase C1 currently defines only the cURL preview type and generator.
