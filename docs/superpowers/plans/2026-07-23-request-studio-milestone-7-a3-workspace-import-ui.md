# Request Studio Milestone 7 Phase A3 — Workspace Import UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure English Workspace Import preview and transactional apply workflow to the existing desktop Tools menu.

**Architecture:** Main owns file selection, bounded reading, preview source, and Repository access. Renderer receives only a sender-scoped preview capability and safe summary; apply resolves that capability and reuses the A2 transaction, which reparses and rechecks live conflicts before writing.

**Tech Stack:** Electron 43, React 19, TypeScript 6, Zod 4, better-sqlite3, Vitest, Testing Library.

## Global Constraints

- Keep `Renderer -> Preload whitelist -> Main named IPC -> A1/A2 -> SQLite`.
- English UI only.
- No Renderer filesystem, path, JSON parsing, Repository, SQLite, or absolute-path access.
- Reject files larger than `WORKSPACE_IMPORT_LIMITS.maxSourceBytes` before reading.
- Never return or log source JSON, secret values, local paths, database IDs, or source references.
- Run the existing A2 safety gate before returning imported display text.
- No conflict-resolution UI, secret restore, schema migration, execution-engine change, A4, cloud, Postman, or OpenAPI work.
- No new dependencies, service layer, interface, factory, or speculative abstraction.

---

### Task 1: Share the Repository Dry-run Analysis

**Files:**
- Modify: `src/main/repository.ts`
- Modify: `src/main/repository.test.ts`

**Interfaces:**
- Consumes: `parseWorkspaceImportSource()`, `createWorkspaceImportDryRun()`, and `prepareWorkspaceImportApply()`.
- Produces: `Repository.previewWorkspaceImport(source, mode, targetWorkspaceId?)`, returning the existing dry-run result or an existing fixed import error.
- Produces: one private `analyzeWorkspaceImport(bundle, mode, targetWorkspaceId?)` path reused by preview and apply.

- [ ] **Step 1: Write failing Repository preview tests**

Add tests that call:

```ts
const result = repo.previewWorkspaceImport(source, 'create-workspace')
expect(result).toMatchObject({
  ok: true,
  dryRun: {
    mode: 'create-workspace',
    summary: { collectionCount: 1, requestCount: 1, environmentCount: 1, variableCount: 1 },
  },
})
expect(repo.list('workspaces')).toHaveLength(0)
```

Add merge, missing-target, and unsafe-content cases:

```ts
expect(repo.previewWorkspaceImport(source, 'merge-into-workspace', 'target')).toMatchObject({
  ok: true,
  dryRun: { mode: 'merge-into-workspace' },
})
expect(repo.previewWorkspaceImport(source, 'merge-into-workspace', 'missing')).toMatchObject({
  ok: false,
  error: { code: 'TARGET_WORKSPACE_NOT_FOUND' },
})
expect(repo.previewWorkspaceImport(unsafeSource, 'create-workspace')).toMatchObject({
  ok: false,
  error: { code: 'UNSAFE_IMPORT_CONTENT' },
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx vitest run src/main/repository.test.ts
```

Expected: FAIL because `previewWorkspaceImport` does not exist.

- [ ] **Step 3: Implement the minimum shared analysis path**

In `Repository`, add a private method that constructs the exact existing A2 analysis:

```ts
private analyzeWorkspaceImport(
  bundle: WorkspaceExportV1,
  mode: WorkspaceImportMode,
  targetWorkspaceId?: string,
) {
  const analysis = mode === 'create-workspace'
    ? {
        mode,
        existingWorkspaceNames: (this.db.prepare('SELECT name FROM workspaces ORDER BY name,id').all() as { name: string }[])
          .map(({ name }) => name),
      }
    : { mode, target: this.getWorkspaceImportTarget(targetWorkspaceId) }
  return createWorkspaceImportDryRun(bundle, analysis)
}
```

Keep target snapshot construction in one small private method. Add the read-only public method:

```ts
previewWorkspaceImport(source: unknown, mode: WorkspaceImportMode, targetWorkspaceId?: string) {
  const parsed = parseWorkspaceImportSource(source)
  if (!parsed.ok) return parsed
  const dryRun = this.analyzeWorkspaceImport(parsed.bundle, mode, targetWorkspaceId)
  if (!dryRun.ok) return dryRun
  const safe = prepareWorkspaceImportApply(parsed.bundle, dryRun.dryRun)
  return safe.ok ? dryRun : safe
}
```

