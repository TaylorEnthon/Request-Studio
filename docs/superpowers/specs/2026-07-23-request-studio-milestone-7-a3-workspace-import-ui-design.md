# Request Studio Milestone 7 Phase A3 — Workspace Import UI Design

## Status

Approved on 2026-07-23 for implementation. This phase adds the English desktop workflow for the existing A1 dry-run parser and A2 transactional apply foundation. It does not add conflict resolution or change the database schema.

## Goals

- Add `Tools > Import Workspace...`.
- Select one Workspace bundle through a Main-owned file dialog.
- Preview safe metadata, counts, warnings, conflicts, and blocked operations.
- Require two explicit confirmation actions before applying.
- Apply through the existing A2 SQLite transaction.
- Refresh the Workspace list after success.

## Non-goals

- Conflict Resolution UI or rename controls.
- Secret restoration.
- Workspace export changes.
- Cloud sync, collaboration, Postman, OpenAPI, or Milestone 7 Phase A4.
- Renderer filesystem, path, JSON parsing, repository, or SQLite access.
- Database migration or request execution changes.

## Selected Approach

Use a Main-memory preview capability, matching the existing cURL import and Workspace export IPC patterns.

The Main process owns the file path and source content. The Renderer receives a random `previewId` plus safe display data. Apply accepts only that `previewId`; the Main process recovers the original source and invokes the A2 transaction. Preview capabilities are scoped to the invoking sender and consumed only after a successful apply.

This avoids exposing bundle content or paths to the Renderer and avoids creating a second import implementation.

## User Flow

1. Open `Tools > Import Workspace...`.
2. Choose an import mode:
   - `Create a new Workspace` by default.
   - `Merge into current Workspace` when a current Workspace exists.
3. Select a `.json` bundle. The native file dialog is opened by Main.
4. Review:
   - Workspace name.
   - Collection, request, environment, and variable counts.
   - Warning, conflict, and blocked-operation summaries.
5. If the preview has no conflicts or blocked operations, select `Continue to Import`.
6. Review the final warning that secrets will not be restored, then select `Import Workspace`.
7. Show fixed success counts or a safe fixed error. Refresh the Workspace list after success.

Closing the panel or selecting another file abandons the current UI state. Selecting another file replaces the sender's previous Main-memory preview capability.

## UI Integration

The existing `Tools` button becomes available even when no Workspace exists so the first Workspace can be imported. Tools that require a current Workspace remain individually disabled.

The import panel reuses the existing modal, titlebar, form, summary-card, warning, error, busy, and Escape-to-close patterns. It adds only the import-specific confirmation state and concise conflict/blocked summaries. No raw JSON preview is rendered.

Accessibility requirements:

- Dialog has an accessible name and modal semantics.
- Inputs and mode controls have explicit labels.
- Busy state disables mode, file selection, and apply controls.
- Errors use `role="alert"`; success uses `role="status"`.
- Keyboard Escape closes the panel when no operation is running.

## IPC Contract

### `workspace-import:preview`

Input, validated with Zod:

```ts
{
  mode: 'create-workspace' | 'merge-into-workspace'
  targetWorkspaceId?: string
}
```

Main opens a single-file JSON dialog, rejects files larger than the A1 16 MiB source limit before reading, reads UTF-8 text, and invokes the shared Repository preview path.

Cancellation returns a successful `{ selected: false }` result. A valid selection returns:

```ts
{
  selected: true
  previewId: string
  preview: {
    format: 'request-studio.workspace'
    version: 1
    workspaceName: string
    counts: {
      collections: number
      requests: number
      environments: number
      variables: number
    }
    warnings: Array<{ code: string; message: string }>
    conflicts: Array<{ code: string; entity: string; name: string }>
    blockedOperationCount: number
  }
}
```

The response must not include the selected path, source text, database IDs, source references, secret values, or runtime metadata.

### `workspace-import:apply`

Input, validated with Zod:

```ts
{ previewId: string }
```

