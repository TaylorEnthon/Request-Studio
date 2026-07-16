# Request Studio Milestone 6 Phase C2 Request Export UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users preview and safely save cURL or Request JSON exports for Saved Requests without exposing filesystem access or unsanitized data to Renderer.

**Architecture:** Main owns request lookup, export generation, preview capabilities, the native Save dialog, and atomic writes. Renderer receives only sanitized preview data through a two-method Preload whitelist and never submits file content or destination paths.

**Tech Stack:** Electron, React 19, TypeScript 6, Zod 4, Vitest 4, Node.js standard library APIs.

## Global Constraints

- Reuse `mapSavedRequestToExportAsset`, `createCurlExportPreview`, and `RequestAssetV1`.
- Preserve fixed placeholders and `[REDACTED]`; never resolve Environment values.
- Renderer must not import `fs`, `path`, Electron dialog APIs, or export generators.
- Add no dependency, migration, execution-engine change, Code Generation, Workspace Export, OpenAPI, GraphQL, Cloud Sync, or Installer behavior.
- Use fixed safe errors without source input, paths, content, IDs, or caught exception messages.
- Use TDD: every production behavior must first be observed failing for the expected reason.

---

### Task 1: Pure Multi-format Export Preview

**Files:**
- Create: `src/shared/assets/request-export-preview.ts`
- Create: `src/shared/assets/request-export-preview.test.ts`

**Interfaces:**
- Consumes: `SavedRequestAssetRow`, `mapSavedRequestToExportAsset(row)`, and `createCurlExportPreview(asset)`.
- Produces: `RequestExportFormat`, `RequestExportPreview`, and `createRequestExportPreview(row, format)`.

- [ ] **Step 1: Write the failing format tests**

Create one HTTP Saved Request fixture containing a raw bearer credential, database/workspace metadata, and a Windows path in its description. Assert:

```ts
const curl = createRequestExportPreview(row, 'curl')
expect(curl.format).toBe('curl')
expect(curl.content).toContain("--request 'GET'")

const json = createRequestExportPreview(row, 'request-json')
expect(json).toMatchObject({
  format: 'request-json',
  protocol: 'http',
  filenameSuggestion: 'users-request.request-studio.json',
})
expect(JSON.parse(json.content)).toMatchObject({
  format: 'request-studio.request',
  version: 1,
  protocol: 'http',
})
expect(JSON.stringify({ curl, json })).not.toMatch(
  /raw-bearer-fixture|database-id|workspace-id|C:\\\\Users/,
)
```

Add WebSocket and SSE cases proving `request-json` works and `curl` throws only `cURL export supports HTTP requests only.`. Add an all-symbol name case proving the JSON filename falls back to `request.request-studio.json`.

- [ ] **Step 2: Run the test and verify RED**

Run: `npx vitest run src/shared/assets/request-export-preview.test.ts`

Expected: FAIL because `./request-export-preview` does not exist.

- [ ] **Step 3: Implement the minimum pure dispatcher**

Implement these public types and function:

```ts
export type RequestExportFormat = 'curl' | 'request-json'
export type RequestJsonExportPreview = Readonly<{
  format: 'request-json'
  protocol: RequestAssetV1['protocol']
  filenameSuggestion: string
  content: string
  warnings: readonly ExportWarning[]
}>
export type RequestExportPreview = ExportPreview | RequestJsonExportPreview

export function createRequestExportPreview(
  row: SavedRequestAssetRow,
  format: RequestExportFormat,
): RequestExportPreview
```

Map the row once through `mapSavedRequestToExportAsset`. For cURL, reject non-HTTP assets with the fixed error and call the existing generator. For Request JSON, return `JSON.stringify(asset, null, 2) + '\n'`, no new warnings, and a lowercase ASCII slug of at most 80 characters plus `.request-studio.json`.

- [ ] **Step 4: Verify GREEN and existing C1 compatibility**

Run:

```bash
npx vitest run src/shared/assets/request-export-preview.test.ts src/shared/assets/request-export.test.ts src/shared/assets/curl-export.test.ts
npm run typecheck
git diff --check
```

Expected: all focused tests and typecheck pass; C1 files remain unchanged.

---

### Task 2: Safe Atomic Export File Writer

**Files:**
- Create: `src/main/export/request-export-file.ts`
- Create: `src/main/export/request-export-file.test.ts`

**Interfaces:**
- Produces: `sanitizeExportFilename(value)` and `writeExportFileAtomic(destination, content, userData)`.

- [ ] **Step 1: Write failing filename and filesystem tests**

Use `mkdtemp`, `tmpdir`, and real filesystem calls. Assert:

```ts
expect(sanitizeExportFilename('../../CON.sh')).toBe('_CON.sh')
expect(sanitizeExportFilename('bad:<secret>.sh')).toBe('bad__secret_.sh')
expect(sanitizeExportFilename('...')).toBe('request.txt')

await writeExportFileAtomic(join(root, 'request.sh'), 'safe-content', userData)
expect(readFileSync(join(root, 'request.sh'), 'utf8')).toBe('safe-content')
expect(readdirSync(root).filter((name) => name.endsWith('.tmp'))).toEqual([])

await expect(
  writeExportFileAtomic(join(userData, 'blocked.sh'), 'safe-content', userData),
).rejects.toThrow('Export destination is not allowed.')
```