Replace the duplicated analysis block in `applyWorkspaceImport()` with `this.analyzeWorkspaceImport(...)`. Preserve its transaction, resolution preparation, final dry run, and result contract unchanged.

- [ ] **Step 4: Run Repository tests and verify GREEN**

Run:

```bash
npx vitest run src/main/repository.test.ts src/shared/assets/workspace-import.test.ts src/shared/assets/workspace-import-apply.test.ts
```

Expected: all selected tests pass; existing A2 apply and rollback tests remain green.

- [ ] **Step 5: Commit the shared Repository seam**

```bash
git add src/main/repository.ts src/main/repository.test.ts
git commit -m "refactor: share workspace import analysis"
```

---

### Task 2: Add Main-owned Workspace Import IPC

**Files:**
- Create: `src/main/ipc/workspace-import-handlers.ts`
- Create: `src/main/ipc/workspace-import-handlers.test.ts`

**Interfaces:**
- Consumes: `Repository.previewWorkspaceImport()` and `Repository.applyWorkspaceImport()`.
- Produces: `registerWorkspaceImportHandlers(repo)`.
- Produces channels `workspace-import:preview` and `workspace-import:apply`.

- [ ] **Step 1: Write failing IPC tests**

Mock only Electron IPC and the open dialog:

```ts
const handlers = new Map<string, (event: any, input: unknown) => any>()
const showOpenDialog = vi.hoisted(() => vi.fn())
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: any) => handlers.set(channel, handler) },
  dialog: { showOpenDialog },
}))
```

Use temporary JSON files generated from the existing workspace bundle fixture. Cover:

```ts
showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [bundlePath] })
const preview = await handlers.get('workspace-import:preview')!(owner, { mode: 'create-workspace' })
expect(preview).toMatchObject({
  ok: true,
  data: {
    selected: true,
    preview: {
      format: 'request-studio.workspace',
      version: 1,
      counts: { collections: 1, requests: 1, environments: 1, variables: 1 },
      blockedOperationCount: 0,
    },
  },
})
expect(JSON.stringify(preview)).not.toMatch(/bundlePath|workspace-db-id|raw-secret|sourceRef/)
```

Also cover cancellation, invalid input, missing/oversized/unreadable files, unsafe imported text, merge target failure, conflicts, capability replacement, cross-sender apply, concurrent apply, transaction failure, and successful single-use apply.

- [ ] **Step 2: Run the focused IPC test and verify RED**

Run:

```bash
npx vitest run src/main/ipc/workspace-import-handlers.test.ts
```

Expected: FAIL because the handler module does not exist.

- [ ] **Step 3: Implement named handlers with existing patterns**

Use only stdlib and installed dependencies:

```ts
import { randomUUID } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { WORKSPACE_IMPORT_LIMITS } from '../../shared/assets/workspace-import'
import type { Repository } from '../repository'
import { validate } from './validate'
```

Validate strict inputs:

```ts
const previewInput = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('create-workspace') }).strict(),
  z.object({ mode: z.literal('merge-into-workspace'), targetWorkspaceId: z.string().min(1) }).strict(),
])
const applyInput = z.object({ previewId: z.string().uuid() }).strict()
```

Keep one bounded capability per sender:

```ts
const previews = new WeakMap<object, {
  id: string
  source: string
  mode: 'create-workspace' | 'merge-into-workspace'
  targetWorkspaceId?: string
}>()
const applying = new WeakSet<object>()
```

Preview must:

1. Delete the sender's stale capability.
2. Validate the mode/target.
3. Open a Main-owned single JSON file dialog.
4. Return `{ selected: false }` for cancellation.
5. `stat()` and reject sizes above `maxSourceBytes` before `readFile()`.
6. Call `repo.previewWorkspaceImport()`.
7. Store source only after a safe successful dry run.
8. Return only format/version/workspace name/counts/warnings/conflict code/entity/display name and blocked count.

Apply must validate the UUID, enforce sender ownership and one apply at a time, call A2, consume the capability only on success, and return fixed safe failures. Never include caught exception text.

- [ ] **Step 4: Run IPC and Repository tests and verify GREEN**

Run:

```bash
npx vitest run src/main/ipc/workspace-import-handlers.test.ts src/main/repository.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit Main import capability**

```bash
git add src/main/ipc/workspace-import-handlers.ts src/main/ipc/workspace-import-handlers.test.ts
git commit -m "feat: add workspace import IPC"
```

---

### Task 3: Whitelist and Register the IPC

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/main/index.ts`
- Modify: `src/main/ipc/workspace-import-handlers.test.ts`

