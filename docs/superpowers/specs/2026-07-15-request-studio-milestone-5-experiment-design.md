# Request Studio Milestone 5 — Experiment & Compare Design

## 1. Background

Request Studio has completed the desktop foundation, HTTP execution, response intelligence, and WebSocket/SSE streaming milestones. The product can execute and inspect one request or stream well, but it does not yet preserve a group of controlled variants or compare their outcomes.

Milestone 5 turns the product from a request execution tool into an API experiment and analysis workspace. A user can create an Experiment, clone a request into independent Runs, vary configuration, execute the Runs, and compare exactly two completed Runs at a time.

This document is design-only. It does not authorize production code, schema, UI, IPC, or test changes.

### Goals

- Persist Experiments independently from Saved Requests.
- Preserve immutable execution snapshots so later request edits do not rewrite history.
- Execute HTTP, WebSocket, and SSE variants through the existing Main-process services.
- Compare request, result, metrics, timeline, and managed media without weakening current security boundaries.
- Remain responsive with up to 100 Runs and large responses.

### Non-goals

- AI analysis or LLM summaries.
- Cloud sync, team collaboration, OpenAPI, GraphQL, or gRPC.
- Productized mock servers, scripts, CI runners, or load testing.
- Pixel, waveform, audio, or video-frame diff in the first version.
- N-way comparison. Version 1 compares exactly two Runs.
- `safeStorage` migration or any Milestone 5B import/export work.

## 2. Current Architecture Analysis

### Execution

- `src/main/http/http-execution-service.ts` owns HTTP concurrency, execution IDs, cancellation, timeout, variable resolution, bounded response reads, classification, History insertion, and resource registration.
- `src/main/websocket/websocket-connection-service.ts` owns connection IDs, session IDs, lifecycle, message send/receive, ping, reconnect, redacted timeline records, and binary resources.
- `src/main/sse/sse-connection-service.ts` owns connection/session lifecycle, incremental SSE parsing, timeouts, event limits, redacted records, metrics, and finalization.
- Renderer execution is asynchronous: HTTP emits `http:execution-event`; streaming emits typed lifecycle/record events. Main remains the only network owner.

### Response and Resources

- `HttpResponsePanel` already presents overview, headers, pretty/raw text, media preview, and binary inspection.
- `JsonViewer`, `BinaryViewer`, and `ResourceViewer` are reusable display components. Experiment Compare must compose them rather than fork them.
- `ResponseResourceRegistry` already enforces managed-root containment, opaque IDs, bounded preview reads, recovery, and safe public descriptors.
- Current HTTP resources are owned by `request_history`; stream resources are owned by `stream_sessions`. Their retention and deletion lifecycles make them unsuitable as the durable owner of Experiment artifacts.

### Persistence

- SQLite uses explicit forward migrations through schema v4 and enables foreign keys.
- Workspace deletion cascades to Collections, Environments, requests, HTTP History, stream sessions, records, and resources.
- Saved Request deletion uses `ON DELETE SET NULL` for existing History, preserving historical results.
- HTTP History caps a workspace at 500 rows and removes stale managed files. Streaming history has its own session/record model and limits.

### IPC and Renderer

- Main registers explicit named handlers; Preload exposes named domain methods under `window.requestStudio`.
- Renderer has no Node, generic IPC, generic fetch, SQL, socket, or filesystem path primitive.
- `App.tsx` currently coordinates explorer selection, request drafts, HTTP events, and streaming events. It is already broad; Milestone 5 should add focused Experiment components and keep protocol execution logic out of Renderer.
- `HistoryPanel` and `StreamHistoryPanel` demonstrate list/detail/delete patterns, but both eagerly load small bounded lists and are not sufficient for 100 large Runs without pagination.

## 3. CodeGraph Analysis Result

CodeGraph was present and up to date on 2026-07-15:

```text
Files: 84
Nodes: 744
Edges: 1,779
Backend: node:sqlite
Status: up to date
```

The traced paths show:

1. `App` calls named Preload methods; Preload invokes explicit IPC channels.
2. `registerHttpHandlers` resolves the selected Environment and delegates to `HttpExecutionService.start`.
3. `HttpExecutionService` generates an execution ID, inserts an immutable redacted request snapshot into `request_history`, and registers managed response resources.
4. WebSocket/SSE handlers delegate to protocol services, which create `stream_sessions`, append ordered `stream_records`, and emit connection/session-scoped events.
5. Response viewers consume public descriptors and the secure custom resource protocol; they never consume managed paths.

