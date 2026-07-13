# Request Studio Milestone 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Main-owned WebSocket and SSE debugging with bounded live timelines, immutable session History and managed binary resources.

**Architecture:** `ws` owns standard WebSocket transport; built-in fetch plus a pure parser owns SSE. Separate active registries persist into shared streaming session/record tables and publish typed, path-free events through named preload APIs.

**Tech Stack:** Electron 43, Node 22, TypeScript 6, React 19, Zod 4, SQLite/better-sqlite3, ws 8.21, Vitest.

## Global Constraints

- Main-only real WebSocket/SSE networking; keep `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`.
- No certificate bypass, arbitrary IPC/event/path, infinite reconnect/messages/sessions, Base64 binary IPC or auto-open.
- Limits: WS 10 MiB default/50 MiB hard; SSE 1 MiB default/10 MiB hard; live 500; DB 5,000; sessions 200/workspace; inline text 64 KiB.
- Preserve plaintext Environment secret storage and block direct execution of redacted History snapshots.
- Do not implement audio assembly/playback, vendor adapters, scripts, load testing, Experiment, Compare, import/generation, installer or safeStorage.

---

### Task 1: Shared schemas and schema v4

**Files:** Create `src/shared/streaming/streaming-schemas.ts`, `streaming-contracts.ts`, `streaming-constants.ts`; modify database migration/tests and saved-request update handling.

**Interfaces:** Produce `webSocketDraftSchema`, `sseDraftSchema`, defaults, event unions and schema-v4 tables `stream_sessions`, `stream_records`, `stream_message_templates`, `stream_resources`.

- [ ] Write failing schema/migration tests for protocol URL, settings bounds, v3 upgrade, cascade/SET NULL and repeat startup.
- [ ] Implement exact Zod aggregates and transactional migration; run focused tests to green.
- [ ] Add protocol-aware saved request update without changing HTTP behavior; run typecheck.
- [ ] Commit `feat: add streaming contracts and schema v4`.

### Task 2: Shared builders, redaction and History

**Files:** Create `src/main/streaming/stream-request-builder.ts`, `streaming-redaction.ts`, `streaming-history-service.ts`, `streaming-resource-store.ts`; add tests.

**Interfaces:** Produce `buildWebSocketRequest`, `buildSseRequest`, `redactStreamingValue`, and History create/append/finalize/list/get/delete/clear/prune APIs.

- [ ] Write failing tests for variable/query/Header/auth precedence, secret replacement, common JSON credential keys and bounded previews.
- [ ] Implement builders by reusing existing resolver/key-value/auth semantics; implement transactional counters/sequence and 5,000/200 retention.
- [ ] Test session delete/clear/workspace/prune removes only stream-assets and keeps upload/export fixtures.
- [ ] Commit `feat: add streaming history and resource ownership`.

### Task 3: SSE parser and execution

**Files:** Create `src/main/sse/sse-parser.ts`, `sse-connection-service.ts`, `src/main/ipc/sse-handlers.ts`; extend preload and local mock; add tests.

**Interfaces:** `SseParser.push(text)/finish()` emits records; service exposes `connect/stop/stopAll`, active count and typed lifecycle/record callback.

- [ ] Write failing pure tests for all fields, multiline, comments, retry/id rules, BOM, LF/CRLF/CR and arbitrary split boundaries.
- [ ] Implement the minimal parser; verify every split matrix passes.
- [ ] Write failing integration tests for GET/POST, variables/auth, content type/HTTP error, connect/idle/session timeout, stop, close, size and metrics.
- [ ] Implement fetch/decoder/registry/history/event routing, then run focused and leak-cleanup tests.
- [ ] Commit `feat: add SSE streaming parser and sessions`.

### Task 4: WebSocket transport and messages

**Files:** Add `ws@8.21.0`; create `src/main/websocket/websocket-connection-service.ts`, `src/main/ipc/websocket-handlers.ts`; extend FileRegistry/preload/mock; add tests.

**Interfaces:** Service exposes `connect/disconnect/sendText/sendJson/sendBinary/sendFile/disconnectAll` and emits typed lifecycle/record events.

- [ ] Add local ws echo/json/binary/close/delay/reconnect/subprotocol/Header fixtures; write failing connection/state/timeout/duplicate/shutdown tests.
- [ ] Implement central transitions, generation guard, connect timeout and same-request active guard.
- [ ] Write failing send/inbound/sequence/counter/resource/maxPayload tests, then implement four composer modes and managed binary records.
- [ ] Write failing ping/pong/reconnect tests, then implement bounded timers, fixed delay and user/shutdown suppression.
- [ ] Commit `feat: add WebSocket lifecycle and message timeline`.

### Task 5: English streaming UI

**Files:** Create focused components under `src/renderer/features/websocket`, `features/sse`, `features/stream-history`; modify App, History and styles; add Testing Library tests.

**Interfaces:** Protocol editors consume saved rows plus shared defaults and named preload APIs; timelines consume only matching connection/session events and cap at 500.

- [ ] Write failing tests for protocol selection, WebSocket connect/disconnect/four sends/state/timeline/filter/template/resource detail.
- [ ] Implement WebSocket editor, overview, composer, template CRUD and bounded follow/pause timeline.
- [ ] Write failing tests for SSE GET/POST/body/connect/stop/metrics/event JSON/detail/aggregate.
- [ ] Implement SSE editor and timeline; test request switching ignores stale events.
- [ ] Add Streaming History list/detail/delete/clear/create/reconnect with redacted-snapshot blocking; commit `feat: add WebSocket and SSE workbench UI`.

### Task 6: Smoke, CI and documentation

**Files:** Add `scripts/streaming-smoke.ts`, package scripts; extend Electron smoke/CI/mock; update README/docs and add Milestone 4 report.

**Interfaces:** `test:streaming` runs focused suites; `smoke:streaming` starts only 127.0.0.1 random-port fixtures and cleans DB/server/timers/assets.

- [ ] Add smoke for WS open/JSON echo/binary resource/disconnect and SSE two events/JSON/stop/history restart.
- [ ] Add CI steps before Electron smoke and retain the post-Electron database ABI test.
- [ ] Document client choice, parser, state, limits, History/redaction and exact exclusions.
- [ ] Run npm ci, lint, typecheck, all/focused tests, build, all smokes, Electron smoke, ABI recovery and diff check.
- [ ] Commit `test: close WebSocket and SSE streaming milestone`.

### Task 7: Remote closure

**Files:** No product files unless a reproducible CI failure requires a tested fix.

**Interfaces:** Clean `main` equals `origin/main`; exact final Windows CI succeeds.

- [ ] Sync CodeGraph and inspect connect/disconnect/send/stop/event/history/resource cleanup paths.
- [ ] Review tracked files for assets, DB, userData, logs, secrets and scope violations.
- [ ] Fast-forward merge, ordinary push, watch exact run and minimally fix real failures.
- [ ] Record commits, counts, run/job IDs, steps, limitations and next-stage recommendation in the 24-section Chinese report.
