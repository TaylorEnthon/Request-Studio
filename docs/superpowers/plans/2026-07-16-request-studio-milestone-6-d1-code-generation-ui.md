# Code Generation UI Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users preview and copy sanitized JavaScript Fetch or Python requests code for an owned saved request.

**Architecture:** Renderer opens one modal and calls a single preload-whitelisted preview IPC. Main validates ownership, maps the database row to a request asset, and invokes the existing sanitizer-backed generator; the Renderer copies only returned preview text through the browser Clipboard API.

**Tech Stack:** Electron, React, TypeScript, Zod, Vitest, Testing Library

## Global Constraints

- No AI generation, code execution, file saving, project/workspace generation, template engine, dependency installation, schema change, or request-execution change.
- Renderer must not import code generation, database, filesystem, environment, or Electron Node APIs.
- Preserve deterministic placeholders and never return raw secrets, local paths, database IDs, or runtime metadata in generated output.

---

### Task 1: Main Preview IPC

**Files:**
- Create: `src/main/ipc/code-generation-handlers.ts`
- Create: `src/main/ipc/code-generation-handlers.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `Repository.getSavedRequestForExport(id, workspaceId)`, `mapSavedRequestToAsset(row)`, and `generateCode(asset, language)`.
- Produces: `registerCodeGenerationHandlers(repo)` and preload `codeGeneration.preview(input)` for `{ workspaceId, requestId, language }`.

- [ ] **Step 1: Write failing IPC tests**

Cover both valid languages, invalid language, missing request, workspace mismatch, unsupported protocol, and absence of raw secret/path/IDs in the successful response.

- [ ] **Step 2: Verify RED**

Run `npm test -- src/main/ipc/code-generation-handlers.test.ts`; expect failure because the handler module/channel does not exist.

- [ ] **Step 3: Add the minimal handler and registration**

Use strict Zod input validation, the ownership-aware repository lookup, `mapSavedRequestToAsset`, and `generateCode`. Return fixed `INVALID_INPUT`, `REQUEST_NOT_FOUND`, and `GENERATION_FAILED` errors. Register the handler in Main and expose only `preview` in preload.

- [ ] **Step 4: Verify GREEN**

Run `npm test -- src/main/ipc/code-generation-handlers.test.ts && npm run typecheck`; expect all tests and typecheck to pass.

### Task 2: Code Generation Panel

**Files:**
- Create: `src/renderer/CodeGenerationPanel.tsx`
- Create: `src/renderer/CodeGenerationPanel.test.tsx`

**Interfaces:**
- Consumes: `window.requestStudio.codeGeneration.preview({ workspaceId, requestId, language })` and `navigator.clipboard.writeText(content)`.
- Produces: `CodeGenerationPanel` with request/language selection, preview, warnings, Copy, status, fixed errors, Escape, and Close.

- [ ] **Step 1: Write failing UI tests**

Cover default request/language, language change, exact preview IPC input, warning/content rendering, copy success, copy failure, stale-preview clearing, and no raw secret/path/ID text.

- [ ] **Step 2: Verify RED**

Run `npm test -- src/renderer/CodeGenerationPanel.test.tsx`; expect failure because the component does not exist.

- [ ] **Step 3: Implement the minimal panel**

Follow `RequestExportPanel` markup and state patterns. Use two fixed language options, render code in `<pre aria-label="Generated code">`, and copy only the current preview content.

- [ ] **Step 4: Verify GREEN**

Run `npm test -- src/renderer/CodeGenerationPanel.test.tsx && npm run typecheck`; expect all tests and typecheck to pass.

### Task 3: Tools Integration and Delivery Verification

**Files:**
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

**Interfaces:**
- Consumes: `CodeGenerationPanel`.
- Produces: `Tools > Generate Code...` and modal lifecycle bound to current workspace/request list.

- [ ] **Step 1: Write the failing App test**

Open Tools, click `Generate Code...`, verify the named dialog opens with the selected request, then close it.

- [ ] **Step 2: Verify RED**

Run `npm test -- src/renderer/App.test.tsx`; expect the menu item to be missing.

- [ ] **Step 3: Add the menu state and panel render**

Add one state flag, one Tools menu button, and one conditional panel render; do not alter request editing or execution.

- [ ] **Step 4: Run focused and full verification**

Run the focused IPC/UI/App tests, then lint, typecheck, test, build, test:all, database/media/streaming/Electron smoke commands, CodeGraph sync/explore, and `git diff --check`.

- [ ] **Step 5: Commit and deliver**

Stage only D1 files, commit `feat: add code generation workflow`, push normally, create a PR, wait for required CI, squash merge through the repository workflow, verify main CI, sync local main, and clean only the D1 worktree/local branch.
