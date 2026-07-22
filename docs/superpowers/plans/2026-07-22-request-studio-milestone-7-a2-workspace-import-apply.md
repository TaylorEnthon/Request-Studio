# Workspace Import Transactional Apply Implementation Plan

**Goal:** Add the minimum safe A2 apply foundation by reusing A1 and the existing Repository.

**Architecture:** One pure shared apply module validates resolutions and maps assets; one existing Repository method performs live analysis and all inserts in a single SQLite transaction.

**Tech Stack:** TypeScript, Zod, better-sqlite3, Vitest, existing WorkspaceExportV1/A1 contracts.

### Task 1: Apply contract and deterministic planner

**Files:**
- Create: `src/shared/assets/workspace-import-apply.ts`
- Create: `src/shared/assets/workspace-import-apply.test.ts`

- [ ] Write failing tests for readonly result shape, rename resolution, unsupported/unknown/blocked resolutions, repeated-call equality, request-row mapping, secret variables, and unsafe paths.
- [ ] Run the focused test and confirm RED.
- [ ] Implement fixed contracts, safe errors, deterministic rename application, final-plan validation, and protocol row mapping by reusing A1 schemas/sanitizers.
- [ ] Run the focused test and confirm GREEN.

### Task 2: Repository transaction

**Files:**
- Modify: `src/main/repository.ts`
- Modify: `src/main/repository.test.ts`

- [ ] Write failing integration tests for clean create, merge rename, sourceRef parent mapping, and rollback on workspace/request/variable failures.
- [ ] Run the focused test and confirm RED.
- [ ] Add one Repository apply method that parses source, builds the live snapshot, resolves/rechecks the dry-run, and inserts every entity in one transaction.
- [ ] Catch database failures and return only the fixed safe error contract.
- [ ] Run focused shared and Repository tests and confirm GREEN.

### Task 3: Review and verification

- [ ] Run CodeGraph update/status and inspect the final call chain/blast radius.
- [ ] Review the diff for security, scope, transaction boundaries, and accidental IPC/UI/schema changes.
- [ ] Run lint, typecheck, unit tests, build, test:all, database/media/streaming/assets/Electron smoke, and `git diff --check`.

### Task 4: Delivery closure

- [ ] Write the required Chinese report under `docs/superpowers/reports/`.
- [ ] Commit, push, open PR, wait for required CI, and squash merge.
- [ ] Verify main CI, synchronize local main, remove only the A2 worktree/local branch, and confirm B2.3 remains unchanged.

