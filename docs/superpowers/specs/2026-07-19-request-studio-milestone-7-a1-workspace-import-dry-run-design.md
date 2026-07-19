# Request Studio — Milestone 7 Phase A1 Workspace Import Dry-Run Design

## Status and scope

Phase A1 adds a pure, read-only analysis boundary for current-version Request Studio Workspace bundles. It parses untrusted text, validates `WorkspaceExportV1`, applies semantic and resource checks, compares the bundle with a caller-provided target snapshot, and returns a deterministic `WorkspaceImportDryRun`.

This phase does not read files, access SQLite, call the network, expose IPC or Preload methods, render UI, apply conflict strategies, restore secrets, or mutate Workspace data. It does not change the database schema or the `WorkspaceExportV1` wire format.

## Existing constraints

- `WorkspaceExportV1` is `request-studio.workspace` version `1`.
- Collections have stable `collection-N` references.
- Requests refer to Collections through `collectionRef`.
- Environment variables are nested inside their Environment; Environment, Request, and Variable items have no wire-format reference fields.
- Bundle limits are 1,000 Collections, 10,000 Requests, 100 Environments, 1,000 Variables per Environment, and 1,000,000 serialized characters per Request item.
- Names are trimmed, non-empty, and at most 100 characters.
- `RequestAssetV1` already validates HTTP, WebSocket, and SSE protocol combinations and credential placeholders.
- The runtime resolver accepts variable keys matching `[A-Za-z_][A-Za-z0-9_]*`; the current editing/import boundary limits keys to 100 characters.
- SQLite uniquely constrains only `(environment_id, key)` for the imported entity set. Workspace, Collection, Request, and Environment names are not unique in schema v5.

## Selected approach

Add one shared module beside the existing export contract:

```text
src/shared/assets/workspace-import.ts
src/shared/assets/workspace-import.test.ts
```

The module owns the parser, public contracts, semantic validation, conflict analysis, and operation planning. Keeping this foundation in one pure module avoids speculative Repository, Main, IPC, or UI layers while the functions have no runtime consumer.

Rejected alternatives:

- Extending `WorkspaceExportV1` with Environment, Request, or Variable refs would break the current version 1 format.
- Adding a Repository-aware import service now would introduce an unused privileged layer and conflict with the dry-run-only Phase A1 boundary.

## Input boundary

`parseWorkspaceImportSource(source: unknown)` accepts only already-read text. It returns a discriminated result and never throws an error containing source content.

Pre-parse checks:

- value must be a string;
- trimmed input must be non-empty;
- UTF-8 size, measured with `TextEncoder`, must not exceed 16 MiB.

Post-parse structural checks:

- root must be a non-null, non-array object;
- maximum object/array nesting depth is 64;
- `__proto__`, `prototype`, and `constructor` keys are rejected at every object level;
- top-level format and version are checked before the full schema so unsupported inputs receive stable codes;
- `workspaceExportV1Schema` performs strict unknown-field rejection, element limits, Collection reference integrity, per-Request size checks, and nested `RequestAssetV1` validation.

The 16 MiB source cap is intentionally lower than the theoretical sum of all per-item maxima. It bounds `JSON.parse`, validation, and dry-run memory for a desktop preview while still allowing thousands of ordinary requests. The existing element caps remain defense-in-depth. Phase A2 must not silently raise the source cap; larger real bundles require measured evidence or a streaming parser design.

## Safe error contract

Errors contain only a fixed code and fixed message. They contain no Zod issue payload, source path, bundle fragment, secret, SQL, database identifier, or stack.

Codes used by Phase A1:

- `INVALID_SOURCE_TYPE`
- `EMPTY_SOURCE`
- `INPUT_TOO_LARGE`
- `INVALID_JSON`
- `INVALID_ROOT`
- `UNSAFE_OBJECT_KEY`
- `MAX_DEPTH_EXCEEDED`
- `UNSUPPORTED_FORMAT`
- `UNSUPPORTED_VERSION`
- `ITEM_LIMIT_EXCEEDED`
- `REQUEST_ITEM_TOO_LARGE`
- `DUPLICATE_REFERENCE`
- `INVALID_REFERENCE`
- `INVALID_VARIABLE_NAME`
- `INVALID_SECRET_SLOT`
- `INVALID_REQUEST_ASSET`
- `INVALID_BUNDLE`
- `INVALID_IMPORT_MODE`
- `TARGET_WORKSPACE_REQUIRED`
- `TARGET_WORKSPACE_NOT_FOUND`

## Semantic validation

After strict contract validation, the parser enforces import-specific semantics:

- secret variables must have `value === ''`; a non-empty secret slot is rejected rather than rewritten;
- variable keys must match `/^[A-Za-z_][A-Za-z0-9_]{0,99}$/`;
- duplicate variable keys inside one Environment are rejected using case-sensitive comparison, matching SQLite's default unique constraint;
- Workspace, Collection, Environment, and Request names remain subject to their existing 100-character schemas;
- Request assets continue through `RequestAssetV1`; no import-specific protocol shortcut is added;
- unknown fields reject History, Experiment, Compare, Resource, runtime metadata, database IDs, managed paths, and arbitrary file-reference extensions.

Environment reference and wrong-entity-reference checks are not separately representable in version 1 because variables are structurally nested inside Environments. Duplicate Request references are also not representable because Requests have no source ref field. Phase A1 preserves version 1 instead of inventing incompatible fields.

## Dry-run inputs

`createWorkspaceImportDryRun(bundle, analysis)` consumes a validated bundle and a readonly analysis input.

