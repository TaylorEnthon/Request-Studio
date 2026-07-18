# Request Studio Milestone 6 Final Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Milestone 6 with one local product smoke, current documentation, Windows CI coverage, and a verified PR/main delivery loop.

**Architecture:** Reuse the existing cURL preview/save mapper, Repository transaction, request export mapper, code-generation adapters, WorkspaceExportV1 mapper/serializer, and atomic writer. The smoke owns only temporary SQLite and filesystem state; production code and schemas remain unchanged.

**Tech Stack:** TypeScript, Node.js 22, better-sqlite3, tsx, Electron, GitHub Actions on windows-latest.

## Global Constraints

- No Milestone 7 features, new dependencies, schema changes, network requests, real credentials, or real userData.
- Never print the credential fixture or source paths.
- Preserve the existing B2.3 worktree because its branch diverges from main.
- Use the repository's PR plus squash-merge workflow; never amend, rebase, reset hard, or force-push.

---

### Task 1: Milestone 6 asset workflow smoke

**Files:**
- Create: `scripts/assets-smoke.ts`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `previewCurlImport`, `mapCurlImportSave`, `Repository.importCurl`, `createRequestExportPreview`, `mapSavedRequestToExportAsset`, `generateCode`, `mapWorkspaceExportV1`, `workspaceExportV1Schema`, `serializeWorkspaceExportV1`, `serializeWorkspaceExportV1Chunks`, and `writeExportFileAtomic`.
- Produces: `npm run smoke:assets`, a zero-network command that exits non-zero on invariant failure.

- [ ] **Step 1: Add only the package script and verify RED**

```json
"smoke:assets": "tsx scripts/assets-smoke.ts"
```

Run: `npm run smoke:assets`
Expected: FAIL because `scripts/assets-smoke.ts` does not exist.

- [ ] **Step 2: Add the minimal smoke implementation**

Use one `try/finally` with a temporary root, temporary SQLite database, a sibling `userData` directory, and output files. Parse a credential-bearing cURL fixture; assert the preview, save plan, saved row, exports, generated code, workspace bundle, errors/warnings, and serialized output exclude the credential and local path fixtures. Assert one empty secret variable, deterministic code/bundle output, stable collection refs, excluded Milestone 5 tables/metadata, successful atomic writes, and no temporary files.

- [ ] **Step 3: Verify GREEN**

Run: `npm run smoke:assets`
Expected: `Milestone 6 assets smoke passed` and exit 0.

- [ ] **Step 4: Add the CI step**

Add `npm run smoke:assets` after streaming smoke and before Electron smoke. Do not add `continue-on-error` or error suppression.

- [ ] **Step 5: Run focused verification and commit**

Run: `npm run smoke:assets`
Run: `npm run typecheck`
Run: `git diff --check`
Commit: `test: add Milestone 6 asset workflow smoke`

### Task 2: Milestone 6 documentation closure

**Files:**
- Create: `docs/superpowers/reports/2026-07-18-request-studio-milestone-6-assets-report.md`
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/security-boundaries.md`
- Modify: `docs/milestones.md`

**Interfaces:**
- Consumes: the verified main implementation and smoke evidence.
- Produces: an accurate product/support matrix, security limits, and a report with a placeholder Final Main Closure section that is finalized after merge.

- [ ] **Step 1: Correct stale product documentation**

Document the supported import/export/code-generation/workspace-export capabilities and existing Main/Preload/Renderer boundaries. Retain all known limitations, including plaintext SQLite secrets and one-way Workspace export.

- [ ] **Step 2: Add the complete Milestone 6 report**

Cover every phase, contracts, UI, IPC, security invariants, data/schema impact, performance limits, smoke, tests, CI, files, non-goals, limitations, next-stage recommendation, and Final Main Closure evidence.

- [ ] **Step 3: Validate claims and commit**

Run: `rg -n "OpenAPI|Workspace Import|safeStorage|Browser WebSocket" README.md docs`
Run: `git diff --check`
Commit: `docs: close Request Studio Milestone 6`

### Task 3: Verification and remote closure

**Files:**
- Verify only; no planned production changes.

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: PR CI evidence, squash merge SHA, final main CI evidence, and clean Git state.

- [ ] **Step 1: Run focused Milestone 6 tests**

Run the RequestAsset, cURL, import IPC/UI, request export, code generation, workspace export, file, and assets-smoke tests.

- [ ] **Step 2: Run the complete local matrix**

Run `npm ci`, lint, typecheck, full tests, build, test:all, database/media/streaming/assets/Electron smoke, post-Electron database verification, and `git diff --check`.

- [ ] **Step 3: Review, push, PR, and CI**

Perform an independent diff review, push normally, create a ready PR, wait for every Windows CI step, and squash merge only after success.

- [ ] **Step 4: Sync and close main**

Fast-forward local `main`, wait for the final main CI, update only the report's Final Main Closure if a docs follow-up commit is required, and re-verify `HEAD = origin/main`, `0/0`, clean working tree.

- [ ] **Step 5: Clean safe temporary state**

Remove only this final-closure worktree and its merged local/remote branch. Preserve the diverged B2.3 worktree and branch.