CodeGraph also exposes the required abstraction seam: protocol services are reusable, but handler registration currently constructs and owns service instances. Experiment execution must receive those existing service instances through Main composition. It must not call IPC internally or duplicate fetch/socket logic.

## 4. Product Goal and User Workflow

The primary workflow is:

```text
Select request
  -> Create Experiment
  -> Create/clone Run variants
  -> Edit each Run snapshot
  -> Run one or Run all sequentially
  -> Select two completed Runs
  -> Compare request, response, metrics, timeline, and media
```

Example:

```text
GPT Prompt Test
  Run A: temperature=0.2
  Run B: temperature=0.8
  Run C: temperature=1.2
```

Creating an Experiment copies the current request configuration. There is no live Saved Request relationship. Subsequent Saved Request edits or deletion do not change the Experiment.

## 5. Architecture Options

### Option A — Independent immutable Run snapshots (recommended)

Runs own request/result snapshots, streaming records, and Experiment-managed resources. Existing execution services perform network work; an `ExperimentRunner` captures their outputs into Experiment storage.

Benefits: deterministic history, safe deletion, no retention coupling, protocol reuse, and clear ownership. Cost: managed files may be copied once into Experiment storage.

### Option B — Reference existing HTTP/Streaming History

Runs store only `request_history.id` or `stream_sessions.id` and compare those rows.

This is smaller initially, but History retention or user deletion can silently break Experiments. Pinning History would couple two unrelated lifecycle policies and complicate cleanup. Rejected.

### Option C — General-purpose execution artifact platform

Replace all current History/resources with a universal artifact graph and plugin comparators.

This could serve future products, but it requires a broad migration and multiple speculative interfaces. Rejected for Milestone 5.

## 6. Experiment Model

Add an `experiments` aggregate in schema v5:

| Field | Type | Meaning |
|---|---|---|
| `id` | TEXT PK | Random UUID |
| `workspace_id` | TEXT FK | Owner; `ON DELETE CASCADE` |
| `name` | TEXT | 1–100 characters |
| `description` | TEXT | Optional, maximum 1,000 characters |
| `protocol` | TEXT | `http`, `websocket`, or `sse` |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

Indexes:

- `experiments_workspace_updated_idx(workspace_id, updated_at DESC)`
- `UNIQUE(workspace_id, name COLLATE NOCASE)` to prevent ambiguous names.

An Experiment contains Runs of one protocol. Cross-protocol comparison is not meaningful in v1 and is rejected at the trust boundary.

Deletion removes all Runs, records, and Experiment resources through foreign keys, then removes the managed Experiment asset directory. Workspace deletion cascades identically.

## 7. Run Model and Lifecycle

Add `experiment_runs`:

| Field | Type | Meaning |
|---|---|---|
| `id` | TEXT PK | Random UUID |
| `experiment_id` | TEXT FK | `ON DELETE CASCADE` |
| `label` | TEXT | User-visible Run A/B/C label |
| `position` | INTEGER | Stable list order |
| `status` | TEXT | `draft`, `queued`, `running`, `completed`, `failed`, `cancelled` |
| `snapshot_version` | INTEGER | Starts at 1 |
| `request_snapshot_json` | TEXT | Full redacted request template snapshot |
| `environment_snapshot_json` | TEXT | Non-secret values plus redacted secret descriptors |
| `result_snapshot_json` | TEXT | Normalized protocol result or null |
| `started_at` | TEXT | Nullable |
| `completed_at` | TEXT | Nullable |
| `duration_ms` | INTEGER | Nullable |
| `error_json` | TEXT | Stable display-safe error or null |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

Constraints and indexes:

- `UNIQUE(experiment_id, position)`
- `UNIQUE(experiment_id, label COLLATE NOCASE)`
- `experiment_runs_experiment_status_idx(experiment_id, status, position)`
- Maximum 100 Runs per Experiment, enforced in Main before insertion.

Lifecycle:

```text
draft -> queued -> running -> completed
                          -> failed
                          -> cancelled
```

Only `draft` Runs may change request/environment snapshots. After execution begins, the snapshot is immutable. Rerun and “edit completed Run” clone a new draft Run; they never overwrite evidence. Labels may be renamed after completion because labels are presentation metadata.

“Run all” executes sequentially in v1. This avoids hidden load testing, rate bursts, cross-run socket pressure, and ambiguous latency caused by local contention.

