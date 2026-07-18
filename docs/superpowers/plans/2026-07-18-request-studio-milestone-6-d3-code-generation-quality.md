# Request Studio Milestone 6 Phase D3 Code Generation Quality Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce deterministic, production-friendly HTTP, SSE, and browser WebSocket snippets without weakening Request Studio's sanitizer boundary.

**Architecture:** Keep the existing protocol-discriminated code-generation model between sanitized assets and adapters. Add codegen-local structured warnings, normalize JSON once in the model builder, and keep every adapter pure.

**Tech Stack:** TypeScript, React, Vitest, Electron IPC contracts, existing code-generation registry.

## Global Constraints

- Do not add languages, AI generation, a template engine, code execution, file/project generation, schema changes, network execution, or target dependency installation.
- Renderer code must not access generators, Node APIs, the database, filesystem, environment secrets, or network directly.
- Generated text must not expose secrets, local paths, database IDs, or runtime metadata.
- Every behavioral change follows RED, GREEN, then refactor.

---

### Task 1: Structured code-generation diagnostics and normalized JSON

**Files:**
- Modify: `src/shared/codegen/code-generation.ts`
- Modify: `src/renderer/CodeGenerationPanel.tsx`
- Modify: `src/renderer/CodeGenerationPanel.test.tsx`
- Test: `src/shared/codegen/code-generation.test.ts`

**Interfaces:**
- Produces: `CodeGenerationWarning` with `code`, `severity`, and `message`.
- Produces: HTTP-like body content normalized as parsed JSON after asset validation.

- [ ] Write failing model and UI tests asserting warning severity, JSON normalization, and unchanged redaction.
- [ ] Run `npm test -- src/shared/codegen/code-generation.test.ts src/renderer/CodeGenerationPanel.test.tsx --run` and confirm failures concern the missing contract.
- [ ] Add the codegen-local warning type, warning helper, JSON body representation, and severity-aware UI rendering.
- [ ] Re-run the focused tests and confirm they pass.
- [ ] Run `npm run typecheck` and fix only contract fallout within the listed files.

### Task 2: Production-friendly HTTP adapters

**Files:**
- Modify: `src/shared/codegen/javascript-fetch-generator.ts`
- Modify: `src/shared/codegen/python-requests-generator.ts`
- Modify: `src/shared/codegen/typescript-axios-generator.ts`
- Test: their adjacent `*.test.ts` files
- Create: `src/shared/codegen/code-generation-matrix.test.ts`

**Interfaces:**
- Consumes: normalized `HttpCodeGenerationModel`.
- Produces: async Fetch with status checking, Python JSON/text handling with status checking, and typed Axios JSON/text output.

- [ ] Write failing tests for GET, JSON POST, text POST, Bearer, Basic, API-key header/query, and deterministic repeat generation.
- [ ] Run the four focused test files and confirm expected output failures.
- [ ] Implement JSON-native output and HTTP error handling in the three adapters without executing code.
- [ ] Re-run focused tests and confirm all matrix cases pass.
- [ ] Refactor shared formatting only when it reduces duplication without changing output.

### Task 3: Robust SSE and browser WebSocket snippets

**Files:**
- Modify: `src/shared/codegen/sse-fetch-generator.ts`
- Modify: `src/shared/codegen/websocket-browser-generator.ts`
- Test: `src/shared/codegen/sse-fetch-generator.test.ts`
- Test: `src/shared/codegen/websocket-browser-generator.test.ts`
- Test: `src/shared/codegen/code-generation-matrix.test.ts`

**Interfaces:**
- Consumes: `SseCodeGenerationModel` and `WebSocketCodeGenerationModel`.
- Produces: cancellable SSE parsing with retry hints and complete browser WebSocket lifecycle handlers.

- [ ] Write failing tests for AbortController, signal wiring, framed event parsing, reconnect hints, and all four WebSocket lifecycle handlers.
- [ ] Run focused tests and confirm the missing generated statements cause failures.
- [ ] Implement the smallest deterministic snippets satisfying the lifecycle behavior.
- [ ] Re-run focused tests and confirm pass.
- [ ] Run the complete generator test directory and confirm no adapter regression.

### Task 4: Security, integration, and delivery verification

**Files:**
- Modify only if a failing security assertion identifies an in-scope defect.

**Interfaces:**
- Verifies: unchanged sanitizer-first IPC/UI flow and exact capability registry.

- [ ] Add or extend matrix assertions proving secrets, paths, database IDs, and runtime metadata do not appear.
- [ ] Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:all`, all four smoke commands, and `git diff --check`.
- [ ] Refresh CodeGraph and inspect the sanitizer/model/adapter/UI call chain.
- [ ] Commit the implementation with `feat: refine generated code quality`.
- [ ] Push normally, create a PR, wait for required CI, merge, verify main CI, synchronize local main, then remove only the D3 worktree and merged D3 branches.