Main resolves the sender-scoped capability and calls the existing A2 `Repository.applyWorkspaceImport()` with the stored source, mode, and target Workspace. A2 reparses and regenerates its dry run inside one SQLite transaction before writing.

Successful apply returns only mode and imported entity counts. The preview is then consumed. Missing, stale, or cross-sender IDs return a fixed expiration error.

## Repository Reuse

The current A2 target-snapshot construction is embedded inside `Repository.applyWorkspaceImport()`. Extract the smallest shared private analysis path needed by both preview and apply:

- Parse with A1 `parseWorkspaceImportSource()`.
- Build the live create/merge analysis from SQLite.
- Run A1 `createWorkspaceImportDryRun()`.
- Run the existing A2 `prepareWorkspaceImportApply()` safety gate with no resolutions before returning any display text.

The public preview method is read-only. Apply continues to own validation, resolution preparation, final dry run, and all writes inside its existing transaction. No new service, interface, or import engine is introduced.

## Security Boundaries

```text
Renderer
  -> named Preload methods
  -> Main IPC with Zod validation
  -> Main-owned dialog and bounded file read
  -> A1 parse and dry run
  -> sender-scoped in-memory preview capability
  -> A2 transactional apply
  -> SQLite
```

- `contextIsolation`, sandboxing, and disabled Node integration remain unchanged.
- Renderer receives no filesystem capability and never parses the bundle.
- Preview IDs are random and scoped with `WeakMap<object, ...>` by sender.
- Only one latest preview is retained per sender, bounding Main memory to one A1-sized source.
- Sensitive variable values stay sanitized by the A1 contract; A2 writes secret slots with empty values.
- Unsafe imported text is rejected by the existing A2 safety gate before names or conflict details reach Renderer.
- Errors and logs never include source text, credentials, or local paths.
- Merge ownership is enforced by looking up the target Workspace in Main/Repository, not by trusting Renderer metadata.

## Error Handling

IPC maps failures to fixed safe responses. Expected categories include invalid input, canceled selection, unreadable or oversized file, invalid bundle, unavailable target Workspace, conflicts, expired preview, transaction failure, and import already in progress.

The UI displays only returned fixed messages. It never renders exception text or file paths. Conflicts or blocked operations disable the confirmation flow; resolving them is deferred to a later phase.

## Tests

Repository tests cover shared preview/apply analysis and confirm preview is read-only.

IPC tests cover:

- Create and merge previews.
- Dialog cancellation.
- Invalid input, invalid/oversized/unreadable files, and unavailable targets.
- Safe metadata and absence of paths, IDs, source text, and secrets.
- Sender isolation, preview replacement, cross-sender apply rejection, and concurrent apply rejection.
- Transaction rollback and capability consumption only after success.

UI tests cover:

- Tools entry with and without an existing Workspace.
- Mode selection and Main-owned file selection.
- Counts, warnings, conflicts, and blocked summaries.
- Disabled apply for conflicts.
- Two-step confirmation.
- Success refresh, fixed error display, busy locking, close, and Escape.

The existing full lint, typecheck, unit, build, aggregate, database, media, streaming, and Electron smoke commands remain required before delivery.

## Files and Scope

Expected additions:

- `src/main/ipc/workspace-import-handlers.ts`
- `src/main/ipc/workspace-import-handlers.test.ts`
- `src/renderer/WorkspaceImportPanel.tsx`
- `src/renderer/WorkspaceImportPanel.test.tsx`

Expected focused edits:

- `src/main/repository.ts` and its tests for shared read-only dry-run analysis.
- `src/main/index.ts` for handler registration.
- `src/preload/index.ts` for the two named methods.
- `src/renderer/App.tsx`, App tests, and minimal existing-style CSS.

No new dependency, schema file, service layer, or speculative abstraction is planned.

## Prompt Differences

The prompt suggested example IPC shapes but left mode handling and Repository preview ownership open. The actual code already supports create and merge modes in A1/A2, while A2 keeps target snapshot generation inside `applyWorkspaceImport()`. The implementation therefore exposes both existing modes and performs a small shared Repository extraction so preview and apply use the same live analysis rather than duplicating it in IPC.