## 8. Snapshot Design

### Request snapshot

Copy, do not reference:

- Protocol, request name, URL template, method, params, headers, auth type/placement, body, settings, WebSocket subprotocol/reconnect/ping settings, or SSE method/body/limits.
- Enabled/disabled state and duplicate entry order.
- Snapshot schema version.

Never persist:

- Bearer token, Basic password, API-key value, Cookie/Authorization values, opaque file references, or resolved secret values.

Request file bodies store filename, size, and digest metadata. The selected bytes are copied into Experiment-managed resources only when the Run executes.

### Environment snapshot

- Copy non-secret key/value pairs used by the Run.
- Store secret variable names with `isSecret: true` and value `[REDACTED]`.
- Store a digest of the resolved redacted request for audit, not the original secret.
- Running or cloning a snapshot that needs a secret requires resolving it again from the currently selected Environment. Missing secrets block execution with a stable validation error.

### HTTP result snapshot

- Outcome, status, status text, duration, size, content type, classification, redacted response headers, and stable error.
- Inline JSON/text/XML up to 1 MiB.
- Larger textual responses and all media/binary responses use an Experiment resource descriptor.
- Preserve whether content was truncated or stored externally.

### Streaming result snapshot

- Final state, connect/first-record/end times, duration, close code/reason, reconnect count, byte/count metrics, and stable error.
- Copy ordered redacted messages/events into `experiment_run_records`.
- Copy binary message resources into Experiment-managed resources.

### Copy versus reference rule

- Copy metadata, redacted snapshots, small text, streaming records, and required managed bytes.
- Reuse viewer components and classification logic in code.
- Do not retain foreign keys to Saved Request, HTTP History, stream sessions, or their resources. Temporary source IDs may exist only in memory while capturing a completed execution.

## 9. Experiment Records and Resources

Add `experiment_run_records` for WebSocket/SSE:

```text
id, run_id, sequence, direction, record_type, data_kind,
relative_time_ms, byte_length, text_preview, json_text,
event_name, event_id, retry_ms, outcome, resource_id, created_at
```

Use `UNIQUE(run_id, sequence)` and `experiment_run_records_run_sequence_idx(run_id, sequence)`. Store relative time from Run start; wall-clock time must not participate in sequence matching.

Add `experiment_resources`:

```text
id, run_id, source, kind, declared_mime_type, detected_mime_type,
effective_mime_type, path, byte_length, suggested_filename,
warnings_json, digest, created_at
```

Use `ON DELETE CASCADE` from Run and `experiment_resources_run_idx(run_id)`. Paths stay Main-only. Public descriptors remain opaque and compatible with `ResourceViewer`/`BinaryViewer`.

Experiment resources live below a separate root:

```text
experiment-assets/<workspaceId>/<experimentId>/<runId>/<resourceId>.bin
```

Do not add this root to HTTP History cleanup. Experiment repository cleanup owns it.

## 10. Compare Engine

Use a small pure Compare Core with protocol dispatch, not a plugin framework:

```text
compareRuns(left, right, options)
  -> compareCommon
  -> compareHttp | compareWebSocket | compareSse
  -> compareResourceMetadata when present
```

The common result contains:

- Scalar metric changes.
- Structured sections with `equal`, `added`, `removed`, or `changed` entries.
- Warnings and skipped reasons.
- Counts only; it never embeds managed file paths.

The Main process validates ownership and returns bounded normalized snapshots. A native Renderer Web Worker runs CPU comparison so Main network/SQLite work and the React event loop remain responsive. Compare Core remains a pure shared TypeScript module usable by that Worker and unit tests.

No diff dependency is required in v1:

- JSON uses a recursive structural path diff.
- Text and XML use a bounded line-level LCS diff.
- XML is whitespace-normalized text diff, not semantic XML canonicalization.

The LCS ceiling is 2,000 lines and 2,000,000 comparison cells. Inputs above the 2 MiB per-side compare ceiling produce summary-only results and an explicit “Diff skipped: content exceeds limit” warning. A mature diff library should be evaluated only if these measured limits become a real product constraint.

## 11. HTTP Compare

### Request

- URL template and method.
- Params and Headers as ordered multimaps, pairing duplicate keys by occurrence.
- Enabled state and insertion/deletion/order changes.
- Auth type and placement only; never secret values.
- Body type and content. JSON receives structural diff; text/XML receive bounded line diff; form/multipart entries use key occurrence; binary compares metadata/digest.

### Response