**Interfaces:**
- Consumes: `registerWorkspaceImportHandlers(repo)`.
- Produces: `window.requestStudio.workspaceImport.preview(input)` and `.apply(previewId)`.

- [ ] **Step 1: Add a failing registration assertion**

Extend the handler test to assert both exact channels exist after registration:

```ts
expect(handlers.has('workspace-import:preview')).toBe(true)
expect(handlers.has('workspace-import:apply')).toBe(true)
```

Add a source-level preload assertion only if existing tests already use that pattern; otherwise rely on typecheck/build and the UI mock contract.

- [ ] **Step 2: Add the two explicit Preload methods**

```ts
workspaceImport: {
  preview: (input: unknown) => invoke('workspace-import:preview', input),
  apply: (previewId: string) => invoke('workspace-import:apply', { previewId }),
},
```

Do not expose generic IPC, filesystem, paths, or source text.

- [ ] **Step 3: Register handlers during Main startup**

Import and call:

```ts
import { registerWorkspaceImportHandlers } from './ipc/workspace-import-handlers'
// after Repository creation and beside export/import handlers
registerWorkspaceImportHandlers(repo)
```

- [ ] **Step 4: Verify typecheck and build**

Run:

```bash
npm run typecheck
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit the Main/Preload wiring**

```bash
git add src/preload/index.ts src/main/index.ts src/main/ipc/workspace-import-handlers.test.ts
git commit -m "feat: expose workspace import workflow"
```

---

### Task 4: Build the Import Preview and Confirmation Panel

**Files:**
- Create: `src/renderer/WorkspaceImportPanel.tsx`
- Create: `src/renderer/WorkspaceImportPanel.test.tsx`
- Modify: `src/renderer/styles.css`

**Interfaces:**
- Consumes: `window.requestStudio.workspaceImport.preview({ mode, targetWorkspaceId? })` and `.apply(previewId)`.
- Produces: `<WorkspaceImportPanel workspaces initialWorkspaceId onClose onImported />`.

- [ ] **Step 1: Write failing UI tests**

Render the panel with two Workspaces and mocked named methods. Cover:

```ts
fireEvent.click(screen.getByRole('button', { name: 'Select Workspace File' }))
await screen.findByText('Imported Workspace')
expect(screen.getByText('4', { selector: 'strong' })).toBeInTheDocument()
expect(screen.getByRole('button', { name: 'Continue to Import' })).toBeEnabled()

