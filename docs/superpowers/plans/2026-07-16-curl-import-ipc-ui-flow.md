# cURL Import IPC & UI Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user safely preview and import one cURL command into an existing Collection through the English desktop UI.

**Architecture:** A dedicated Main IPC module validates calls, owns the latest sanitized preview behind a one-time random identifier, and reuses `previewCurlImport`, `mapCurlImportSave`, and `Repository.importCurl`. A focused Renderer modal uses only the Preload whitelist; its raw paste field is uncontrolled and cleared after preview.

**Tech Stack:** Electron 43, React 19, TypeScript 6, Zod 4, Vitest, Testing Library, better-sqlite3.

## Global Constraints

- UI text is English.
- Main Process exclusively owns parsing, mapping, persistence, database access, and network access.
- Raw credentials must not appear in preview output, React state, errors, logs, or test output.
- Sensitive variable names match `[A-Za-z_][A-Za-z0-9_]*` with a 100-character maximum.
- Reuse Schema v5 and existing B1/B2.1/B2.2 code; add no migration or dependency.
- Do not implement Export, Code Generation, Workspace Import, OpenAPI, GraphQL, or execution-engine changes.

---

### Task 1: Main-Owned cURL Import IPC

**Files:**
- Create: `src/main/ipc/curl-import-handlers.ts`
- Test: `src/main/ipc/curl-import-handlers.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `previewCurlImport(source, dialect)`, `mapCurlImportSave(input)`, `Repository.importCurl(plan)`.
- Produces: `registerCurlImportHandlers(repo: Repository): void`, IPC channels `curl-import:preview` and `curl-import:save`, and Preload methods `curlImport.preview(input)` and `curlImport.save(input)`.

- [ ] **Step 1: Write failing IPC tests**

Create a real in-memory database and register handlers through the existing mocked `ipcMain.handle` pattern. The tests must assert:

```ts
const preview = await handlers.get('curl-import:preview')!(null, {
  source: "curl -H 'Authorization: Bearer fixture-secret-value' https://example.test/items",
  dialect: 'auto',
}) as any
expect(preview.ok).toBe(true)
expect(preview.data.previewId).toMatch(/^[0-9a-f-]{36}$/)
expect(JSON.stringify(preview)).not.toContain('fixture-secret-value')

const saved = await handlers.get('curl-import:save')!(null, {
  previewId: preview.data.previewId,
  workspaceId: 'w',
  collectionId: 'c',
  environmentId: 'e',
  name: 'Imported request',
  variableMappings: [{ placeholder: '{{BEARER_TOKEN}}', variableName: 'API_TOKEN' }],
}) as any
expect(saved.ok).toBe(true)
expect(saved.data.request.name).toBe('Imported request')
expect(repo.list('environment_variables', 'environment_id', 'e')).toMatchObject([
  { key: 'API_TOKEN', value: '', is_secret: 1 },
])
```

Add cases for malformed input, unknown `previewId`, reuse after success, collection/workspace mismatch, environment/workspace mismatch, parser rejection, and captured `console.error`/serialized errors not containing the credential fixture.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run src/main/ipc/curl-import-handlers.test.ts`

Expected: FAIL because `curl-import-handlers.ts` does not exist.

- [ ] **Step 3: Implement the minimal Main handler**

Use strict Zod schemas in the handler module:

```ts
const previewInputSchema = z.object({
  source: z.string().min(1),
  dialect: z.enum(['auto', 'posix', 'powershell', 'cmd']),
}).strict()

const saveInputSchema = z.object({
  previewId: z.uuid(),
  workspaceId: z.string().min(1),
  collectionId: z.string().min(1),
  environmentId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(100),
  variableMappings: z.array(z.object({
    placeholder: z.string().min(1),
    variableName: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/),
  }).strict()),
}).strict()
```

Keep one closure variable only:

```ts
let latest: { id: string; preview: CurlImportPreview } | undefined
```

On preview success, replace `latest` with `{ id: randomUUID(), preview: result.preview }` and return `{ ok: true, data: { previewId: latest.id, preview: latest.preview } }`. On parser failure, return its first already-sanitized issue as a validation result.

On save, require `latest?.id === input.previewId`, map the stored preview, call `repo.importCurl`, clear `latest` only after success, and return the created request and variables. Validation, stale preview, and caught mapping/repository failures return fixed messages without exception details.

Register the module using one shared Repository instance in `src/main/index.ts`:

```ts
const repo = new Repository(db)
registerIpc(repo)
registerCurlImportHandlers(repo)
```

Expose only:

