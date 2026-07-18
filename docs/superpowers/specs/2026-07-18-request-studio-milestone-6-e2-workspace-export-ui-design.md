# Request Studio Milestone 6 Phase E2 — Workspace Export UI Design

## Goal

Let users select a workspace, review a safe export summary and bounded JSON preview, then save the exact `WorkspaceExportV1` bundle through Main Process file APIs.

## Scope

E2 adds a Tools entry, a workspace export dialog, named IPC, a Main-owned preview capability, save dialog integration, and atomic JSON writing. It does not add workspace import, cloud sync, collaboration, schema changes, history/experiment/resource export, or execution-engine changes.

## Architecture

```text
Renderer WorkspaceExportPanel
  -> Preload workspaceExport whitelist
  -> Main workspace-export handlers
  -> Repository.getWorkspaceExportSource()
  -> mapWorkspaceExportV1()
  -> serializeWorkspaceExportV1Chunks()
  -> atomic temporary file + rename
```

The Renderer never receives a destination path, database row, or full unsanitized source. Preview and save are separate named IPC calls. Main stores the latest bundle in a sender-scoped `WeakMap`; save accepts only its random `previewId`, preventing another renderer from reusing the capability.

## Preview Contract

`workspace-export:preview` accepts `{ workspaceId }`. A successful result contains:

- `previewId`
- `format: "request-studio.workspace"`
- `version: 1`
- sanitized workspace name
- collection, request, and environment counts
- warnings
- a bounded JSON preview string and `truncated` flag

The preview is capped at 32 KiB. Main retains the validated bundle for saving, so large exports do not cross the Renderer boundary. A warning reports redacted or empty secret slots; another reports preview truncation.

## Save Contract

`workspace-export:save` accepts `{ previewId }`. Main opens `dialog.showSaveDialog()` with a filename derived from the sanitized workspace name and passed through the existing `sanitizeExportFilename()` helper. Cancel keeps the preview available. A successful save consumes it. Concurrent saves per sender are rejected.

The existing atomic writer is widened from `string` to `string | Iterable<string>`, which Node's installed runtime supports natively. Workspace save passes `serializeWorkspaceExportV1Chunks(bundle)`, preserving E1's per-item memory bound while retaining the existing sibling temporary-file and rename behavior.

## UI

The Tools menu adds `Export Workspace...`. `WorkspaceExportPanel` follows the existing Request Export dialog structure and visual language:

- workspace selector
- Generate Preview action
- workspace name and three count cards
- warning list
- bounded JSON preview
- Save File and Close actions

Changing workspace clears stale preview state. Escape closes the dialog. No path is rendered after save.

## Errors and Security

Invalid input returns the shared validation error. A missing workspace returns `WORKSPACE_NOT_FOUND`; mapper/source relationship rejection returns the same public code so internal ownership details are not exposed. Expired or cross-sender capabilities return `PREVIEW_EXPIRED`. Save failures return fixed messages without paths or source values.

Request Studio currently has no user/account ownership model. E2 therefore enforces the available boundary: workspace existence, workspace-scoped SQL queries, mapper relationship validation, and sender-scoped preview capabilities.

The E1 sanitizer remains authoritative. Secret values, database IDs, timestamps, local paths, history, experiments, resources, and runtime metadata never enter the Renderer preview or saved bundle. Placeholders such as `{{TOKEN}}` and empty secret slots are allowed.

## Testing

- IPC: valid preview/save, invalid/missing workspace, cross-sender preview, concurrent save, cancellation, fixed write failure.
- UI: Tools entry, workspace selection, summary counts, warnings, bounded preview, save and close.
- File: filename sanitizer reuse, iterable atomic write, cleanup after failed rename.
- Security: no raw credential, local path, database ID, or destination path in preview/results.
- Full project verification and all smoke commands remain required.

## Deliberate Limits

The SQLite snapshot and validated bundle remain in Main memory because the synchronous repository returns arrays. The JSON file itself is emitted in chunks; database paging is deferred until measured workspace size requires it.
