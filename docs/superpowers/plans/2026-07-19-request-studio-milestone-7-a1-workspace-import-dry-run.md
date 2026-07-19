# Workspace Import Dry-Run Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe, deterministic, dry-run-only Workspace version 1 import analyzer without database, Main, IPC, Preload, UI, or filesystem capabilities.

**Architecture:** One shared module composes the existing `WorkspaceExportV1` and `RequestAssetV1` schemas with an untrusted-text parser, import-specific semantic checks, a readonly target snapshot, conflict analysis, and a dependency-ordered operation planner. It returns fixed safe errors and metadata-only plans.

**Tech Stack:** TypeScript 6, Zod 4, Vitest 4, existing Request Studio shared asset contracts.

## Global Constraints

- Accept only `request-studio.workspace` version `1`.
- Limit UTF-8 source to 16 MiB and JSON nesting depth to 64.
- Reuse existing limits: 1,000 Collections, 10,000 Requests, 100 Environments, 1,000 Variables per Environment, and 1,000,000 serialized characters per Request.
- Variable keys match `/^[A-Za-z_][A-Za-z0-9_]{0,99}$/`; non-empty secret slots are rejected.
- No database/Repository change, migration, IPC, Preload, UI, file/network access, randomness, or clock.
- Conflict strategies are modeled only.
- Preserve the B2.3 worktree and branch unchanged.

---

### Task 1: Safe parser and semantic contract

**Files:**
- Create: `src/shared/assets/workspace-import.ts`
- Create: `src/shared/assets/workspace-import.test.ts`

**Interfaces:**
- Consumes: `workspaceExportV1Schema` and `WorkspaceExportV1`.
- Produces: `WORKSPACE_IMPORT_LIMITS`, `WorkspaceImportError`, `WorkspaceImportParseResult`, and `parseWorkspaceImportSource(source: unknown)`.

- [ ] **Step 1: Write the failing parser matrix**

```ts
it.each([
  [null, 'INVALID_SOURCE_TYPE'],
  ['', 'EMPTY_SOURCE'],
  ['{', 'INVALID_JSON'],
  ['null', 'INVALID_ROOT'],
  ['[]', 'INVALID_ROOT'],
  [JSON.stringify({ ...validBundle(), extra: true }), 'INVALID_BUNDLE'],
  [JSON.stringify({ ...validBundle(), format: 'other' }), 'UNSUPPORTED_FORMAT'],
  [JSON.stringify({ ...validBundle(), version: 2 }), 'UNSUPPORTED_VERSION'],
])('returns a fixed safe error', (source, code) => {
  expect(parseWorkspaceImportSource(source)).toMatchObject({ ok: false, error: { code } })
})
```

Add explicit tests for source overflow, depth 65, all three dangerous keys, every collection/request/environment/variable bound, oversized Request, duplicate/missing Collection refs, invalid RequestAsset, invalid/duplicate variable keys, and non-empty secret slots.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/shared/assets/workspace-import.test.ts
```

Expected: FAIL because the new module does not exist.

- [ ] **Step 3: Implement the minimum parser**

```ts
export const WORKSPACE_IMPORT_LIMITS = {
  maxSourceBytes: 16 * 1024 * 1024,
  maxDepth: 64,
} as const

export type WorkspaceImportParseResult =
  | Readonly<{ ok: true; bundle: WorkspaceExportV1 }>
  | Readonly<{ ok: false; error: WorkspaceImportError }>

export function parseWorkspaceImportSource(source: unknown): WorkspaceImportParseResult
```

Use `TextEncoder`, `JSON.parse`, an iterative `{ value, depth }[]` stack, dangerous-key rejection, format/version checks, `workspaceExportV1Schema.safeParse`, fixed Zod issue mapping, and the variable semantic loop. Returned errors contain only a fixed code/message.

- [ ] **Step 4: Run GREEN and commit**

```bash
npx vitest run src/shared/assets/workspace-import.test.ts
git add src/shared/assets/workspace-import.ts src/shared/assets/workspace-import.test.ts
git commit -m "feat: add workspace import parser contract"
```

---

### Task 2: Deterministic conflict analyzer and operation planner

**Files:**
- Modify: `src/shared/assets/workspace-import.ts`
- Modify: `src/shared/assets/workspace-import.test.ts`

**Interfaces:**
- Consumes: validated `WorkspaceExportV1` plus readonly create/merge analysis.
- Produces: target snapshot, conflict, warning, operation, dry-run contracts and `createWorkspaceImportDryRun(bundle, analysis)`.

- [ ] **Step 1: Write failing create/merge tests**

```ts
it('orders operations and stays deterministic', () => {
  const bundle = parsed(validBundle())
  const analysis = { mode: 'create-workspace', existingWorkspaceNames: [] } as const
  const first = createWorkspaceImportDryRun(bundle, analysis)
  expect(first).toEqual(createWorkspaceImportDryRun(bundle, analysis))
  expect(first.ok && first.dryRun.operations.map(({ kind }) => kind)).toEqual([
    'create-workspace', 'create-collection', 'create-environment',
    'create-variable', 'create-request',
  ])
})

