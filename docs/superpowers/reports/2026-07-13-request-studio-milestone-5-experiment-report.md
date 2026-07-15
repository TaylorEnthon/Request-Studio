# Request Studio — Milestone 5 Experiment & Compare Report

## 1. Final Conclusion

Milestone 5 delivers a local Experiment workspace and a bounded two-Run comparison workflow for HTTP, WebSocket, and SSE requests. The implementation stays inside the Electron Main Process security boundary and does not begin Milestone 6.

## 2. Git Status

- Feature branch: `codex/milestone-5-experiment`
- Base commit: `0f2e9135fd5e80584e81fcc3d4cdca522eb0caf9`
- Delivery commit: `dde9d92bcfceff3a12104fb5784b9d860e30f026`
- Pull request: `#2` (`codex/milestone-5-experiment` → `main`)
- Squash merge commit: `517c5d7c36d46ddd16d041afa67e264a74fb858c`
- Final documentation closure commit: `5f4ee00a15008dd1b08efeb04ecbb1c660124c7a`
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

The repository `CI` workflow runs `npm ci`, lint, typecheck, tests, build, database smoke, media tests and smoke, streaming smoke, Electron smoke, and the focused database test without `continue-on-error`.

- PR CI: Run `29405505186`, Job `87319851502`, commit `dde9d92bcfceff3a12104fb5784b9d860e30f026`, duration 2m16s, conclusion `success`.
- Merged-feature main CI: Run `29405708256`, Job `87320509006`, commit `517c5d7c36d46ddd16d041afa67e264a74fb858c`, duration 3m7s, conclusion `success`.
- Every critical step completed with `success`; no critical step was skipped and the workflow does not use `continue-on-error`.
- Final documentation main CI: Run `29406008767`, Job `87321518898`, commit `5f4ee00a15008dd1b08efeb04ecbb1c660124c7a`, duration 2m14s, conclusion `success`.

## 13. Known Limits and Scope

This milestone intentionally provides bounded two-Run local comparison. It does not implement pixel-level media diff, waveform analysis, video frame diff, N-way comparison, remote execution, or load testing.

The following are explicitly outside Milestone 5 and were not implemented: AI analysis, cloud sync, team collaboration, OpenAPI, GraphQL, gRPC, Script systems, CI Runner, load-test systems, and Installer work.

## 14. Next Stage Recommendation

Start the next milestone only from a separately reviewed specification after Milestone 5 is closed on `main`. Keep future automation or protocol expansion outside the Experiment core until a measured need justifies it.

## Final Main Closure

PR #2 was squash-merged into `main` on 2026-07-15 as `517c5d7c36d46ddd16d041afa67e264a74fb858c`. Fresh local validation passed lint, typecheck, 34 test files / 122 tests, build, database smoke, media smoke, streaming smoke, Electron smoke, and `git diff --check`.

The documentation closure commit `5f4ee00a15008dd1b08efeb04ecbb1c660124c7a` was pushed to `main`; its CI Run `29406008767` / Job `87321518898` completed successfully in 2m14s with every critical step successful. The temporary Milestone 5 worktree, local feature branch, remote feature branch, and stale worktree references were removed without deleting any unmerged branch.

At final closure verification, local `main` and `origin/main` both resolved to `5f4ee00a15008dd1b08efeb04ecbb1c660124c7a`, ahead/behind was `0/0`, and the working tree was clean. Milestone 5 is officially closed.
