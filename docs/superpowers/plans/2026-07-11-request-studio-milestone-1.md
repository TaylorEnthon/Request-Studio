# Request Studio Milestone 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a secure Electron desktop application that persists and manages workspaces, collections, environments, variables, saved request drafts, and settings.

**Architecture:** Use Electron main/preload/renderer separation with explicit Zod-validated IPC methods. Organize main-process code in vertical feature slices backed by one injected `better-sqlite3` connection; use TanStack Query for persisted state and Zustand only for transient renderer state.

**Tech Stack:** Electron, electron-vite, React, TypeScript, SQLite, better-sqlite3, Zod, Zustand, TanStack Query, Vitest, Testing Library, ESLint, Prettier, npm.

## Global Constraints

- Target Windows 11 and use npm exclusively.
- Use `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- Renderer must not access Node.js, filesystem, SQLite, arbitrary IPC, or network primitives.
- All IPC inputs use Zod; all SQL containing values is parameterized.
- UI is English-only, dark, accessible, and fixed three-pane for Milestone 1.
- Request edits auto-save with `Saving…`, `Saved`, and `Save failed` feedback.
- Do not implement HTTP execution, WebSocket/SSE connections, media, history, experiments, comparison, curl, code generation, or installer publication.
- Never log secret values or expose raw stack traces to the renderer.

---

### Task 1: Project foundation and process boundaries

**Files:**
- Create: `package.json`, `package-lock.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `eslint.config.js`, `.prettierrc.json`, `index.html`
- Create: `src/main/index.ts`, `src/main/app/create-window.ts`, `src/preload/index.ts`, `src/preload/global.d.ts`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/styles/tokens.css`, `src/renderer/styles/global.css`
- Test: `src/main/app/create-window.test.ts`, `src/preload/index.test.ts`

**Interfaces:**
- Produces: `createMainWindow(): BrowserWindow`; `window.requestStudio` placeholder typed by the later shared contract.

- [ ] Write tests asserting secure `webPreferences` and that preload exposes only the `requestStudio` key.
- [ ] Run `npm test -- src/main/app/create-window.test.ts src/preload/index.test.ts`; expect failure because modules do not exist.
- [ ] Add the smallest electron-vite React project, secure window factory, base renderer mount, lint/typecheck/test/build scripts, and dark CSS tokens.
- [ ] Run `npm run lint`, `npm run typecheck`, targeted tests, and `npm run build`; expect success.
- [ ] Commit with `feat: initialize secure Electron foundation`.

### Task 2: Shared contracts, validation, and safe errors

**Files:**
- Create: `src/shared/models/entities.ts`, `src/shared/schemas/entities.ts`, `src/shared/contracts/result.ts`, `src/shared/contracts/api.ts`, `src/shared/errors/request-studio-error.ts`, `src/main/ipc/safe-handler.ts`
- Test: `src/shared/schemas/entities.test.ts`, `src/main/ipc/safe-handler.test.ts`

**Interfaces:**
- Produces: entity types `Workspace`, `Collection`, `Environment`, `EnvironmentVariable`, `SavedRequest`, `AppSetting`; Zod schemas for every create/update/delete/select input; `Result<T>`; `RequestStudioError`; `safeHandler<TInput,TOutput>(schema, operation)`.

- [ ] Write failing validation tests for empty names, duplicate-invalid variable keys, protocols, nullable non-HTTP methods, and safe error conversion without stacks or input echo.
- [ ] Run targeted tests; expect missing exports.
- [ ] Implement explicit types and schemas. Normalize HTTP method to `GET` when absent and non-HTTP method to `null`.
- [ ] Implement `safeHandler` to parse input and return `{ ok: true, data }` or `{ ok: false, error }` with stable categories.
- [ ] Run targeted tests, lint, and typecheck; expect success.
- [ ] Commit with `feat: add validated shared contracts`.

### Task 3: SQLite migrations and connection lifecycle

**Files:**
- Create: `src/main/database/connection.ts`, `src/main/database/migrations.ts`, `src/main/database/schema-v1.ts`, `src/main/database/index.ts`
- Test: `src/main/database/migrations.test.ts`, `src/main/database/persistence.test.ts`

**Interfaces:**
- Produces: `openDatabase(path: string): Database.Database`; `migrate(db): void`; `createDatabase(path): Database.Database`; `closeDatabase(): void` for app lifecycle.

- [ ] Write failing tests that an empty database reaches version 1, re-running migration is a no-op, foreign keys are enabled, cascades work, and reopening a temporary file preserves rows.
- [ ] Run targeted tests; expect missing database functions.
- [ ] Implement `schema_migrations` and the six schema-v1 domain tables in one transaction with indexes and foreign keys.
- [ ] Implement production path resolution from `app.getPath('userData')` and injectable `:memory:`/temporary paths for tests.
- [ ] Run targeted tests and typecheck; expect success.
- [ ] Commit with `feat: add SQLite schema and migrations`.

### Task 4: Repository slices and cascade behavior

**Files:**
- Create: `src/main/workspaces/workspace-repository.ts`, `src/main/collections/collection-repository.ts`, `src/main/environments/environment-repository.ts`, `src/main/environments/environment-variable-repository.ts`, `src/main/requests/saved-request-repository.ts`, `src/main/settings/setting-repository.ts`, `src/main/database/row-mappers.ts`
- Test: corresponding `*.test.ts` files beside each repository.

**Interfaces:**
- Produces CRUD repositories constructed with `Database.Database`; all create methods generate UUIDs; `SavedRequestRepository.duplicate(id)`; `SettingRepository.get/set/delete`.

- [ ] Write failing repository tests for CRUD, workspace scoping, unique variable keys, duplicate requests, setting persistence, missing IDs, collection deletion, environment deletion, and workspace-wide cascade deletion.
- [ ] Run repository tests; expect missing classes.
- [ ] Implement row mappers and parameterized prepared statements; wrap cascade-sensitive delete flows and duplication in transactions.
- [ ] Run repository tests, migration tests, lint, and typecheck; expect success.
- [ ] Commit with `feat: persist Request Studio domain data`.

### Task 5: Typed IPC and preload API

**Files:**
- Create: `src/main/ipc/register-ipc.ts`, domain `*-ipc.ts` files under their feature directories, `src/preload/api.ts`
- Modify: `src/main/index.ts`, `src/preload/index.ts`, `src/preload/global.d.ts`, `src/shared/contracts/api.ts`
- Test: `src/main/ipc/register-ipc.test.ts`, `src/preload/api.test.ts`

**Interfaces:**
- Produces: named `RequestStudioApi` groups for workspaces, collections, environments, variables, savedRequests, and settings. Each method returns `Promise<Result<T>>`.

- [ ] Write failing tests that every channel validates malformed input, maps errors safely, and the preload surface contains only named methods with no `invoke`, SQL, path, or network method.
- [ ] Run targeted tests; expect missing registration/API functions.
- [ ] Register explicit channels through `safeHandler`, inject repositories, and expose the matching API through `contextBridge`.
- [ ] Run targeted tests, lint, and typecheck; expect success.
- [ ] Commit with `feat: expose validated desktop API`.

### Task 6: Renderer data layer and fixed three-pane shell

**Files:**
- Create: `src/renderer/app/providers.tsx`, `src/renderer/stores/ui-store.ts`, `src/renderer/features/shared/api-result.ts`, query modules for each domain, `src/renderer/layouts/StudioLayout.tsx`, `src/renderer/components/TopBar.tsx`, `src/renderer/components/ExplorerPane.tsx`, `src/renderer/components/RequestEditorPane.tsx`, `src/renderer/components/ResponsePane.tsx`
- Modify: `src/renderer/App.tsx`, renderer CSS files
- Test: `src/renderer/layouts/StudioLayout.test.tsx`

**Interfaces:**
- Produces: `StudioLayout`; query keys and mutation hooks for persisted domains; transient selected request/dialog state.

- [ ] Write a failing UI test for top bar, three panes, empty states, disabled Send control, and Milestone 2 explanation.
- [ ] Run targeted UI test; expect missing layout.
- [ ] Implement providers, minimal query wrappers, fixed pane shell, responsive minimum widths, focus styles, loading and error regions.
- [ ] Run targeted UI test, lint, and typecheck; expect success.
- [ ] Commit with `feat: add Request Studio workspace shell`.

### Task 7: Workspace, collection, and request draft interactions

**Files:**
- Create: feature components under `src/renderer/features/workspaces`, `collections`, and `requests`; `src/renderer/hooks/use-auto-save.ts`
- Modify: layout pane components
- Test: `src/renderer/features/requests/RequestEditor.test.tsx`, `src/renderer/features/workspaces/WorkspaceControls.test.tsx`

**Interfaces:**
- Produces: create/rename/delete/select workspace and collection controls; create/edit/duplicate/delete request controls; `useAutoSave(value, save, delayMs)`.

- [ ] Write failing tests for deletion confirmation, request type creation, HTTP-only method field, protocol normalization, duplication, and debounced save statuses including failure.
- [ ] Run targeted tests; expect missing controls.
- [ ] Implement the controls and a single debounce hook; invalidate only affected query keys.
- [ ] Run targeted tests with fake timers, then lint and typecheck; expect success.
- [ ] Commit with `feat: manage workspaces collections and request drafts`.

### Task 8: Environment variables, settings, and redacted logging

**Files:**
- Create: components under `src/renderer/features/environments` and `settings`; `src/main/security/redact.ts`, `src/main/security/logger.ts`
- Test: environment UI tests and `src/main/security/redact.test.ts`

**Interfaces:**
- Produces: environment manager, variable editor, temporary secret reveal state, settings panel, `redact(value): unknown`, and safe operation logger.

- [ ] Write failing tests for environment selection, variable CRUD, masking/reveal reset, delete confirmation, and absence of a known secret in serialized log output and errors.
- [ ] Run targeted tests; expect missing components/utilities.
- [ ] Implement environment/settings panels and recursive key-based redaction without logging input payloads.
- [ ] Run targeted tests, lint, and typecheck; expect success.
- [ ] Commit with `feat: manage environments and protect secrets`.

### Task 9: Documentation, smoke checks, and delivery

**Files:**
- Create: `README.md`, `docs/architecture.md`, `docs/data-model.md`, `docs/security-boundaries.md`, `docs/milestones.md`, `scripts/database-smoke.ts`, `scripts/main-smoke.ts`, optional `.github/workflows/ci.yml`
- Modify: `package.json`, `.gitignore`
- Test: all existing tests and smoke scripts.

**Interfaces:**
- Produces: documented install/develop/test/build commands and CI executing the same verification path.

- [ ] Add smoke scripts that initialize a temporary database, persist/reopen a workspace, and start the Electron main entry in a controlled smoke mode without opening a long-running window.
- [ ] Write the required documentation, including capabilities, explicit non-capabilities, data location, plain-text secret limitation, architecture, schema, cascades, and milestones.
- [ ] Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:all`, `npm run build`, database smoke, and main smoke; fix root causes without weakening assertions.
- [ ] If the desktop session permits, run `npm run dev`, verify the fixed three-pane UI, CRUD, persistence after restart, and save a screenshot under `docs/screenshots/`; otherwise record the exact limitation.
- [ ] Run `git diff --check`, `git status --short`, `git diff --stat`, and `git ls-files`; verify no database, log, secret, dependency, build, or visual-companion files are tracked.
- [ ] Commit with `docs: document Request Studio milestone 1` and push `main` to the configured origin without force; observe available GitHub Actions.
