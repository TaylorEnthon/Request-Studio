# Request Studio — Milestone 6 Assets Final Report

## 1. Final conclusion

Milestone 6 delivers a complete local API asset workflow: versioned Request assets, safe cURL import, Request export, deterministic multi-protocol code previews, and one-way Workspace JSON export. No Milestone 7 capability is included. The product closure PR and its final `main` CI completed successfully; the exact remote evidence is recorded in **Final Main Closure**.

## 2. Git state at closure start

- Branch: `main`
- HEAD and `origin/main`: `4a12e5358d9c3af78d39b4c83a24fef723a246fc`
- Ahead/behind: `0/0`
- Working tree: clean
- Closure worktree: `.worktrees/milestone-6-final-closure`
- Existing B2.3 worktree: clean but its branch and `main` have unique commits on both sides; it is deliberately preserved.

## 3. CodeGraph

The final-closure index started current at 147 files, 1,429 nodes, and 4,078 edges. After adding and hardening the smoke it was synchronized at 148 files, 1,469 nodes, and 4,176 edges. CodeGraph traced the four product paths from Renderer entry to shared contracts and Main-only persistence/file operations:

- `CurlImportPanel → Preload → registerCurlImportHandlers → previewCurlImport → parseCurl → mapCurlImportSave → Repository.importCurl → SQLite`
- `RequestExportPanel → Preload → request-export handlers → createRequestExportPreview → mapSavedRequestToExportAsset → output sanitizer → writeExportFileAtomic`
- `CodeGenerationPanel → Preload → code-generation handlers → RequestAsset mapper → sanitizer → capability registry → adapter → preview → clipboard`
- `WorkspaceExportPanel → Preload → workspace-export handlers → Repository snapshot → mapWorkspaceExportV1 → serializer → writeExportFileAtomic`

No Renderer-to-SQL/filesystem/parser/generator/serializer bypass was found. Credential placeholder extraction and output sanitization are separate trust-boundary policies by design; Request export, code generation, and Workspace export reuse the same output sanitizer rather than maintaining divergent copies.

## 4. Phase overview and RequestAssetV1

- A1: strict `RequestAssetV1` contract and Saved Request mapper for HTTP, WebSocket, and SSE.
- B1–B2.3: safe tokenizer/parser, preview, transactional save, named IPC, and English import UI.
- C1–C3: Request cURL/JSON export and JavaScript Fetch/Python requests foundation.
- D1–D3: code-generation UI, TypeScript Axios, SSE Fetch, Browser WebSocket, capability registry, quality and warning refinements.
- E1–E2: deterministic `WorkspaceExportV1`, chunk serializer, preview/save IPC, and English Workspace export UI.

`RequestAssetV1` is strict, versioned, protocol-discriminated, and contains no database IDs or execution metadata.

## 5. cURL import

The parser accepts a controlled common cURL subset across POSIX, PowerShell, and CMD tokenization. It rejects shell activity, file-backed arguments, unsupported flags, malformed input, upload/config/certificate options, and unsafe ambiguity with fixed errors.

Credentials are replaced immediately with deterministic, non-secret-derived placeholders. Preview mappings contain only credential kind, placeholder, safe location, and suggested variable name. Save requires complete, unique mappings, validates Workspace/Collection/Environment relationships, creates empty secret-variable slots, and writes the Saved Request plus variables in one Repository transaction. The Renderer receives a sender-scoped preview ID and never calls the parser or Repository directly.

## 6. Request export

HTTP requests export as deterministic POSIX cURL or versioned Request JSON. WebSocket and SSE export as Request JSON. Main validates Workspace ownership, maps the Saved Request, sanitizes output, stores a sender-scoped preview capability, opens the Save dialog, sanitizes the filename, and performs atomic replacement. Renderer never receives a destination path or filesystem API.

## 7. Code generation

The capability registry is the common source for Main validation and the UI selector:

- JavaScript Fetch, Python requests, and TypeScript Axios for HTTP;
- SSE Fetch for SSE;
- Browser WebSocket for WebSocket.

Adapters consume a sanitized intermediate model and produce deterministic text plus structured warnings. Browser WebSocket reports unsupported custom handshake headers and header-based authentication. The UI guards stale request/workspace/language responses and copies preview text through the browser clipboard; it never executes code, installs dependencies, writes files, or generates projects.

