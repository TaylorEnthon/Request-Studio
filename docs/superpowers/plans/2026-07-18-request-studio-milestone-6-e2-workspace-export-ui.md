# Workspace Export UI Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe Tools workflow that previews and atomically saves an E1 `WorkspaceExportV1` bundle.

**Architecture:** A dedicated sender-scoped Main IPC handler calls the existing Repository mapper and chunk serializer. Preload exposes only preview/save methods; the Renderer displays bounded sanitized metadata and sends only a preview capability back to Main for saving.

**Tech Stack:** Electron, React, TypeScript, Zod, Vitest, Testing Library, Node.js `fs/promises`.

## Global Constraints

- Reuse E1 `mapWorkspaceExportV1()` and `serializeWorkspaceExportV1Chunks()`.
- Renderer must not access database, filesystem, destination paths, or bundle generation.
- No workspace import, cloud sync, collaboration, schema change, history/experiment/resource export, or execution-engine change.
- Preserve placeholders and empty secret slots; never expose raw credentials, database IDs, or local paths.
- Add no dependency.

---

### Task 1: Iterable Atomic Export Writer

**Files:**
- Modify: `src/main/export/request-export-file.ts`
- Modify: `src/main/export/request-export-file.test.ts`

**Interfaces:**
- Consumes: `string | Iterable<string>` content.
- Produces: `writeExportFileAtomic(destination, content, userData): Promise<void>` with unchanged destination restriction and atomic rename.

- [ ] **Step 1: Write the failing iterable test**

```ts
await writeExportFileAtomic(destination, ['{"a":', '1}\n'], userData)
expect(readFileSync(destination, 'utf8')).toBe('{"a":1}\n')
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/main/export/request-export-file.test.ts`
Expected: typecheck/test setup shows iterable content is unsupported by the current signature.

- [ ] **Step 3: Use the native Node writer**

Change the content type to `string | Iterable<string>` and pass it to the installed Node runtime's `writeFile()` overload. Keep `wx`, sibling temporary path, cleanup, restriction, and rename unchanged.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/main/export/request-export-file.test.ts && npm run typecheck`
Expected: all file-safety tests pass.

---

### Task 2: Workspace Export IPC Boundary

**Files:**
- Create: `src/main/ipc/workspace-export-handlers.ts`
- Create: `src/main/ipc/workspace-export-handlers.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `Repository.getWorkspaceExportSource(workspaceId)`, `mapWorkspaceExportV1(source)`, `serializeWorkspaceExportV1Chunks(bundle)`.
- Produces: `registerWorkspaceExportHandlers(repo, userData)`, channels `workspace-export:preview` and `workspace-export:save`.

- [ ] **Step 1: Write failing IPC tests**

Cover:

```ts
expect(await preview({ workspaceId: 'workspace-a' })).toMatchObject({
  ok: true,
  data: {
    preview: {
      format: 'request-studio.workspace',
      version: 1,
      workspaceName: 'Workspace A',
      counts: { collections: 1, requests: 1, environments: 1 },
    },
  },
})
```

Also assert missing/invalid workspace, workspace isolation, raw-secret/path/ID absence, cross-sender preview rejection, cancellation retention, concurrent save rejection, exact saved JSON, and fixed write failures.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/main/ipc/workspace-export-handlers.test.ts`
Expected: FAIL because the handler module/channels do not exist.

- [ ] **Step 3: Implement the minimal handler**

Use strict Zod inputs, a sender-keyed `WeakMap`, `randomUUID()`, a 32 KiB preview assembled from serializer chunks, and fixed public errors. Save with:

```ts
await writeExportFileAtomic(
  result.filePath,
  serializeWorkspaceExportV1Chunks(latest.bundle),
  userData,
)
```

Register the handler in Main and expose only:

```ts
workspaceExport: {
  preview: (input: unknown) => invoke('workspace-export:preview', input),
  save: (previewId: string) => invoke('workspace-export:save', { previewId }),
}
```

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/main/ipc/workspace-export-handlers.test.ts src/main/export/request-export-file.test.ts && npm run typecheck`
Expected: all targeted tests pass.

---

### Task 3: Workspace Export Panel and Tools Entry

**Files:**
- Create: `src/renderer/WorkspaceExportPanel.tsx`
- Create: `src/renderer/WorkspaceExportPanel.test.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`
- Modify: `src/renderer/styles.css`

**Interfaces:**
- Consumes: `window.requestStudio.workspaceExport.preview({ workspaceId })` and `.save(previewId)`.
- Produces: English `Export Workspace` dialog opened by `Tools > Export Workspace...`.

- [ ] **Step 1: Write failing panel and App tests**

Assert workspace selection, Generate Preview call, workspace/count metadata, warnings, preview content, Save File call, canceled/saved status, Escape/Close behavior, stale preview clearing, and the Tools menu entry.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/renderer/WorkspaceExportPanel.test.tsx src/renderer/App.test.tsx`
Expected: FAIL because the component and Tools entry do not exist.

- [ ] **Step 3: Implement the panel by reusing Request Export patterns**

Add only one new `showWorkspaceExport` state in App. Pass `workspaces`, the selected workspace ID, and `onClose`. Render three count cards, warnings, bounded `<pre aria-label="Workspace export preview">`, and Save File. Keep destination paths entirely absent from component state and markup.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/renderer/WorkspaceExportPanel.test.tsx src/renderer/App.test.tsx`
Expected: all targeted UI tests pass.

---

### Task 4: Final Verification and Delivery

**Files:**
- Verify all files above and both E2 documents.

- [ ] **Step 1: Refresh CodeGraph and review scope**

Run: `codegraph status` and explore the workspace export call chain. Confirm no renderer filesystem/database edge and no excluded-table query.

- [ ] **Step 2: Run full validation**

Run: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:all`, all four smoke commands, and `git diff --check`.
Expected: zero failures.

- [ ] **Step 3: Request independent review**

Review security, sender isolation, atomic cleanup, preview bounds, scope exclusions, and UI accessibility. Fix every Critical/Important finding with a failing test first.

- [ ] **Step 4: Commit and deliver**

Create a focused feature commit, push without force, open a ready PR, wait for required CI, squash merge, verify main CI, synchronize local main, then remove only the E2 worktree and merged branch.
