# Request Studio Milestone 6 Phase B2.2 — cURL Import Save Flow Design

## 1. Scope

Phase B2.2 converts a safe Phase B2.1 `CurlImportPreview` into one HTTP Saved Request and optional empty secret-variable slots. It adds no UI, IPC, Preload contract, migration, export, code generation, OpenAPI support, or execution changes.

The one-way flow is:

```text
CurlImportPreview -> mapCurlImportSave -> Repository.importCurl -> SQLite
```

The preview remains persistence-free. The mapper is pure. Only the existing Main-process repository owns database writes.

## 2. Actual Repository Constraints

SQLite schema v5 already contains `saved_requests`, `environments`, and `environment_variables`, foreign keys, and transaction support, so no migration is required.

The generic `Repository.create` method provides the existing row-creation path but does not prove that a collection or environment belongs to the supplied workspace. The dedicated import method must therefore perform scoped ownership checks before reusing `create` inside one transaction.

Phase B1 deliberately discards original credential values before Preview creation. Phase B2.2 does not reconstruct, accept, or persist those values. A future Main-memory secret handoff requires a separate security design.

## 3. File Boundary

Use the minimum existing seams:

- Add `src/shared/curl/curl-import-save.ts` for the readonly save contract and pure mapper.
- Add `src/shared/curl/curl-import-save.test.ts` for mapper and secret-safety tests.
- Extend `src/main/repository.ts` with one transactional `importCurl` method.
- Extend `src/main/repository.test.ts` with ownership, persistence, and rollback tests.

No new repository class, service class, dependency, schema, or thin re-export file is needed.

## 4. Save Contract and Mapper

`CurlImportSaveRequest` contains:

- the approved `CurlImportPreview`;
- `workspaceId` and `collectionId`;
- trimmed Saved Request `name` and optional `description`;
- optional `environmentId`;
- one variable mapping for each sensitive preview placeholder.

Each variable mapping contains only `placeholder` and `variableName`. It has no value field. Variable names use the runtime resolver's placeholder grammar `[A-Za-z_][A-Za-z0-9_]*` and a 100-character maximum.

`mapCurlImportSave` validates that:

- protocol is HTTP;
- name and identifiers are non-empty;
- every preview sensitive placeholder is mapped exactly once;
- no unknown placeholder is mapped;
- mapped variable names are unique;
- an environment is supplied when sensitive mappings exist.

The mapper replaces each sanitized placeholder with `{{variableName}}` throughout request string values, revalidates the result through `requestAssetV1Schema`, and returns a readonly `CurlImportSavePlan`. The plan contains the HTTP request fields plus variable seeds whose value is always the empty string and whose `isSecret` flag is always true.

## 5. Repository Transaction

`Repository.importCurl(plan)` executes one `better-sqlite3` transaction:

1. Confirm the collection exists with both `collection_id` and `workspace_id`.
2. When variables are present, confirm the environment exists with both `environment_id` and `workspace_id`.
3. Create every empty secret variable through the existing `Repository.create` row path.
4. Create the Saved Request through the same row path, serializing params, headers, auth, body, and settings into the existing JSON columns.
5. Return the created Saved Request row and created variable rows.

Foreign-key or uniqueness failures abort the transaction. A variable conflict leaves no Saved Request, and a Saved Request insertion failure leaves no new variable. Existing variables are never overwritten or revealed.

Ownership and persistence errors use fixed messages. They never include cURL text, credential values, request bodies, local paths, or database error details.

## 6. Sensitive-Value Guarantee

The save flow can receive only the sanitized Preview contract. It stores placeholders in Saved Request fields and empty strings in new secret-variable rows. It never accepts a raw token, password, API key, credential hash, credential-derived identifier, or runtime secret mapping.

Bearer, Basic username/password, API-key, sensitive header, query, and body mappings all use the same placeholder-to-variable mechanism. The existing Environment editor may later populate the variable value explicitly; that is outside this phase.

## 7. Tests

Mapper tests cover GET, POST JSON, headers, auth, body, renamed placeholders, Bearer, Basic, API-key, missing/duplicate/unknown mappings, missing environment, and proof that serialized plans contain no credential fixture.

Repository tests use an in-memory v5 database and cover:

- successful Saved Request and empty secret-variable creation;
- RequestAsset-compatible JSON persistence;
- collection/workspace isolation;
- environment/workspace isolation;
- variable-creation failure rolling back the request;
- request-creation failure rolling back variables;
- absence of plaintext credentials in persisted rows and errors.

All Phase B1 parser and Phase B2.1 preview tests remain regression coverage. Implementation follows RED -> GREEN -> refactor, followed by the full lint, typecheck, test, build, database/media/streaming/Electron smoke, and `git diff --check` matrix.

## 8. Impact Boundary

CodeGraph is current and shows the new flow can terminate at the existing `Repository` without touching Renderer, IPC, Preload, HTTP/WebSocket/SSE execution, Compare, or database migrations. The only shared dependency is the existing Preview and RequestAsset validation boundary.
