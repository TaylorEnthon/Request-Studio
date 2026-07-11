# Request Studio Milestone 1 Completion Plan

**Goal:** Close Milestone 1 by completing environment editing, per-workspace environment selection persistence, Windows CI, and trustworthy smoke coverage.

## Constraints

- Keep Electron Main, Preload, and Renderer boundaries unchanged.
- Use `selectedEnvironment:<workspaceId>` app-setting keys; no schema migration.
- Add narrow Zod schemas for environment rename and variable update.
- Keep secrets plaintext-at-rest and document the future `safeStorage` migration.
- Do not add network execution or other Milestone 2 runtime code.

## Tasks

1. Write failing repository and schema tests for rename, variable update, duplicate keys, selection restore/fallback, and workspace isolation.
2. Add focused environment/variable/settings repository methods and explicit IPC/preload contracts.
3. Write failing component tests, then add rename/edit forms with save, cancel, errors, masking, and stable selection.
4. Add temporary-database persistence smoke and the smallest maintainable Electron/renderer smoke available in this environment.
5. Add Windows Node 22 GitHub Actions CI, update documentation, run the full local verification matrix, commit, push, and observe CI to conclusion.
