# Workspace Import Transactional Apply Design

**Goal:** Apply a validated WorkspaceExportV1 bundle through the existing A1 dry-run model in one SQLite transaction, with deterministic safe results and full rollback.

## Architecture

```text
WorkspaceExportV1 source
  -> A1 parser and semantic validator
  -> live target snapshot
  -> A1 dry-run and conflict analysis
  -> explicit rename resolution
  -> repeated A1 dry-run
  -> existing Repository transaction
  -> workspace / collections / environments / variables / requests
```

The existing `Repository` owns all database reads and writes. A small shared apply module owns readonly request/result contracts, resolution validation, deterministic bundle renaming, and RequestAsset-to-row mapping. No second repository, service layer, schema migration, IPC, Preload, or UI is introduced.

## Transaction and conflicts

- Parsing, live-target analysis, both dry-runs, mapping, and every insert execute inside one `better-sqlite3` transaction.
- Create mode creates a new workspace. Merge mode appends data to a caller-selected existing workspace.
- A2 executes only explicit `rename` resolutions. `skip`, `merge`, and `replace` are rejected as unsupported instead of guessing destructive semantics.
- Resolutions use A1 `sourceRef` values. Unknown, duplicate, blocked, or incomplete resolutions fail before writes.
- A final dry-run must contain no conflicts or blocked operations before insertion begins.
- Internal sourceRef-to-database-ID maps exist only for the transaction and are never returned.

## Persistence mapping

- Dependency order is workspace, collections, environments, variables, requests.
- HTTP rows store body/settings directly and an empty stream configuration.
- WebSocket and SSE rows reuse the existing database representation used by request update/export paths.
- Secret variables always persist as an empty value with `is_secret = 1`.
- Existing schemas and database constraints remain authoritative.

## Security and errors

- A1 remains the trust boundary for format, limits, dangerous keys, semantic validation, protected request values, and empty secret slots.
- Existing sanitizers detect unsafe local-path/runtime text before apply; unsafe input is rejected rather than silently rewritten.
- Results contain mode and deterministic counts only, never database IDs or source data.
- Public failures use fixed codes/messages and never include SQL, stack traces, raw bundles, secrets, or filesystem paths.
- Repository failures are caught outside the transaction and reduced to `TRANSACTION_FAILED`.

## Verification

Focused Vitest coverage proves clean create, mapping and ordering, deterministic results, supported rename, unsupported/blocked/multiple conflicts, secret handling, path rejection, and rollback at workspace/request/variable failure points. The full project validation and smoke matrix remains required before delivery.

