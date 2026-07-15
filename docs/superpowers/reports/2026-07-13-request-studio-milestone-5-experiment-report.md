# Request Studio — Milestone 5 Experiment & Compare Report

## 1. Final Conclusion

Milestone 5 delivers a local Experiment workspace and a bounded two-Run comparison workflow for HTTP, WebSocket, and SSE requests. The implementation stays inside the Electron Main Process security boundary and does not begin Milestone 6.

## 2. Git Status

- Feature branch: `codex/milestone-5-experiment`
- Base commit: `0f2e9135fd5e80584e81fcc3d4cdca522eb0caf9`
- Delivery commit, PR, merge commit, and final `main` SHA are recorded in the Final Main Closure section after remote verification.
- Generated output, local databases, logs, user data, stream assets, Experiment resources, `.codegraph`, `.ocr-results`, `.env`, and secrets are excluded from the commit.

## 3. CodeGraph

The final CodeGraph index was up to date. Its blast-radius and call-path analysis confirmed the flow from `ExperimentWorkspace` through the preload whitelist and validated IPC handlers to `ExperimentRepository` and `ExperimentRunner`. It also confirmed reuse of `HttpExecutionService`, `WebSocketConnectionService`, `SseConnectionService`, and `ResponseResourceRegistry`, plus the Schema v5 migration path.

## 4. Experiment Functionality

- Create an Experiment from a saved request with an independent request snapshot.
- Rename, delete, duplicate, and paginate Experiments.
- Add, edit, delete, and execute Runs, with a maximum of 100 Runs per Experiment.
- Execute draft Runs sequentially with **Run all**.
- Duplicate configurations as drafts without copying completed results or assets.

## 5. Runner

- HTTP execution reuses the existing HTTP execution service.
- WebSocket and SSE execution reuse the existing streaming services.
- WebSocket Runs support text, JSON, binary, and selected-file sends.
- Active HTTP, WebSocket, and SSE Runs can be cancelled by Run ID.
- Request and environment snapshots are stored independently; secret environment values are persisted as `[REDACTED]`.
- Interrupted queued or running Runs are marked failed during startup recovery.

## 6. Compare Engine

- Exactly two completed Runs from the same Experiment can be compared.
- Request comparison covers JSON structure and duplicate key/value occurrences.
- Response comparison covers JSON or bounded line-based text differences.
- Metrics include duration and byte-size deltas.
- WebSocket and SSE timelines are aligned by protocol-specific record identity without using timestamps as identity.
- Media results retain managed resource references and render through the existing resource viewer.

## 7. Schema v5

Schema v5 adds `experiments`, `experiment_runs`, `experiment_run_records`, and `experiment_resources` with foreign keys, cascade cleanup, and lookup indexes. Migration is additive and advances `PRAGMA user_version` to 5 without rewriting existing request, history, media, or streaming data. Database tests and the database smoke test cover fresh creation and upgrade behavior.

Deleting a Run or Experiment removes its database rows and managed assets. Workspace cleanup includes Experiment assets. The per-workspace Experiment resource quota is 2 GiB.

## 8. UI

The English UI adds an Experiments explorer and workspace with Experiment actions, Run controls, protocol-specific draft editors, execution state, result summaries, and Request, Response, Metrics, Timeline, and Media comparison views. Native controls, labels, focus behavior, and live status text preserve the existing accessibility baseline.

## 9. Security

- Literal credential fields are redacted when snapshots are created or edited; environment placeholders such as `{{TOKEN}}` remain resolvable.
- Renderer code does not access the database, filesystem, or network directly.
- All execution and resource reads remain Main-only behind a finite preload IPC whitelist and Zod validation.
- Workspace ownership is checked before Experiment, Run, send, cancel, delete, and compare operations.
- Resource paths are resolved only inside managed roots and public descriptors do not expose filesystem paths.

## 10. Performance Limits

- Compare work runs in a Renderer Web Worker, with a synchronous fallback only for the test environment.
- Timeline comparison is capped at 10,000 records per side.
- Full text comparison is limited to 2 MiB, 2,000 lines, and 2,000,000 alignment cells.
- Main Process compare-data loading reads at most 10,001 records and skips oversized managed text explicitly.
- Large and binary bodies remain file-backed resource references instead of being copied into Renderer state.
- Experiment listing is paginated; Run details and managed resources are loaded only for the selected Experiment or comparison.

## 11. Test Results

Fresh pre-commit verification on Windows completed successfully:

- `npm run lint`
- `npm run typecheck`
- `npm test`: 34 files, 122 tests passed
- `npm run build`
- `npm run test:all`: lint, typecheck, 34 files / 122 tests, and build passed again
- `npm run smoke:database`
- `npm run smoke:media`
- `npm run smoke:streaming`: 2 files, 4 tests passed
- `npm run smoke:electron`
- `git diff --check`

The first sandboxed Electron smoke attempt reached the native `better-sqlite3` rebuild but Windows MSBuild `FileTracker` returned `E_ACCESSDENIED`. No code workaround was added. The same command passed with appropriate permissions, and a subsequent database smoke passed after the script restored the Node ABI build.

## 12. CI

PR and final `main` workflow identifiers, job identifiers, commit SHAs, duration, conclusion, and critical-step status are recorded after the remote runs complete. The repository CI workflow runs `npm ci`, lint, typecheck, tests, build, database smoke, media tests and smoke, streaming smoke, Electron smoke, and the focused database test without `continue-on-error`.

## 13. Known Limits and Scope

This milestone intentionally provides bounded two-Run local comparison. It does not implement pixel-level media diff, waveform analysis, video frame diff, N-way comparison, remote execution, or load testing.

The following are explicitly outside Milestone 5 and were not implemented: AI analysis, cloud sync, team collaboration, OpenAPI, GraphQL, gRPC, Script systems, CI Runner, load-test systems, and Installer work.

## 14. Next Stage Recommendation

Start the next milestone only from a separately reviewed specification after Milestone 5 is closed on `main`. Keep future automation or protocol expansion outside the Experiment core until a measured need justifies it.

## Final Main Closure

Pending PR merge and final `main` CI verification.
