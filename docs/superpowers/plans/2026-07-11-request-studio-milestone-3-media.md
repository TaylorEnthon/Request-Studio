# Request Studio Milestone 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe MIME/signature-aware media, PDF, binary and manually extracted Base64 response previews with persistent History assets and Save As.

**Architecture:** JSON/text remain inline; all binary/media are History-owned managed assets addressed by random resource IDs. A secure Electron custom protocol streams registered files with Range support, while small bounded prefix reads use explicit IPC.

**Tech Stack:** Electron, React, TypeScript, Zod, SQLite/better-sqlite3, Node built-ins, Vitest, Testing Library.

## Global Constraints

- Keep `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- No arbitrary path IPC, `file://`, remote fixtures, new media dependency, auto-open or executable response content.
- Limits: response/decoded Base64 50 MiB, Base64 input 70 MiB characters, Hex default 4096 bytes and maximum preview 16 KiB, History 500 rows.
- Preserve plaintext Environment-secret behavior and block rerun of redacted credentials.
- Do not implement WebSocket, SSE, streaming media assembly, Experiment, Compare, import, generation, installer or editing features.

---

### Task 1: Classification contracts

**Files:** Create `src/shared/response/response-contracts.ts`, `src/main/response/file-signatures.ts`, `src/main/response/response-classifier.ts`; test both Main files.

**Interfaces:** Produce `normalizeContentType(value)`, `detectFileSignature(prefix)`, `classifyResponse(declared, prefix)` and descriptor/body unions used by every later task.

- [ ] Write table-driven tests for all required MIME/signature/empty/truncated/conflict cases and run `npm test -- src/main/response` expecting missing-module failures.
- [ ] Implement only the finite magic-byte table, MIME parser and conservative classifier; run the same command expecting pass.
- [ ] Run `npm run typecheck` and commit `feat: classify smart media responses`.

### Task 2: Managed History assets and Range protocol

**Files:** Create `src/main/response/range-request.ts`, `response-asset-store.ts`, `response-resource-registry.ts`, `response-resource-protocol.ts`; modify `src/main/http/http-execution-service.ts`, `src/main/history/history-repository.ts`, `src/main/repository.ts`, `src/main/index.ts`; add focused tests.

**Interfaces:** Produce `parseRange(header,size)`, `ResponseAssetStore.create/historyPath/remove/orphanCleanup`, `ResponseResourceRegistry.register/recover/get/delete`, and `registerResponseResourceProtocol(registry)`.

- [ ] Write failing Range tests for full/open/closed/suffix/invalid/416 and registry tests for recovery, traversal, symlink, deleted ID and cleanup.
- [ ] Change execution to allocate `historyId` first, stream binary/media to its asset directory, persist classification fields using schema v3, and return a descriptor without paths/Base64.
- [ ] Register the secure protocol before app ready; implement disk streams rather than full-file reads; run focused tests and database migration tests.
- [ ] Verify retention/workspace/delete/clear cleanup leaves export and upload fixtures untouched; commit `feat: add secure response resource infrastructure`.

### Task 3: Preview, Base64 and Save IPC

**Files:** Create `src/main/response/base64-inspector.ts`, `base64-extraction-service.ts`, `resource-save-service.ts`, `src/main/ipc/response-resource-handlers.ts`; modify preload and shared schemas; add tests.

**Interfaces:** Expose named `responseResources.descriptor/readPreview/saveAs/inspectBase64/extractBase64`; `readPreview` accepts `{resourceId,offset,length<=16384}` only.

- [ ] Write failing tests for strict Base64/Data URL validation, estimate-before-decode, 50 MiB rejection, MIME conflict, dedup and payload-free errors.
- [ ] Implement extraction into History assets keyed by path+digest and classification reuse; add bounded preview and resource-only Save As with filename sanitation tests.
- [ ] Test preload surface has no generic file/path API and all inputs reject traversal/unknown IDs; commit `feat: add Base64 extraction and safe response export`.

### Task 4: Response workbench UI

**Files:** Replace `src/renderer/HttpResponsePanel.tsx`; create focused files under `src/renderer/features/response/` for Overview, JSON tree, Image, Audio, Video, PDF and Binary; modify styles and History panel; add component tests.

**Interfaces:** Every viewer consumes the same `HttpResponseViewModel`; History selection resolves the same descriptor as a live response.

- [ ] Write failing tests for dynamic tabs, classification warning, each viewer kind, missing/error states, native controls, zoom, loop/rate, bounded Hex and Save As.
- [ ] Implement native media elements, sandboxed PDF iframe, escaped SVG/HTML, metadata events and request-token race protection.
- [ ] Write failing JSON-tree tests for copy value/path and explicit Base64 inspection, then implement bounded expansion and extraction dialog.
- [ ] Test History media reopen and deleted resource fallback; commit `feat: add media and binary response viewers`.

### Task 5: Fixtures, smoke, CI and documentation

**Files:** Extend `src/test/mock-http-server.ts`, `scripts/electron-smoke.mjs`, package scripts and `.github/workflows/ci.yml`; update README and docs; create Milestone 3 report.

**Interfaces:** Add `test:media`; smoke uses only temporary userData and `127.0.0.1` fixtures and restores SQLite ABI.

- [ ] Add tiny original fixtures/endpoints and integration tests for PNG/WAV/PDF/wrong MIME/Range/Base64; run `npm run test:media`.
- [ ] Extend Electron smoke for image/audio/Base64/History resource access with condition-based waits; run it and the post-smoke database test.
- [ ] Document actual formats, protocol, limits, codec/PDF restrictions and exclusions; update CI without `continue-on-error`.
- [ ] Run `npm ci`, lint, typecheck, all tests, build, test:all, database/electron/media smoke and `git diff --check`; commit `test: close smart response media milestone`.

### Task 6: Remote closure

**Files:** No product files unless CI reveals a reproducible defect.

**Interfaces:** Final `main` equals `origin/main`, clean, with successful Windows CI for the exact HEAD.

- [ ] Sync CodeGraph and inspect new classifier → execution → registry → protocol → viewer and History cleanup paths.
- [ ] Review staged files for assets, databases, logs, profiles, `.codegraph`, secrets and scope violations.
- [ ] Push normally, watch the exact GitHub Actions run, minimally fix any real failure with a regression test, then repeat full verification.
- [ ] Record run/job IDs, counts, limits and known GUI/codec restrictions in the Chinese report.