- Outcome, status/status text, content type, classification, duration, and size.
- Headers compared case-insensitively while preserving duplicate values.
- Duration shows absolute and percentage delta; zero baseline yields only absolute delta.
- JSON structural diff distinguishes missing keys from explicit null.
- Arrays are positional in v1; no guessed identity key.
- Text and XML use line-level added/removed/changed blocks.
- Media/binary compare metadata and digest; raw bytes are not loaded for text diff.

## 12. WebSocket Compare

Compare:

- Final state, connected/failed outcome, duration, close code/reason, negotiated subprotocol, reconnect count, inbound/outbound counts, and bytes.
- Ordered normalized message sequences.

Message alignment uses bounded LCS tokens:

```text
direction + dataKind + normalized payload digest
```

Time never determines identity. After alignment:

- Unmatched left/right messages are removed/inserted.
- Aligned JSON messages receive structural payload diff.
- Aligned text messages receive bounded line diff.
- Relative-time delta is displayed separately.
- Binary messages compare size, MIME, and digest; v1 has no byte or media-frame diff.

If the record count exceeds 10,000 per Run, compare only the first/last bounded windows plus aggregate metrics and show a limit warning.

## 13. SSE Compare

Compare aggregate event count, bytes, duration, time to first event, last event ID, retry value, completion state, and ordered events.

Alignment token priority:

1. `eventName + eventId` when a non-empty ID exists.
2. `eventName + normalized data digest` otherwise.

Bounded LCS classifies inserted, deleted, and retained events. Retained events compare name, ID, retry, relative time, and JSON/text data. Duplicate IDs are paired by occurrence; the engine does not assume SSE IDs are globally unique.

## 14. Media Compare

Reuse `ResourceViewer`, `BinaryViewer`, response classification, opaque resource descriptors, and the secure custom protocol.

Version 1:

- Image: side-by-side display, MIME, byte size, dimensions, and digest.
- Audio: two independent players, MIME, byte size, duration, and digest.
- Video: two independent players, MIME, byte size, duration, resolution, and digest.
- PDF/Binary: side-by-side metadata, byte size, MIME, warnings, and digest.

Deferred until measured demand:

- Pixel diff, overlay, perceptual hashes.
- Synchronized audio/video playback.
- Waveform, codec-level, frame, or PDF structural diff.

## 15. UI Design

Add an `Experiments` section beneath Requests in the existing explorer. Do not introduce a router in v1; extend the current selection state with a focused `request | experiment` union.

### Experiment list

Display:

- Name.
- Protocol badge.
- Run count.
- Last updated time.

Actions: create from the selected request, rename, duplicate, and delete with confirmation.

### Experiment detail

Keep the left explorer. Let the Experiment workspace span the center and right panes because Compare needs width.

Header:

```text
Experiment name | protocol | Add Run | Run all
```

Run table:

```text
Compare checkbox | label | status | result | duration | size | updated
```

- Exactly two completed Runs enable Compare.
- Add Run clones the most recently selected Run or the Experiment's first Run.
- Draft Run editing reuses the existing protocol-specific request editors with an Experiment draft adapter; it must not fork editor behavior.
- Status events use Run IDs, so stale execution events cannot update a cloned or newer Run.

### Compare workspace

```text
------------------------------------------------------
Run A summary                 Run B summary
------------------------------------------------------
Request | Response | Metrics | Timeline | Media
------------------------------------------------------
Left value       Structured diff       Right value
------------------------------------------------------
```

Only relevant tabs render. HTTP has Request/Response/Metrics/Media; WebSocket/SSE add Timeline. Large bodies show summary and resource controls instead of mounting a huge diff. Pagination and tab content load on demand.

Accessibility requirements: keyboard-selectable Runs, visible focus, semantic tables, text labels in addition to color, and `aria-live` status for queued/running/completed transitions.

## 16. Schema v5 Migration

Schema v5 adds only:

- `experiments`
- `experiment_runs`
- `experiment_run_records`
- `experiment_resources`
- Their constraints and indexes.

It does not rewrite v1–v4 tables. The migration runs in one SQLite transaction, inserts schema migration version 5, and sets `user_version = 5` only after all DDL succeeds.

Migration tests must cover:

- Fresh database at v5.
- v1, v2, v3, and v4 upgrades to v5.
- Foreign keys and workspace cascade.
- Experiment deletion cascade.
- Saved Request modification/deletion does not affect Run snapshots.
- Failed migration leaves `user_version` and prior data unchanged.