## 8. Workspace export

`WorkspaceExportV1` contains Workspace name, deterministic Collection references, sanitized Request assets, Environments, and variables. Secret slots have empty values. The strict schema rejects duplicate/missing references and oversized items. The serializer has stable ordering and bounded per-item chunks; the Main Repository snapshot remains memory-resident. Renderer receives counts, warnings, and at most 32 KiB of UTF-8-safe preview text. The saved file contains the full deterministic bundle.

History, Experiment runs, Compare data, Resources, database IDs, timestamps, and runtime fields are excluded. Workspace import is not implemented.

## 9. IPC, Preload, and security invariants

- Preload exposes named domain methods only; there is no generic IPC bridge.
- SQLite, parsers, generators, serializers, dialogs, paths, and file writes remain Main-only.
- Import, Request export, and Workspace export capabilities are sender-scoped UUIDs and successful save/import consumes them.
- UI generation counters or busy selection locks prevent stale asynchronous results from replacing current state.
- Real credentials are absent from parser preview, save plan, exported files, generated code, Workspace bundles, fixed errors, warnings, and IPC output.
- Windows, Unix, and `file://` local paths are absent from Request export, code generation, and Workspace export.
- Output excludes Workspace/Collection/Request/History/Execution/Resource database identifiers and timestamps unless a portable contract explicitly defines a stable reference.
- File references are cleared, HTML is never executed, and generated code is preview-only.

Environment secret values remain plaintext in local SQLite. That existing at-rest limitation requires a separately designed `safeStorage` migration.

## 10. Database impact

Milestone 6 adds no schema migration. Import uses existing Workspace, Collection, Environment, variable, and Saved Request tables. Export and code generation are read-only. Workspace export reads a scoped snapshot without modifying SQLite.

## 11. UI

The English Tools workflows are:

- `Import cURL... → Preview → Map sensitive values → Import`
- `Export Request... → Select format → Preview → Save`
- `Generate Code... → Select request/language → Preview → Copy`
- `Export Workspace... → Select Workspace → Preview → Save File`

## 12. Performance limits

- Workspace: at most 1,000 Collections, 10,000 Requests, 100 Environments, and 1,000 variables per Environment under the strict bundle schema.
- A Workspace Request item is limited to 1,000,000 serialized characters.
- Renderer Workspace preview is capped at 32 KiB by UTF-8 byte length without splitting a Unicode code point.
- Full Workspace snapshots remain in Main memory; JSON file emission is chunked by bundle item.

## 13. Product smoke

`npm run smoke:assets` uses a temporary SQLite database, temporary `userData`, and temporary output directory. It performs one credential-bearing cURL preview and save, Request cURL/JSON export, three HTTP code generations, and Workspace bundle mapping/serialization/file save. It verifies deterministic output, placeholders, empty secret slots, stable references, atomic writes, and the exclusion of credential/path/database/history/experiment/resource fixtures.

The smoke makes no network request, uses no real credential, never touches production `userData`, closes SQLite, and removes the complete temporary root in `finally`. The only console output is `Milestone 6 assets smoke passed`.

## 14. Tests and local verification

Closure baseline and final full suite: 58 test files and 315 tests passed. The focused Milestone 6 matrix passed 20 files and 175 tests. `npm ci`, lint, typecheck, build, `test:all`, database smoke, media smoke, streaming smoke (2 files/4 tests), assets smoke, Electron smoke, post-Electron database tests (1 file/6 tests), post-Electron database smoke, and `git diff --check` all completed successfully. No test was skipped or reported flaky, and every temporary smoke root was removed.

## 15. CI

Windows CI uses Node 22 with a 20-minute timeout. It runs `npm ci`, lint, typecheck, full tests, build, database smoke, media tests/smoke, streaming smoke, the Milestone 6 assets smoke, Electron smoke, and a post-Electron database test. There is no `continue-on-error`, suppressed failure, or skipped required step.

PR and final `main` Run/Job IDs, commit SHA, duration, and conclusions are recorded in **Final Main Closure**.

## 16. Documentation