Force rename failure by using an existing directory as the destination. Assert the fixed `Request export could not be saved.` error and no sibling `.tmp` file remains.

- [ ] **Step 2: Run the test and verify RED**

Run: `npx vitest run src/main/export/request-export-file.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the minimum writer**

`sanitizeExportFilename` must use `basename`, replace control and Windows-invalid characters, trim trailing dots/spaces, cap at 160 characters, fall back to `request.txt`, and prefix Windows reserved device names.

`writeExportFileAtomic` must:

1. Resolve destination and `userData` and reject destinations whose case-insensitive `relative` path is empty or remains inside `userData`.
2. Write content to `.${basename(destination)}.${randomUUID()}.tmp` in the destination directory.
3. Rename the temporary file to the destination.
4. Remove the temporary file in `catch`, discard the caught error, and throw only `new Error('Request export could not be saved.')`.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npx vitest run src/main/export/request-export-file.test.ts
npm run typecheck
git diff --check
```

Expected: tests pass with no temporary files or path-bearing diagnostics.

---

### Task 3: Main Export IPC Capability

**Files:**
- Create: `src/main/ipc/request-export-handlers.ts`
- Create: `src/main/ipc/request-export-handlers.test.ts`
- Modify: `src/main/repository.ts`
- Modify: `src/main/index.ts`

**Interfaces:**
- Consumes: `Repository.getSavedRequestForExport`, `createRequestExportPreview`, Electron `dialog`, and `writeExportFileAtomic`.
- Produces: `registerRequestExportHandlers(repo, userData)` and IPC channels `request-export:preview` / `request-export:save`.

- [ ] **Step 1: Write failing IPC tests**

Mock only Electron `ipcMain.handle` and `dialog.showSaveDialog`; use an in-memory database and real temporary directory. Cover:

- HTTP cURL preview returns a UUID capability and no raw credential, database ID, workspace ID, or local path.
- Request JSON preview supports HTTP, WebSocket, and SSE.
- unknown format returns `INVALID_INPUT`.
- missing request and a request belonging to another workspace both return `REQUEST_NOT_FOUND`.
- a preview cannot be saved by another `event.sender`.
- canceled dialog returns `{ saved: false }` without consuming the preview.
- successful save writes the exact preview and consumes it.
- expired preview and failed write return fixed safe errors.

The handler invocation shape is:

```ts
const preview = await handlers.get('request-export:preview')!(event, {
  workspaceId: 'workspace-a',
  requestId: 'request-a',
  format: 'curl',
})
const saved = await handlers.get('request-export:save')!(event, {
  previewId: preview.data.previewId,
})
```

- [ ] **Step 2: Run the IPC test and verify RED**

Run: `npx vitest run src/main/ipc/request-export-handlers.test.ts`

Expected: FAIL because the handler module and repository method do not exist.

- [ ] **Step 3: Add one scoped repository lookup**

Add:

```ts
getSavedRequestForExport(id: string, workspaceId: string) {
  return this.db
    .prepare('SELECT * FROM saved_requests WHERE id=? AND workspace_id=?')
    .get(id, workspaceId)
}
```

Do not add a repository abstraction or change generic CRUD behavior.

- [ ] **Step 4: Implement the handlers**

Use strict Zod schemas:

```ts
const previewInput = z.object({
  workspaceId: z.string().min(1),
  requestId: z.string().min(1),
  format: z.enum(['curl', 'request-json']),
}).strict()
const saveInput = z.object({ previewId: z.string().uuid() }).strict()
```

Store one `{ id, preview }` per renderer sender in a `WeakMap<object, ...>`. Preview replaces any previous entry. Save opens `dialog.showSaveDialog({ defaultPath: sanitizeExportFilename(preview.filenameSuggestion) })`, preserves the capability on cancellation, writes via `writeExportFileAtomic`, and deletes the capability only after success.

Register the handler from `src/main/index.ts` after `userData` and `Repository` exist.

- [ ] **Step 5: Verify GREEN and Main regressions**

Run:

```bash
npx vitest run src/main/ipc/request-export-handlers.test.ts src/main/repository.test.ts
npm run typecheck
git diff --check
```

Expected: all tests pass; errors contain no fixture credentials or paths.

---

### Task 4: Preload Contract and Export Modal