Risks are low because all tables are additive. Disk cleanup is not performed inside the migration.

## 17. Security Design

- Main owns execution, SQLite, snapshot capture, artifact copying, deletion, and compare-data reads.
- Preload exposes named Experiment CRUD/run/cancel/compare methods only.
- All IPC inputs use strict Zod schemas and verify Experiment/Run ownership through Workspace.
- Renderer receives no path, generic file API, generic IPC, generic network primitive, or unrestricted response reader.
- Reuse `redact`, HTTP safe draft behavior, streaming redaction, and exact selected-environment secret replacement.
- Request credentials and secret Environment values are never stored. A missing current secret blocks a rerun.
- Response headers and parsed JSON keys matching credential patterns are redacted before Experiment persistence. Known active secret values are replaced in text/event previews.
- Arbitrary response bodies may contain unknown sensitive business data that cannot be safely guessed. The UI must label Experiments as local sensitive data and provide Run/Experiment deletion; do not claim universal response redaction.
- Resource paths remain realpath-contained below the Experiment asset root and are exposed only through opaque descriptors.
- TLS verification, CSP, navigation restrictions, sandboxing, and safe Save As remain unchanged.
- `safeStorage` remains explicitly out of scope; Experiment persistence must not create a new plaintext credential store.

## 18. Performance Design

For 100 Runs with 10 MiB responses:

- SQLite stores metadata and at most 1 MiB inline text per Run; large bodies live in managed files.
- Experiment list pages 25 rows; Run list pages 25 rows; timeline pages 200 records.
- Detail and resources load only when selected. Compare loads only two Runs.
- Renderer never receives an unbounded timeline or full large resource through IPC.
- Main preview reads remain bounded; media uses Range streaming.
- Compare Worker enforces 2 MiB per textual side, 2,000 lines, 2,000,000 LCS cells, and 10,000 records.
- “Run all” is sequential and cancellable between Runs.
- First version enforces 100 Runs per Experiment, 50 MiB per response/message limits inherited from execution services, and a 2 GiB Experiment asset quota per Workspace.
- Quota checks occur before copying a resource and return a stable `experiment_quota_exceeded` error without deleting prior completed Runs.
- Delete operations remove DB ownership transactionally and retry orphan directory cleanup on startup, following existing resource cleanup patterns.

## 19. Required Abstractions and Non-coupling Rules

### Reuse directly

- HTTP/WebSocket/SSE execution services.
- Request builders and Environment resolution.
- Classification, filename suggestion, managed-root safety, resource protocol, and viewers.
- Redaction helpers and stable Result/error shapes.
- Existing Zod schema style, SQLite migration style, and lifecycle events.

### Abstract only what is required

- Main composition must construct protocol services once and inject them into existing handlers and `ExperimentRunner`.
- Extract reusable snapshot normalization/redaction functions from service-local code where Experiment capture needs the same rule.
- Extend resource descriptors with Experiment ownership without exposing a generic filesystem abstraction.
- Add pure Compare Core functions and protocol-specific functions; do not add a runtime plugin registry or one-implementation interfaces.

### Must not couple

- Experiment Run lifecycle to Saved Request lifecycle.
- Experiment artifacts to HTTP History or stream retention.
- Compare algorithms to React components, IPC, SQLite rows, or managed paths.
- Protocol execution services to Experiment tables.
- HTTP History cleanup to Experiment assets.
- UI selection state to raw execution/connection/session events without Run ID correlation.

## 20. IPC and Event Design

Recommended named Preload domains:

```text
experiments.list/create/rename/delete
experimentRuns.list/create/updateDraft/delete/execute/cancel
experimentRuns.records
experimentCompare.load
experiments.onRunEvent
```

`experimentCompare.load` returns two bounded normalized snapshots and public resource descriptors; it does not accept paths or arbitrary SQL filters. Compare computation stays in the Worker.

Run event identity:

```text
experimentId + runId + executionId/connectionId + state
```

Renderer ignores events that do not match the current Run's active execution identity.

## 21. Testing Plan

### Unit

- Snapshot immutability and redaction, including environment secret replacement.
- JSON structural diff, duplicate header/param matching, bounded line diff, and limit warnings.
- WebSocket/SSE sequence alignment with insertion, deletion, reorder, duplicate IDs, relative-time differences, and binary metadata.
- Repository CRUD, order, status transitions, pagination, quota accounting, and cascade behavior.

### Integration