```ts
curlImport: {
  preview: (input: unknown) => invoke('curl-import:preview', input),
  save: (input: unknown) => invoke('curl-import:save', input),
},
```

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npx vitest run src/main/ipc/curl-import-handlers.test.ts src/shared/curl/curl-import-preview.test.ts src/shared/curl/curl-import-save.test.ts src/main/repository.test.ts`

Expected: all focused tests PASS.

Run: `npm run typecheck`

Expected: both TypeScript projects PASS.

- [ ] **Step 5: Commit the IPC boundary**

```bash
git add src/main/ipc/curl-import-handlers.ts src/main/ipc/curl-import-handlers.test.ts src/main/index.ts src/preload/index.ts
git commit -m "feat: expose safe curl import ipc"
```

### Task 2: Focused Import Modal

**Files:**
- Create: `src/renderer/CurlImportPanel.tsx`
- Test: `src/renderer/CurlImportPanel.test.tsx`

**Interfaces:**
- Consumes: `window.requestStudio.curlImport.preview`, `window.requestStudio.curlImport.save`, `window.requestStudio.environments.list`, current workspace and collections.
- Produces: `CurlImportPanel({ workspaceId, collections, onClose, onImported })` where `onImported(request)` receives the saved request row.

- [ ] **Step 1: Write failing component tests**

Render the panel with a workspace and one Collection. Use a known credential only as the simulated textarea value, then assert the safe response:

```ts
fireEvent.change(screen.getByLabelText('cURL command'), {
  target: { value: "curl -H 'Authorization: Bearer fixture-secret-value' https://example.test" },
})
fireEvent.click(screen.getByRole('button', { name: 'Parse Preview' }))
await screen.findByText('GET')
expect(screen.queryByText(/fixture-secret-value/)).not.toBeInTheDocument()
expect(screen.getByLabelText('cURL command')).toHaveValue('')
```

Cover sanitized method/URL/header/body, warning display, mapping default, invalid mapping disabling Import, environment requirement, destination selection, save payload, `onImported`, close, and safe preview/save errors.

- [ ] **Step 2: Run the component test and verify RED**

Run: `npx vitest run src/renderer/CurlImportPanel.test.tsx`

Expected: FAIL because `CurlImportPanel.tsx` does not exist.

- [ ] **Step 3: Implement the minimal modal**

Use `useRef<HTMLTextAreaElement>(null)` for raw source and React state only for sanitized preview data, identifiers, selection, mappings, busy state, and safe error text. On successful preview:

```ts
const result = await window.requestStudio.curlImport.preview({
  source: sourceRef.current?.value ?? '',
  dialect,
})
if (result.ok) {
  if (sourceRef.current) sourceRef.current.value = ''
  setPreviewState(result.data)
  setMappings(result.data.preview.sensitiveMappings.map((item: any) => ({
    placeholder: item.placeholder,
    variableName: item.suggestedVariable,
  })))
} else setError(result.error.message)
```

Load environments on mount/open with `environments.list(workspaceId)`. Render native labels, textarea, select elements, a warning list, a request summary, sensitive mapping inputs, and Import/Close buttons. Validate mappings with `/^[A-Za-z_][A-Za-z0-9_]{0,99}$/`, uniqueness, Collection selection, and Environment selection when mappings exist.

Save exactly:

```ts
const result = await window.requestStudio.curlImport.save({
  previewId,
  workspaceId,
  collectionId,
  environmentId: mappings.length ? environmentId : undefined,
  name,
  variableMappings: mappings,
})
```

Call `onImported(result.data.request)` only on success. Do not log input or errors.

- [ ] **Step 4: Run focused component tests**

Run: `npx vitest run src/renderer/CurlImportPanel.test.tsx`

Expected: all component tests PASS.

- [ ] **Step 5: Commit the modal**

```bash
git add src/renderer/CurlImportPanel.tsx src/renderer/CurlImportPanel.test.tsx
git commit -m "feat: add curl import modal"
```

### Task 3: Tools Integration and Final Verification

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`
- Modify: `src/renderer/styles.css`

**Interfaces:**
- Consumes: `CurlImportPanel` from Task 2.
- Produces: the visible `Tools -> Import cURL...` entry and post-import request selection.

- [ ] **Step 1: Write the failing App integration test**

Extend the existing App mock with `curlImport`, `environments`, and a second `savedRequests.list` result. Assert that opening Tools reveals the action, clicking it renders the modal, and the action is disabled when no workspace exists.

```ts
fireEvent.click(await screen.findByRole('button', { name: 'Tools' }))
fireEvent.click(screen.getByRole('button', { name: 'Import cURL...' }))
expect(screen.getByRole('heading', { name: 'Import cURL' })).toBeInTheDocument()
```

- [ ] **Step 2: Run App tests and verify RED**

Run: `npx vitest run src/renderer/App.test.tsx`

Expected: FAIL because the Tools entry is absent.

- [ ] **Step 3: Mount the panel with native UI**

Add one `showCurlImport` boolean state. Render a header Tools button plus a small conditional menu containing `Import cURL...`; close the menu when the action opens the modal. On import:

```ts
onImported={async (request) => {
  await loadWorkspace()
  setSelected(request)
  setSelectedExperimentId('')
  setShowCurlImport(false)
}}
```

Extend existing CSS with only menu positioning, a wider `.curl-import` modal, compact summary rows, and scrollable sanitized preview blocks. Preserve focus-visible outlines and labeled controls.

- [ ] **Step 4: Run Renderer and security regression tests**

Run: `npx vitest run src/renderer/App.test.tsx src/renderer/CurlImportPanel.test.tsx src/renderer/EnvironmentPanel.test.tsx`

Expected: all focused Renderer tests PASS and no credential fixture appears in test output.

- [ ] **Step 5: Run the complete required validation matrix**

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

Expected: every command exits 0. Electron smoke may require the established Windows MSBuild/FileTracker permission recovery; do not modify code to bypass it.

- [ ] **Step 6: Commit the integration**

```bash
git add src/renderer/App.tsx src/renderer/App.test.tsx src/renderer/styles.css
git commit -m "feat: add curl import ui flow"
```

- [ ] **Step 7: Verify delivery state**

```bash
git status --short --branch
git diff --check main...HEAD
git log --oneline --decorate -5
```

Expected: feature worktree clean, branch ahead of Main only by the planned B2.3 commits, and no unrelated files changed.
