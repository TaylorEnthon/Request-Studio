# Request Studio Milestone 6 Phase E1 Workspace Export Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, sanitized WorkspaceExportV1 bundle and chunk serializer from the existing SQLite workspace model.

**Architecture:** A read-only repository method returns source rows from the five allowed tables. One shared module maps those rows into a validated V1 contract by reusing the request export sanitizer, then yields deterministic JSON chunks.

**Tech Stack:** TypeScript, Zod, better-sqlite3, Vitest.

## Global Constraints

- No UI, import, cloud sync, collaboration, database migration, history/experiment/resource export, filesystem write, or network access.
- Never export raw database IDs, timestamps, runtime metadata, local paths, or credential values.
- Preserve `{{VARIABLE}}` placeholders in request assets; secret environment slots use empty values.
- Use existing dependencies only.

---

### Task 1: WorkspaceExportV1 contract and pure mapper

**Files:**
- Create: `src/shared/assets/workspace-export.ts`
- Create: `src/shared/assets/workspace-export.test.ts`
- Modify: `src/shared/assets/request-export.ts`

**Interfaces:**
- Consumes: `WorkspaceExportSource` rows and `mapSavedRequestToExportAsset()`.
- Produces: `workspaceExportV1Schema`, `WorkspaceExportV1`, and `mapWorkspaceExportV1(source)`.

- [ ] Write failing tests for a valid bundle, invalid relationships, stable ordering, absence of IDs/timestamps, request secret redaction, empty secret variables, preserved placeholders, and local-path removal.
- [ ] Run `npm test -- --run src/shared/assets/workspace-export.test.ts` and confirm failure because the module is absent.
- [ ] Export the existing text sanitizer through a named alias and implement the minimum V1 schema and mapper.
- [ ] Re-run the focused test and confirm pass.

### Task 2: Chunk serializer and large-workspace behavior

**Files:**
- Modify: `src/shared/assets/workspace-export.ts`
- Modify: `src/shared/assets/workspace-export.test.ts`

**Interfaces:**
- Consumes: `WorkspaceExportV1`.
- Produces: `serializeWorkspaceExportV1Chunks(bundle)` and `serializeWorkspaceExportV1(bundle)`.

- [ ] Write failing tests for byte-identical repeated serialization, parseable chunk output, and 1,000-request serialization without a whole-bundle chunk.
- [ ] Run the focused test and verify the serializer exports are missing.
- [ ] Implement a generator that accepts mapper-validated input and yields fixed object fields plus one array item per chunk.
- [ ] Re-run the focused test and confirm pass.

### Task 3: Read-only SQLite source snapshot

**Files:**
- Modify: `src/main/repository.ts`
- Modify: `src/main/repository.test.ts`

**Interfaces:**
- Consumes: workspace ID and existing SQLite tables.
- Produces: `Repository.getWorkspaceExportSource(workspaceId): WorkspaceExportSource | undefined`.

- [ ] Write a failing repository test containing allowed rows plus history/experiment/resource rows and assert only the five allowed table groups are returned.
- [ ] Run `npm test -- --run src/main/repository.test.ts` and confirm the method is missing.
- [ ] Implement five ordered, parameterized SELECT statements with no mutations.
- [ ] Re-run repository and workspace-export tests and confirm pass.

### Task 4: Verification and delivery

**Files:**
- Modify only when a failing in-scope check identifies a defect.

**Interfaces:**
- Verifies the sanitizer/model/serializer boundary and unchanged runtime behavior.

- [ ] Run lint, typecheck, all tests, build, test:all, database/media/streaming/Electron smoke, and `git diff --check`.
- [ ] Sync CodeGraph and review the final source-to-contract call chain.
- [ ] Commit, push, create a PR, wait for required CI, squash merge, verify main CI, synchronize main, and clean only the E1 branch/worktree.