- Schema v1–v4 upgrade to v5 and rollback on failure.
- ExperimentRunner delegates to the existing local HTTP/WebSocket/SSE mock servers and captures independent snapshots/resources.
- Deleting original Saved Request/History/session leaves completed Experiment comparisons intact.
- Deleting Run/Experiment/Workspace removes only owned artifacts.
- IPC rejects cross-workspace IDs, invalid transitions, paths, oversized inputs, and more than 100 Runs.

### Renderer

- Experiment list/detail selection.
- Draft clone/edit/run lifecycle.
- Exactly-two comparison selection.
- Lazy tab loading, pagination, limit warnings, accessible status, and reuse of media viewers.

### Smoke and regression

- Deterministic HTTP, WebSocket, SSE, JSON/text/media comparison smoke on `127.0.0.1`.
- Existing `test:all`, database, media, streaming, and Electron smoke remain mandatory.
- Verify servers, sockets, timers, database handles, Workers, Electron, and temporary userData close cleanly.

## 22. Phased Implementation Plan

### Phase 1 — Persistence and Experiment shell

1. Add schema v5 tables, indexes, migration tests, shared Zod contracts, and an Experiment repository.
2. Add named CRUD IPC/Preload methods with Workspace ownership validation.
3. Add the Experiments explorer entry, paginated list/detail shell, draft Run creation/clone/delete, and component tests.
4. Deliver a usable local Experiment organizer without network execution.

### Phase 2 — HTTP execution and Compare

1. Move protocol service construction to Main composition and inject existing services into handlers.
2. Add `ExperimentRunner` HTTP delegation, immutable snapshot capture, redaction, cancellation, and independent resource copying.
3. Add pure common/HTTP Compare Core, Worker execution, bounded JSON/text/XML diff, and tests.
4. Add Run A/Run B Request/Response/Metrics/Media UI using existing viewers.

### Phase 3 — WebSocket and SSE

1. Add Run-scoped WebSocket/SSE orchestration and event correlation.
2. Copy final streaming metrics, records, and binary resources into Experiment ownership.
3. Add bounded WebSocket/SSE sequence comparison and Timeline UI.
4. Verify stop/cancel/reconnect and stale-event behavior with the existing mock streaming server.

### Phase 4 — Resource lifecycle and hardening

1. Add Workspace quota enforcement, pagination, orphan cleanup, and startup recovery.
2. Add full security, cross-workspace, large payload, 100-Run, and cleanup regression tests.
3. Run all local and Windows CI verification; document measured limits and close Milestone 5.

Each phase is independently reviewable and must use red-green-refactor tests. Implementation should use an isolated `codex/` worktree and small commits; this design phase creates no commit.

## 23. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Experiments break when History is pruned | Independent snapshots and Experiment-owned resources |
| Credential persistence | Reuse redaction, persist secret descriptors only, require current secrets for rerun |
| Unknown sensitive response data | Local-data warning, explicit deletion, no false universal-redaction claim |
| SQLite growth | Small inline threshold, managed files, pagination, quota |
| Renderer freezes | Web Worker, hard diff ceilings, lazy tabs |
| Main freezes | Main only normalizes bounded data; CPU diff is outside Main |
| Sequence alignment cost | Bounded LCS and summary fallback |
| Protocol abstractions become generic framework | Concrete protocol switch; no plugin registry |
| Duplicate resource storage | Accept copy for independence; consider digest dedup only after measurement |
| Latency comparisons are noisy | Sequential execution and clear timestamps; do not claim benchmark accuracy |
| Existing `App.tsx` grows further | New focused Experiment components; App retains only top-level selection/wiring |

## 24. Future Extensions

After Milestone 5 is closed, measured demand may justify N-way aggregate charts, semantic XML diff, JSON array identity configuration, pixel/perceptual image diff, synchronized media playback, resource deduplication, or exportable Experiment bundles.

AI analysis, cloud collaboration, scripts, load testing, OpenAPI, GraphQL, and gRPC remain separate future product decisions and are not implied by this architecture.

## 25. Recommendation

Implement in this order:

```text
Persistence and shell
  -> HTTP Experiment vertical slice
  -> HTTP Compare
  -> WebSocket/SSE capture and Timeline Compare
  -> quotas, cleanup, and hardening
```

This order proves the immutable Run and resource lifecycle with the simplest protocol first, delivers user value before streaming complexity, and preserves existing security boundaries. Do not start with a universal Compare framework or media pixel diff.