fireEvent.click(screen.getByRole('button', { name: 'Continue to Import' }))
expect(screen.getByText('Secrets will not be restored.')).toBeInTheDocument()
fireEvent.click(screen.getByRole('button', { name: 'Import Workspace' }))
await waitFor(() => expect(apply).toHaveBeenCalledWith(previewId))
expect(onImported).toHaveBeenCalledTimes(1)
```

Add cases for create default, merge target, cancellation, conflicts disabling confirmation, fixed errors, busy locking, success counts, Close, and Escape. Assert rendered text contains no fixture secret, local path, database ID, or source reference.

- [ ] **Step 2: Run the panel test and verify RED**

Run:

```bash
npx vitest run src/renderer/WorkspaceImportPanel.test.tsx
```

Expected: FAIL because the panel does not exist.

- [ ] **Step 3: Implement the minimum three-state panel**

Use local state only:

```ts
type Stage = 'preview' | 'confirm' | 'complete'
const [mode, setMode] = useState<'create-workspace' | 'merge-into-workspace'>('create-workspace')
const [targetWorkspaceId, setTargetWorkspaceId] = useState(initialWorkspaceId)
const [previewState, setPreviewState] = useState<PreviewState | null>(null)
const [stage, setStage] = useState<Stage>('preview')
const [busy, setBusy] = useState(false)
```

Reuse the current modal/titlebar/row/summary/error/warning classes. Render no raw JSON. Disable `Continue to Import` when conflict count or blocked count is nonzero. The final confirmation must say `Secrets will not be restored.` and require a separate `Import Workspace` click.

On success, show imported counts, call `onImported()`, and keep the completion message visible until Close. Escape closes only when not busy.

- [ ] **Step 4: Run panel tests and verify GREEN**

Run:

```bash
npx vitest run src/renderer/WorkspaceImportPanel.test.tsx
```

Expected: all panel tests pass.

- [ ] **Step 5: Commit the panel**

```bash
git add src/renderer/WorkspaceImportPanel.tsx src/renderer/WorkspaceImportPanel.test.tsx src/renderer/styles.css
git commit -m "feat: add workspace import preview panel"
```

---

### Task 5: Integrate the Tools Entry and Refresh Flow

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

**Interfaces:**
- Consumes: `WorkspaceImportPanel`.
- Produces: `Tools > Import Workspace...` with refresh after successful apply.

- [ ] **Step 1: Write failing App integration tests**

Cover a populated and an empty app:

```ts
fireEvent.click(await screen.findByRole('button', { name: 'Tools' }))
fireEvent.click(screen.getByRole('menuitem', { name: 'Import Workspace...' }))
expect(screen.getByRole('dialog', { name: 'Import Workspace' })).toBeInTheDocument()
```

For no Workspaces, mock `workspaces.list()` with `[]`, verify Tools and Import Workspace remain enabled, and verify existing workspace-dependent items are disabled. For success, resolve apply and verify `workspaces.list()` is called again.

- [ ] **Step 2: Run App tests and verify RED**

Run:

```bash
npx vitest run src/renderer/App.test.tsx
```

Expected: FAIL because the menu item and panel integration do not exist.

- [ ] **Step 3: Add the focused App integration**

Add one state flag and import:

```ts
import WorkspaceImportPanel from './WorkspaceImportPanel'
const [showWorkspaceImport, setShowWorkspaceImport] = useState(false)
```

Remove `disabled={!workspace}` from the Tools button. Add `Import Workspace...` first in the menu. Add `disabled={!workspace}` only to existing items that require it. Render:

```tsx
{showWorkspaceImport && (
  <WorkspaceImportPanel
    workspaces={workspaces}
    initialWorkspaceId={workspace}
    onClose={() => setShowWorkspaceImport(false)}
    onImported={load}
  />
)}
```

Do not automatically expose or select a newly created database ID; A2 intentionally returns only safe counts.

- [ ] **Step 4: Run focused Renderer tests and verify GREEN**

Run:

```bash
npx vitest run src/renderer/App.test.tsx src/renderer/WorkspaceImportPanel.test.tsx
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit Tools integration**

```bash
git add src/renderer/App.tsx src/renderer/App.test.tsx
git commit -m "feat: add workspace import Tools workflow"
```

---

### Task 6: Security Review and Full Delivery Verification

**Files:**
- Modify only test files if a concrete missing assertion is found.

**Interfaces:**
- Consumes: the complete A3 flow.
- Produces: evidence for final delivery and no functional expansion.

- [ ] **Step 1: Run focused security searches and diff checks**

```bash
git diff main...HEAD -- src/renderer src/preload src/main/ipc src/main/repository.ts
git diff --check
rg -n "readFile|showOpenDialog|JSON\.parse|database|Repository" src/renderer/WorkspaceImportPanel.tsx src/preload/index.ts
```

Expected: file read/dialog/Repository access appears only in Main; Preload has only named invocations; panel has no source parsing or path handling.

- [ ] **Step 2: Run the required validation matrix**

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:all
npm run smoke:database
npm run smoke:media
npm run smoke:streaming
npm run smoke:electron
git diff --check
```

Expected: every command exits 0. If Electron smoke hits Windows MSBuild FileTracker `E_ACCESSDENIED`, rerun the same command elevated and record the environment cause; do not change code.

- [ ] **Step 3: Review final scope and status**

```bash
git status --short --branch
git log --oneline main..HEAD
git diff --stat main...HEAD
git diff --name-only main...HEAD
```

Expected: only A3 design/plan, Repository import analysis, Workspace Import IPC/Preload/UI, tests, and minimal CSS changed; working tree clean after commits.

- [ ] **Step 4: Commit only a concrete verification fix if needed**

If Step 1 or 2 required a real test correction:

```bash
git add src/main/repository.test.ts src/main/ipc/workspace-import-handlers.test.ts src/renderer/WorkspaceImportPanel.test.tsx src/renderer/App.test.tsx
git commit -m "test: strengthen workspace import security coverage"
```

If no correction is needed, do not create an empty commit.

- [ ] **Step 5: Proceed to branch finish workflow**

Use `superpowers:verification-before-completion`, then the repository's normal push/PR/required-CI/squash-merge/main-CI/cleanup workflow. Never amend, rebase, force-push, or skip required checks.