it('reports merge conflicts without applying strategies', () => {
  const result = createWorkspaceImportDryRun(parsed(validBundle()), {
    mode: 'merge-into-workspace',
    target: {
      workspaceName: 'Existing',
      collections: [{ name: 'api', requests: ['Users'] }],
      environments: [{ name: 'LOCAL', variables: ['TOKEN'] }],
    },
  })
  expect(result.ok && result.dryRun.conflicts.map(({ code }))).toEqual([
    'COLLECTION_NAME_CONFLICT', 'ENVIRONMENT_NAME_CONFLICT',
    'VARIABLE_NAME_CONFLICT', 'REQUEST_NAME_CONFLICT',
  ])
})
```

Also cover Workspace conflict propagation, omitted/null merge target, simultaneous conflicts, exact strategy lists, stable sorting, parent blocking, counts, input immutability, credential/path/database-ID exclusion, and repeated-call equality.

- [ ] **Step 2: Run RED**

```bash
npx vitest run src/shared/assets/workspace-import.test.ts
```

Expected: FAIL because planner exports do not exist.

- [ ] **Step 3: Implement the pure planner**

```ts
const strategies = {
  WORKSPACE_NAME_CONFLICT: ['skip', 'rename'],
  COLLECTION_NAME_CONFLICT: ['skip', 'rename', 'merge'],
  REQUEST_NAME_CONFLICT: ['skip', 'rename', 'replace'],
  ENVIRONMENT_NAME_CONFLICT: ['skip', 'rename', 'merge'],
  VARIABLE_NAME_CONFLICT: ['skip', 'rename', 'replace'],
} as const

export function createWorkspaceImportDryRun(
  bundle: WorkspaceExportV1,
  analysis: WorkspaceImportAnalysis | unknown,
): WorkspaceImportDryRunResult
```

Generate plan-local refs from array positions, sanitize display names with `sanitizeTextForOutput`, compare names with `trim().toLowerCase()`, and sort conflicts/operations by fixed dependency ranks. A parent conflict blocks its descendants. Warnings remain empty for supported v1.

- [ ] **Step 4: Run focused validation and commit**

```bash
npx vitest run src/shared/assets/workspace-import.test.ts
npm run lint
npm run typecheck
git add src/shared/assets/workspace-import.ts src/shared/assets/workspace-import.test.ts
git commit -m "feat: add workspace import dry-run planner"
```

---

### Task 3: Boundary audit and delivery report

**Files:**
- Create: `docs/superpowers/reports/2026-07-19-request-studio-milestone-7-a1-workspace-import-dry-run-report.md`

**Interfaces:**
- Consumes: final diff, CodeGraph, tests, review, PR/CI and cleanup evidence.
- Produces: the required Chinese closure report.

- [ ] **Step 1: Prove the boundary**

```bash
git diff --name-only main...HEAD
rg -n "workspace-import" src/main src/preload src/renderer
git diff main...HEAD -- src/main src/preload src/renderer src/main/database
```

Expected: no Main, Preload, Renderer, database, migration, dialog, or write-path change.

- [ ] **Step 2: Refresh and trace CodeGraph**

```bash
codegraph update
codegraph status
codegraph explore "parseWorkspaceImportSource createWorkspaceImportDryRun WorkspaceExportV1 RequestAssetV1 sanitizer call paths and blast radius"
```

- [ ] **Step 3: Write and commit the report draft**

Record conclusion, Git, CodeGraph, limits, semantic checks, dry-run architecture, conflicts, security, tests, the exact local evidence available before remote delivery, explicit non-goals, prompt differences, cleanup plan, and final-state target. Add remote CI evidence only after GitHub returns it.

```bash
git add docs/superpowers/reports/2026-07-19-request-studio-milestone-7-a1-workspace-import-dry-run-report.md
git commit -m "docs: report workspace import dry-run foundation"
```

---

### Task 4: Verification, independent review, and remote closure

**Files:**
- Modify only the shared module/test/report if a concrete defect or final remote evidence requires it.

- [ ] **Step 1: Run the full local matrix**

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:all
npm run smoke:database
npm run smoke:media
npm run smoke:streaming
npm run smoke:assets
npm run smoke:electron
npm test -- src/main/database/database.test.ts
git diff --check
```

- [ ] **Step 2: Independently review security and scope**

Review prototype pollution, depth/size bounds, duplicate refs, secret slots, ID leakage, ordering, dependency blocking, target scope, fixed errors/logging, input mutation, and absence of writes. Fix only verified defects and add one regression test per defect.

- [ ] **Step 3: Push, PR, required CI, squash merge**

```bash
git push -u origin codex/milestone-7-a1-workspace-import-dry-run
```

Create `Milestone 7 Phase A1 — Workspace Import Dry-Run Foundation`, wait for every Windows check, squash merge, fast-forward local main, and wait for final main CI.

- [ ] **Step 4: Final evidence and cleanup**

Record Run/Job IDs, SHAs, durations, conclusions, and final Git state. Use a docs-only PR only if final remote evidence must enter the report. Delete only the merged A1 worktree/local/remote branch; preserve B2.3. Finish at `HEAD = origin/main`, 0/0, clean, main CI success.