- Updated `README.md` with the actual Milestone 6 product/support matrix.
- Updated `docs/architecture.md` with streaming, Experiment/Compare, and asset-flow architecture.
- Updated `docs/security-boundaries.md` with import/export/codegen/workspace-export boundaries.
- Updated `docs/milestones.md` to mark Milestones 1–6 complete without starting Milestone 7.
- Added this report and the executable closure plan.

## 17. Main files

- `src/shared/assets/request-asset.ts`: portable request contract.
- `src/shared/curl/*`: tokenizer, parser, preview, and save mapper.
- `src/shared/assets/request-export.ts`: shared output sanitizer and export mapper.
- `src/shared/codegen/*`: capability registry, intermediate models, and adapters.
- `src/shared/assets/workspace-export.ts`: Workspace contract, mapper, validation, serializer.
- `src/main/ipc/*-handlers.ts`: sender-scoped capabilities and Main orchestration.
- `src/main/export/request-export-file.ts`: filename safety and atomic writes.
- `scripts/assets-smoke.ts`: cross-feature product smoke.

## 18. Explicitly not implemented

Workspace Import, OpenAPI, Postman Import, GraphQL, gRPC, AI/AI code generation, Script System, pre-request/test scripts, Cloud Sync, Collaboration, CI Runner, load testing, Installer, Auto Update, `safeStorage` migration, code execution, dependency installation, project generation, new languages, and new export formats are outside Milestone 6.

## 19. Known limitations

- cURL import supports a controlled common subset, not every flag.
- `@file`, form upload, certificate/config, and other file parameters are rejected.
- Import discards original credentials and users must re-enter them in Environment secret slots.
- Request export, code generation, and Workspace export never emit resolved secrets.
- Browser WebSocket cannot express custom handshake headers or header authentication.
- Workspace export is one-way and the Main Repository snapshot is memory-resident.
- Workspace bundles exclude History, Experiments, Compare data, and Resources.
- Code generation does not execute code, install target dependencies, save files, or generate projects.
- Environment secrets remain plaintext in SQLite.
- Local Electron smoke may require appropriate Windows permissions for MSBuild FileTracker; code must not bypass that failure.

## 20. Next-stage recommendation

Recommend **Workspace Import & Portable Bundles** before OpenAPI import or desktop distribution. It completes the portability loop created by E1/E2 and exercises validation, dry-run preview, conflict policy, ID remapping, and secret-slot restoration without widening protocol scope. OpenAPI import is the second choice; distribution is best after import/export portability is proven.

## 21. Final Main Closure

- PR [#12 — Milestone 6 — Final Closure & Product Verification](https://github.com/TaylorEnthon/Request-Studio/pull/12) was squash merged with no conflict.
- Squash commit: `b074fadb440a7f5222b1361c435f9d260cb9e102`.
- PR CI: workflow `CI`, Run `29644984294`, Job `88081625375`, head `c011b583a240fe6b5c9b3e595266cc4328b4a0ee`, `success`, 2 minutes 22 seconds (`2026-07-18T12:48:14Z`–`12:50:36Z`).
- Final product `main` CI: workflow `CI`, Run `29645158986`, Job `88082076378`, commit `b074fadb440a7f5222b1361c435f9d260cb9e102`, `success`, 2 minutes 26 seconds (`2026-07-18T12:53:59Z`–`12:56:25Z`).
- Both Jobs completed `npm ci`, lint, typecheck, tests, build, database smoke, media tests/smoke, streaming smoke, assets smoke, Electron smoke, and the post-Electron database test with no skipped required step and no `continue-on-error`.
- Local `main` was fast-forwarded to the squash commit before this documentation-only closure update. The pre-existing diverged B2.3 worktree remains preserved because it is not safely merged.
- This documentation-only update changes no product code, schema, IPC, UI, execution engine, or Milestone 7 scope. Its final merge SHA and CI are recorded in the delivery response because a commit cannot contain evidence of its own future merge.

With PR #12 and its final `main` CI successful, the Milestone 6 product scope is officially closed. The final delivery procedure additionally verifies `HEAD = origin/main`, ahead/behind `0/0`, a clean working tree, and cleanup of only safely merged closure worktrees/branches.
