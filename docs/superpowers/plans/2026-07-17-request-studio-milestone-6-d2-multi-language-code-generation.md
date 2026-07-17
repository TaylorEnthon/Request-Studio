# Multi-language Code Generation Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic TypeScript Axios, SSE Fetch, and browser WebSocket adapters and expose their capabilities dynamically in the existing UI.

**Architecture:** Keep one shared adapter registry. Sanitize every asset before an exact protocol capability check, build a small protocol model, and invoke a pure adapter. Main exposes registry metadata through a read-only IPC so Renderer filters compatible languages without importing generator code.

**Tech Stack:** Electron, React, TypeScript, Zod, Vitest, Testing Library

## Global Constraints

- No AI, template engine, code execution, project generation, file writing, dependency installation, database/schema change, request execution change, or cloud synchronization.
- Adapters must not access databases, environment values, filesystems, networks, Electron, or execution services.
- Preserve placeholders and never expose raw secrets, resolved environment values, local paths, database IDs, or runtime metadata.
- Browser WebSocket custom headers and header-based authentication must be omitted with fixed warnings, never approximated.

---

### Task 1: Protocol Models and Adapters

**Files:**
- Modify: `src/shared/codegen/code-generation.ts`
- Create: `src/shared/codegen/typescript-axios-generator.ts`
- Create: `src/shared/codegen/typescript-axios-generator.test.ts`
- Create: `src/shared/codegen/sse-fetch-generator.ts`
- Create: `src/shared/codegen/sse-fetch-generator.test.ts`
- Create: `src/shared/codegen/websocket-browser-generator.ts`
- Create: `src/shared/codegen/websocket-browser-generator.test.ts`
- Modify: `src/shared/codegen/code-generation.test.ts`

**Interfaces:**
- Consumes: `RequestAssetV1`, `sanitizeRequestAssetForOutput()`, existing query/auth/body normalization.
- Produces: languages `typescript-axios`, `sse-fetch`, `browser-websocket`; `SseCodeGenerationModel`; `WebSocketCodeGenerationModel`; exact adapter capabilities.

- [ ] **Step 1: Write failing adapter and contract tests**

Assert Axios GET/JSON POST/headers, SSE GET/POST/body/reader loop, WebSocket URL/subprotocol/header warning, exact capability metadata, unsupported combinations, deterministic repeated output, placeholders, and absence of raw secret/path/runtime metadata.

- [ ] **Step 2: Verify RED**

Run `npm test -- src/shared/codegen/code-generation.test.ts src/shared/codegen/typescript-axios-generator.test.ts src/shared/codegen/sse-fetch-generator.test.ts src/shared/codegen/websocket-browser-generator.test.ts` and expect missing modules/languages to fail.

- [ ] **Step 3: Implement the minimum pure generators and registry dispatch**

Reuse `withQuery()` and existing sanitized HTTP model construction. Add only protocol-specific fields needed by emitted code. Return fixed warning objects from models; keep generators as deterministic line-array formatters.

- [ ] **Step 4: Verify GREEN**

Run the Task 1 test command and `npm run typecheck`; expect all focused tests and typecheck to pass.

### Task 2: Capability IPC

**Files:**
- Modify: `src/main/ipc/code-generation-handlers.ts`
- Modify: `src/main/ipc/code-generation-handlers.test.ts`
- Modify: `src/preload/index.ts`

**Interfaces:**
- Consumes: `listCodeGenerators()`.
- Produces: preload `codeGeneration.list()` invoking `code-generation:list`; preview accepts all five exact language identifiers.

- [ ] **Step 1: Write failing IPC tests**

Assert list metadata contains all five adapters, preview accepts each compatible new adapter, invalid languages remain `INVALID_INPUT`, and responses contain no request data or secrets.

- [ ] **Step 2: Verify RED**

Run `npm test -- src/main/ipc/code-generation-handlers.test.ts`; expect the list channel and new language validation to fail.

- [ ] **Step 3: Add one read-only handler and expand the strict enum**

Register `code-generation:list` to return `{ ok: true, data: listCodeGenerators() }`; expose only `list()` in preload alongside the existing preview call.

- [ ] **Step 4: Verify GREEN**

Run `npm test -- src/main/ipc/code-generation-handlers.test.ts && npm run typecheck`; expect success.

### Task 3: Dynamic Language UI

**Files:**
- Modify: `src/renderer/CodeGenerationPanel.tsx`
- Modify: `src/renderer/CodeGenerationPanel.test.tsx`

**Interfaces:**
- Consumes: `window.requestStudio.codeGeneration.list()` capability metadata and existing preview IPC.
- Produces: protocol-filtered language selector, safe loading/error behavior, new preview and warning rendering.

- [ ] **Step 1: Write failing UI tests**

Assert capability loading, HTTP/SSE/WebSocket filtering, automatic valid selection, new previews, fixed warnings, and stale output clearing when requests or capabilities change.

- [ ] **Step 2: Verify RED**

Run `npm test -- src/renderer/CodeGenerationPanel.test.tsx`; expect the missing list call and hard-coded options to fail.

- [ ] **Step 3: Replace the hard-coded options with returned metadata**

Load once on mount, filter `supportedProtocols` by the selected request, select the first compatible language when needed, disable Generate until a compatible language exists, and keep existing preview/copy behavior unchanged.

- [ ] **Step 4: Verify GREEN**

Run `npm test -- src/renderer/CodeGenerationPanel.test.tsx src/renderer/App.test.tsx && npm run typecheck`; expect success.

### Task 4: Delivery Verification

**Files:**
- Verify all D2 files only.

**Interfaces:**
- Produces: validated D2 branch, PR, merged main, successful main CI, and clean worktree cleanup.

- [ ] **Step 1: Run focused security and deterministic tests**

Run all codegen, IPC, and UI tests; inspect generated output for prohibited values.

- [ ] **Step 2: Run the full validation matrix**

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:all`, all four smoke commands, and `git diff --check`.

- [ ] **Step 3: Review scope and CodeGraph impact**

Refresh CodeGraph, trace UI → preload → Main → registry → adapter, and confirm no database, execution, AI, file-output, or dependency changes.

- [ ] **Step 4: Commit and close remotely**

Commit `feat: expand code generation adapters`, push normally, create a PR, wait for required CI, merge through the repository workflow, verify main CI, synchronize local main, then remove only the merged D2 worktree and local branch.
