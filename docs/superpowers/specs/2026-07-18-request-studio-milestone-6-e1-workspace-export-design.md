# Request Studio Milestone 6 Phase E1 — Workspace Export Foundation Design

## Decision

Add one shared workspace-export module containing the V1 contract, pure mapper, validation, and chunk serializer. Add one read-only repository method that captures the five source tables for a workspace. No IPC, UI, save dialog, importer, or schema change is part of E1.

```text
SQLite rows
  -> Repository.getWorkspaceExportSource()
  -> mapWorkspaceExportV1()
  -> workspaceExportV1Schema
  -> serializeWorkspaceExportV1Chunks()
```

## Contract

The bundle has fixed top-level fields:

```json
{
  "format": "request-studio.workspace",
  "version": 1,
  "workspace": { "name": "Workspace" },
  "collections": [{ "ref": "collection-1", "name": "API" }],
  "requests": [{ "collectionRef": "collection-1", "asset": {} }],
  "environments": [{ "name": "Local", "variables": [] }]
}
```

`ref` is an export-local positional reference, never a database ID. Raw IDs and timestamps are mapper inputs only and never appear in the contract. Each request is a sanitized `RequestAssetV1`.

## Mapping and ordering

The repository reads only `workspaces`, `collections`, `saved_requests`, `environments`, and `environment_variables`. The mapper validates workspace ownership and relationships, sorts collections/environments by name then source ID, assigns collection refs, sorts requests by collection ref/name/source ID, and sorts variables by key/source ID. This makes repeated export of the same snapshot deterministic.

History, stream sessions/records/resources, response resources, experiments/runs/resources, app settings, and runtime fields have no query or contract field.

## Secret policy

Requests reuse `mapSavedRequestToExportAsset`, preserving placeholders while redacting raw auth, sensitive headers/query values, JSON secrets, and local paths. Environment variables marked secret, or whose key looks sensitive, export with an empty value. Non-secret variable values and descriptions reuse the existing text-output sanitizer so embedded credentials and local filesystem paths are not copied.

## Serializer

`serializeWorkspaceExportV1Chunks()` validates the bundle and yields deterministic compact JSON in structural and per-item chunks. A consumer can write chunks directly without allocating a second whole-bundle string. E1 also exposes a small join helper for tests and bounded callers.

The SQLite snapshot and validated bundle remain in memory because the current repository uses synchronous `better-sqlite3` array reads. Database paging and direct file streaming are deferred until a measured workspace size requires them.

## Errors and limits

Invalid source relationships or invalid request rows throw a fixed `TypeError` without attaching source data. The V1 schema caps collection, request, environment, and variable counts and string sizes to prevent unbounded contract inputs. The large-workspace test exercises the supported request ceiling.

## Non-goals

No UI, workspace import, cloud sync, collaboration, schema migration, history export, experiment export, resource export, filesystem write, or network access.