**Files:**
- Create: `src/renderer/RequestExportPanel.tsx`
- Create: `src/renderer/RequestExportPanel.test.tsx`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/styles.css`

**Interfaces:**
- Consumes: `window.requestStudio.requestExport.preview(input)` and `.save(previewId)`.
- Produces: `RequestExportPanel({ workspaceId, requests, initialRequestId, onClose })`.

- [ ] **Step 1: Write failing modal workflow tests**

Render two requests, one HTTP and one WebSocket. Assert:

- request and format controls are present.
- HTTP defaults to cURL; WebSocket selects Request JSON and disables cURL.
- Generate Preview calls Main with `workspaceId`, `requestId`, and `format`.
- format, safe filename, warnings, and read-only content render.
- Save File sends only `previewId`.
- cancellation renders `Save canceled.`; success renders `File saved.`.
- preview clears when request or format changes.
- fixed IPC errors render through `role="alert"`.
- fixture secret, local path, and database ID never appear in `document.body.textContent`.

- [ ] **Step 2: Run the component test and verify RED**

Run: `npx vitest run src/renderer/RequestExportPanel.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Add the exact Preload whitelist**

Add only:

```ts
requestExport: {
  preview: (input: unknown) => invoke('request-export:preview', input),
  save: (previewId: string) => invoke('request-export:save', { previewId }),
},
```

- [ ] **Step 4: Implement the minimum modal**

Use English labels: `Export Request`, `Saved Request`, `Format`, `Generate Preview`, `Warnings`, `Filename`, `Save File`, and `Close`. Keep Main responses as `any` to match current Renderer conventions; do not introduce a parallel API typing layer.

Reuse `.modal`, `.curl-import-titlebar`, `.row`, `.warning`, `.hint`, and monospace styles. Add only `.request-export`, `.export-preview-meta`, and `.export-content` rules needed for a bounded readable preview. Keep focus outlines and semantic dialog/status/alert roles.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
npx vitest run src/renderer/RequestExportPanel.test.tsx
npm run typecheck
git diff --check
```

Expected: component tests and typecheck pass.

---

### Task 5: Tools Integration and Complete Delivery

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`
- Verify: every C2 file from Tasks 1-4

**Interfaces:**
- Consumes: `RequestExportPanel`.
- Produces: the user-visible `Tools -> Export Request...` workflow.

- [ ] **Step 1: Write the failing App entry test**

Extend the test API mock with:

```ts
requestExport: { preview: vi.fn(), save: vi.fn() }
```

Open Tools, click `Export Request...`, and assert the `Export Request` dialog appears. Close it and assert it disappears.

- [ ] **Step 2: Run the App test and verify RED**

Run: `npx vitest run src/renderer/App.test.tsx`

Expected: FAIL because the Tools entry does not exist.

- [ ] **Step 3: Integrate the panel minimally**

Import `RequestExportPanel`, add one `showRequestExport` boolean, add the Tools menu item, and render:

```tsx
<RequestExportPanel
  workspaceId={workspace}
  requests={requests}
  initialRequestId={selected?.id ?? ''}
  onClose={() => setShowRequestExport(false)}
/>
```

Do not modify request editors, protocol execution, autosave, database schema, or Experiment UI.

- [ ] **Step 4: Run focused C2 tests**

Run:

```bash
npx vitest run src/shared/assets/request-export-preview.test.ts src/main/export/request-export-file.test.ts src/main/ipc/request-export-handlers.test.ts src/renderer/RequestExportPanel.test.tsx src/renderer/App.test.tsx
```

Expected: all C2 and App tests pass.

- [ ] **Step 5: Run the complete local validation matrix**

Run each command separately:

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

If Electron smoke hits Windows MSBuild FileTracker permission denial, rerun the identical command with elevated permission and record the original error. Do not alter product code.

- [ ] **Step 6: Review scope and commit**

Run:

```bash
git status --short --branch
git diff --stat
git diff --name-only
git diff --check
git status --ignored
```

Confirm no secret, `.env`, database, log, screenshot, resource, `.codegraph`, `.ocr-results`, user-data, migration, Code Generation, Workspace Export, or unrelated refactor is staged. Then create one coherent feature commit:

```bash
git add src/shared/assets/request-export-preview.ts src/shared/assets/request-export-preview.test.ts src/main/export/request-export-file.ts src/main/export/request-export-file.test.ts src/main/ipc/request-export-handlers.ts src/main/ipc/request-export-handlers.test.ts src/main/repository.ts src/main/index.ts src/preload/index.ts src/renderer/RequestExportPanel.tsx src/renderer/RequestExportPanel.test.tsx src/renderer/App.tsx src/renderer/App.test.tsx src/renderer/styles.css
git diff --cached --check
git diff --cached --stat
git commit -m "feat: add request export workflow"
```

- [ ] **Step 7: Push, PR, CI, merge, and main closure**

Push `codex/milestone-6-c2-request-export-ui` without force. Open a ready PR titled `Milestone 6 C2 — Request Export UI & User Workflow`. Record architecture, security boundaries, formats, tests, and non-goals. Wait for required CI, merge through the repository's normal flow, update local `main` with fast-forward-only operations, remove only the merged C2 worktree/local branch, and verify:

```text
HEAD = origin/main
ahead/behind = 0/0
working tree clean
```

The final Chinese report includes Git, CodeGraph, UI -> IPC -> Exporter -> File flow, security, test counts, CI Run/Job/commit/conclusion, actual prompt adjustments, cleanup, and explicit confirmation that no Code Generation, Workspace Export, schema migration, or execution-engine change was added.