```ts
type WorkspaceImportAnalysis =
  | {
      readonly mode: 'create-workspace'
      readonly existingWorkspaceNames: readonly string[]
    }
  | {
      readonly mode: 'merge-into-workspace'
      readonly target: WorkspaceImportTargetSnapshot | null
    }
```

The merge snapshot contains only conflict-analysis fields:

- Workspace display name;
- Collection names and their Request names;
- Environment names and their Variable keys.

It contains no database IDs. A caller must scope the snapshot to exactly one Workspace before invoking the pure mapper. `null` means the requested target was not found.

## Dry-run output

`WorkspaceImportDryRun` is readonly, versioned, deterministic, and JSON-serializable:

```ts
type WorkspaceImportDryRun = Readonly<{
  format: 'request-studio.workspace-import-dry-run'
  version: 1
  source: Readonly<{ format: 'request-studio.workspace'; version: 1 }>
  mode: 'create-workspace' | 'merge-into-workspace'
  summary: Readonly<{
    collectionCount: number
    requestCount: number
    environmentCount: number
    variableCount: number
    conflictCount: number
    warningCount: number
  }>
  conflicts: readonly WorkspaceImportConflict[]
  warnings: readonly WorkspaceImportWarning[]
  operations: readonly WorkspaceImportOperation[]
}>
```

The output does not contain the original bundle, request payloads, variable values, target IDs, SQL, stack traces, random values, or resolved secrets. Display names pass through the existing output text sanitizer before entering conflicts or operations.

Because version 1 lacks refs for several entities, Phase A1 creates dry-run-only deterministic refs from validated array positions:

- `request-1`, `request-2`, ...;
- `environment-1`, `environment-2`, ...;
- `environment-1-variable-1`, ... .

These refs are plan-local and do not alter the bundle contract.

## Conflict policy

Name matching for import conflicts uses trimmed, case-folded strings. This is a portable import ambiguity policy, not a new SQLite uniqueness guarantee. It prevents a future apply phase from silently choosing among visually equivalent names while leaving the database unchanged.

Conflict codes and modeled strategies:

| Code | Entity | Available strategies |
| --- | --- | --- |
| `WORKSPACE_NAME_CONFLICT` | Workspace | `skip`, `rename` |
| `COLLECTION_NAME_CONFLICT` | Collection | `skip`, `rename`, `merge` |
| `REQUEST_NAME_CONFLICT` | Request within a matched Collection | `skip`, `rename`, `replace` |
| `ENVIRONMENT_NAME_CONFLICT` | Environment | `skip`, `rename`, `merge` |
| `VARIABLE_NAME_CONFLICT` | Variable within a matched Environment | `skip`, `rename`, `replace` |

Messages are fixed templates. `sourceRef` uses a bundle or plan-local ref. `scopeRef` uses only a plan-local parent ref such as `workspace`, `collection-1`, or `environment-1`; target database IDs are never exposed.

Conflicts are sorted by entity dependency rank, then `sourceRef`, then code. The analyzer never selects or applies a strategy.

## Operation plan

Operation order is always:

1. `create-workspace` in create mode only;
2. `create-collection`;
3. `create-environment`;
4. `create-variable`;
5. `create-request`.

Within a kind, operations sort by `sourceRef`. Each operation contains `index`, `kind`, `sourceRef`, optional `parentSourceRef`, sanitized `displayName`, `status`, and sorted `blockedByConflictCodes`.

A direct conflict blocks its operation. A Workspace conflict blocks every create-mode operation. A Collection conflict blocks child Request operations, and an Environment conflict blocks child Variable operations. Blocked operations remain in the plan and are never silently omitted.

Warnings are modeled as a readonly structured list but are empty for a fully supported version 1 bundle. Security and compatibility failures remain errors, not warnings.

## Purity and security properties

- Both source and target inputs are read-only and never mutated.
- No clock, randomness, filesystem, SQLite, Electron, network, or global mutable state is used.
- Repeated calls with equal source text and equal analysis snapshots return deeply equal results.
- Iterative depth/key inspection avoids recursive traversal of attacker-controlled object graphs.
- Fixed errors prevent bundle, credential, path, SQL, database ID, or stack disclosure.
- Operations and conflicts carry metadata only; they never carry request bodies or variable values.

## Test strategy

One focused Vitest file covers:

- valid version 1 parsing and deterministic dry-runs;
- source type, empty input, malformed JSON, primitive roots, unknown fields, format/version, depth, dangerous keys, source size, item limits, and Request size;
- duplicate/missing Collection refs, invalid RequestAsset, invalid variable keys, duplicate variable keys, and non-empty secret slots;
- create-mode Workspace conflicts;
- merge-mode missing target and Collection/Request/Environment/Variable conflicts;
- multiple conflicts, blocked dependency propagation, operation ordering, and stable output ordering;
- credential and Windows/Unix/file-URI fixtures never appearing in errors, warnings, operations, or serialized dry-run output;
- input/snapshot immutability and repeated-call equality;
- a boundary regression asserting no Workspace import Main IPC, Preload, Renderer, migration, file dialog, or file write module is added.

After focused RED/GREEN cycles, the complete repository validation matrix and Windows CI run unchanged.

## Delivery boundaries

Phase A1 remains dry-run only. It does not provide Workspace Import UI, file selection, IPC, transactional apply, conflict-resolution UI, automatic rename/replace/merge, secret restoration, third-party bundles, OpenAPI/Postman import, Cloud Sync, History/Experiment/Compare/Resource import, or a schema migration. Transactional apply is a Phase A2 design decision after this contract is proven.
