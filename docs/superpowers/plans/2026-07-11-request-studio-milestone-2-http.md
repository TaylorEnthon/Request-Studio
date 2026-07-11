# Request Studio Milestone 2 HTTP Implementation Plan

**Goal:** Deliver a secure Main-process HTTP execution loop with typed editing, cancellation, response viewing, and persistent redacted history.

## Tasks

1. Add strict HTTP configuration schemas/models and RED tests for all auth/body variants, timeout bounds, and forbidden fields.
2. Implement transactional schema v2 migration and RED tests for v1 preservation, defaults, idempotence, history relationships, and rollback.
3. Add pure variable resolver and request builder with RED tests for missing/malformed variables, URL/header/auth/body precedence, JSON validity, and secret-safe summaries.
4. Add controlled file selection/registry and body construction for multipart/binary with path, type, symlink, and size checks.
5. Add response reader, active-execution registry, Main fetch service, cancellation/timeout, history writer, and local Node mock-server integration tests.
6. Register explicit Zod IPC handlers and named Preload APIs for request configuration, execution, cancellation, files, and history.
7. Split Renderer into HTTP request, response, and history components; cover editing, save-before-send, per-request state, cancel, 4xx display, and history actions.
8. Extend database/Electron/HTTP smoke, update Windows CI, security scans, and all project documentation.
9. Run the full verification matrix, update CodeGraph, commit logical slices, merge to main, push, and observe GitHub Actions to a final success or evidenced external blocker.
