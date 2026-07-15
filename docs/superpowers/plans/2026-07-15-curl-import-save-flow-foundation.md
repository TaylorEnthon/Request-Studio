# cURL Import Save Flow Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert a safe cURL preview into one Saved Request and optional empty secret-variable slots with scoped ownership checks and atomic SQLite persistence.

**Architecture:** A shared pure mapper validates the save contract, renames sanitized placeholders, and produces a RequestAsset-validated plan. The existing Main-process `Repository` validates workspace ownership and reuses its row creator inside one `better-sqlite3` transaction.

**Tech Stack:** TypeScript, Zod, Vitest, better-sqlite3, Electron/Vite.

## Global Constraints

- Do not add UI, IPC, Preload, migrations, Export, Code Generation, OpenAPI, Compare, or execution changes.
- Do not accept, reconstruct, log, return, or persist raw credentials.
- Variable names must match `[A-Za-z_][A-Za-z0-9_]*` and be at most 100 characters.
- New Environment rows use `value: ''` and `is_secret: 1`.
- Use the existing `Repository.create` method for inserts and one SQLite transaction for the complete write set.
- Do not add dependencies, service classes, repository classes, or re-export files.

---

### Task 1: Pure save contract, mapper, and transactional persistence

**Files:**
- Create: `src/shared/curl/curl-import-save.ts`
- Create: `src/shared/curl/curl-import-save.test.ts`
- Modify: `src/main/repository.ts`
- Modify: `src/main/repository.test.ts`

**Interfaces:**
- Consumes: `CurlImportPreview`, `requestAssetV1Schema`, and the existing `Repository.create(table, values)` method.
- Produces: `mapCurlImportSave(input: CurlImportSaveRequest): CurlImportSavePlan` and `Repository.importCurl(plan: CurlImportSavePlan)`.

- [ ] **Step 1: Write failing mapper tests**

Create `src/shared/curl/curl-import-save.test.ts` with real previews produced by `previewCurlImport`. Cover a normal GET, a POST JSON request, Bearer/API-key renaming, Basic auth, and contract failures:

```ts
import { describe, expect, it } from 'vitest'
import { previewCurlImport } from './curl-import-preview'
import { mapCurlImportSave } from './curl-import-save'

const preview = (input: string) => {
  const result = previewCurlImport(input)
  if (!result.ok) throw new Error('Expected preview')
  return result.preview
}

describe('cURL import save mapper', () => {
  it('maps a GET preview without creating variables', () => {
    const plan = mapCurlImportSave({
      preview: preview('curl https://example.com/users'),
      workspaceId: 'workspace', collectionId: 'collection', name: ' Users ', variableMappings: [],
    })
    expect(plan).toMatchObject({
      workspaceId: 'workspace', collectionId: 'collection', name: 'Users', description: '',
      request: { method: 'GET', url: 'https://example.com/users', auth: { type: 'none' } },
      variables: [],
    })
  })

  it('renames sanitized Bearer and API-key placeholders', () => {
    const source = `curl -H "Authorization: Bearer credential-fixture" -H "X-API-Key: api-fixture" https://example.com`
    const plan = mapCurlImportSave({
      preview: preview(source), workspaceId: 'workspace', collectionId: 'collection',
      environmentId: 'environment', name: 'Auth',
      variableMappings: [
        { placeholder: '{{TOKEN}}', variableName: 'SERVICE_TOKEN' },
        { placeholder: '{{API_KEY}}', variableName: 'SERVICE_API_KEY' },
      ],
    })
    expect(plan.request.auth).toEqual({ type: 'bearer', token: '{{SERVICE_TOKEN}}' })
    expect(plan.request.headers).toContainEqual(expect.objectContaining({ key: 'X-API-Key', value: '{{SERVICE_API_KEY}}' }))
    expect(plan.variables).toEqual([
      { environmentId: 'environment', key: 'SERVICE_TOKEN', value: '', isSecret: true, description: 'Imported from cURL' },
      { environmentId: 'environment', key: 'SERVICE_API_KEY', value: '', isSecret: true, description: 'Imported from cURL' },
    ])
    expect(JSON.stringify(plan)).not.toContain('credential-fixture')
    expect(JSON.stringify(plan)).not.toContain('api-fixture')
  })

  it('preserves POST JSON and maps Basic placeholders', () => {
    const plan = mapCurlImportSave({
      preview: preview(`curl -u user-fixture:password-fixture -H 'Content-Type: application/json' -d '{"name":"Ada"}' https://example.com`),
      workspaceId: 'workspace', collectionId: 'collection', environmentId: 'environment', name: 'Basic',
      variableMappings: [
        { placeholder: '{{BASIC_USERNAME}}', variableName: 'USER' },
        { placeholder: '{{BASIC_PASSWORD}}', variableName: 'PASSWORD' },
      ],
    })
    expect(plan.request).toMatchObject({
      method: 'POST', auth: { type: 'basic', username: '{{USER}}', password: '{{PASSWORD}}' },
      body: { type: 'json', content: '{"name":"Ada"}' },
    })
  })

  it.each([
    { variableMappings: [], message: 'Every sensitive placeholder must be mapped exactly once.' },
    { variableMappings: [{ placeholder: '{{OTHER}}', variableName: 'TOKEN' }], message: 'Variable mapping does not match the preview.' },
    { variableMappings: [{ placeholder: '{{TOKEN}}', variableName: 'invalid-name' }], message: 'Variable name is invalid.' },
  ])('rejects invalid mappings', ({ variableMappings, message }) => {
    expect(() => mapCurlImportSave({
      preview: preview('curl -H "Authorization: Bearer fixture" https://example.com'),
      workspaceId: 'workspace', collectionId: 'collection', environmentId: 'environment', name: 'Auth', variableMappings,
    })).toThrow(message)
  })

  it('requires an Environment for sensitive mappings', () => {
    expect(() => mapCurlImportSave({
      preview: preview('curl -H "Authorization: Bearer fixture" https://example.com'),
      workspaceId: 'workspace', collectionId: 'collection', name: 'Auth',
      variableMappings: [{ placeholder: '{{TOKEN}}', variableName: 'TOKEN' }],
    })).toThrow('Environment is required for sensitive variables.')
  })
})
```

- [ ] **Step 2: Run mapper tests and verify RED**

Run:

```bash
npm test -- src/shared/curl/curl-import-save.test.ts
```

Expected: FAIL because `./curl-import-save` does not exist.

- [ ] **Step 3: Implement the minimum pure mapper**

Create `src/shared/curl/curl-import-save.ts` with readonly input/plan types. Implement only:

```ts
export interface CurlImportVariableMapping {
  readonly placeholder: string
  readonly variableName: string
}

export interface CurlImportSaveRequest {
  readonly preview: CurlImportPreview
  readonly workspaceId: string
  readonly collectionId: string
  readonly environmentId?: string
  readonly name: string
  readonly description?: string
  readonly variableMappings: readonly CurlImportVariableMapping[]
}

export interface CurlImportSavePlan {
  readonly workspaceId: string
  readonly collectionId: string
  readonly name: string
  readonly description: string
  readonly request: CurlImportPreview['request']
  readonly variables: readonly Readonly<{
    environmentId: string
    key: string
    value: ''
    isSecret: true
    description: 'Imported from cURL'
  }>[]
}
```

Use a recursive value transformer that replaces only string values, never object keys. Validate IDs/name, exact placeholder coverage, unique variable names, resolver-compatible names, and Environment presence. Revalidate the transformed request with this fixed envelope:

```ts
requestAssetV1Schema.parse({
  format: 'request-studio.request', version: 1, protocol: 'http',
  name, description, request,
})
```

Return only the HTTP request subtree and empty secret-variable seeds. All thrown messages must be fixed strings and must not interpolate source data.

- [ ] **Step 4: Run mapper and B2.1 regression tests**

Run:

```bash
npm test -- src/shared/curl/curl-import-save.test.ts src/shared/curl/curl-import-preview.test.ts src/shared/curl/curl-parser.test.ts src/shared/assets/request-asset.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Write failing repository tests**

Append tests to `src/main/repository.test.ts`. Add imports for `previewCurlImport` and `mapCurlImportSave`, plus a helper that creates an in-memory workspace, collection, environment, and plan. Verify:

```ts
it('imports a cURL plan atomically through scoped repositories', () => {
  const { db, repo, plan } = setupCurlImport()
  const result = repo.importCurl(plan) as any
  expect(result.request).toMatchObject({ workspace_id: 'w', collection_id: 'c', name: 'Imported', protocol: 'http' })
  expect(JSON.parse(result.request.auth_json)).toEqual({ type: 'bearer', token: '{{SERVICE_TOKEN}}' })
  expect(result.variables).toEqual([expect.objectContaining({ environment_id: 'e', key: 'SERVICE_TOKEN', value: '', is_secret: 1 })])
  expect(JSON.stringify(db.prepare('SELECT * FROM saved_requests').all())).not.toContain('credential-fixture')
  expect(JSON.stringify(db.prepare('SELECT * FROM environment_variables').all())).not.toContain('credential-fixture')
})

it('rejects cross-workspace collection and Environment ownership', () => {
  const { repo, plan } = setupCurlImport()
  expect(() => repo.importCurl({ ...plan, collectionId: 'other-collection' })).toThrow('Collection not found in workspace.')
  expect(() => repo.importCurl({ ...plan, variables: plan.variables.map((value) => ({ ...value, environmentId: 'other-environment' })) })).toThrow('Environment not found in workspace.')
})

it('leaves no Saved Request when variable creation fails', () => {
  const { db, repo, plan } = setupCurlImport()
  repo.create('environment_variables', { environment_id: 'e', key: 'SERVICE_TOKEN', value: '', is_secret: 1, description: '' })
  expect(() => repo.importCurl(plan)).toThrow('cURL import could not be saved.')
  expect(db.prepare('SELECT * FROM saved_requests').all()).toHaveLength(0)
})

it('rolls back variables when Saved Request creation fails', () => {
  const { db, repo, plan } = setupCurlImport()
  db.exec("CREATE TRIGGER reject_curl_import BEFORE INSERT ON saved_requests BEGIN SELECT RAISE(ABORT, 'rejected'); END")
  expect(() => repo.importCurl(plan)).toThrow('cURL import could not be saved.')
  expect(db.prepare('SELECT * FROM environment_variables').all()).toHaveLength(0)
})
```

`setupCurlImport` must create second-workspace collection/environment rows used by the isolation test, produce the preview through `previewCurlImport`, and produce the plan through `mapCurlImportSave`. It must not expose a raw credential to repository inputs.

- [ ] **Step 6: Run repository tests and verify RED**

Run:

```bash
npm test -- src/main/repository.test.ts
```

Expected: FAIL because `Repository.importCurl` does not exist.

- [ ] **Step 7: Implement transactional repository persistence**

Import `CurlImportSavePlan` into `src/main/repository.ts` and add one method:

```ts
importCurl(plan: CurlImportSavePlan) {
  if (!this.db.prepare('SELECT 1 FROM collections WHERE id=? AND workspace_id=?').get(plan.collectionId, plan.workspaceId))
    throw new Error('Collection not found in workspace.')
  if (plan.variables.some((value) =>
    !this.db.prepare('SELECT 1 FROM environments WHERE id=? AND workspace_id=?').get(value.environmentId, plan.workspaceId)))
    throw new Error('Environment not found in workspace.')

  try {
    return this.db.transaction(() => {
      const variables = plan.variables.map((value) => this.create('environment_variables', {
        environment_id: value.environmentId, key: value.key, value: '', is_secret: 1, description: value.description,
      }))
      const request = this.create('saved_requests', {
        workspace_id: plan.workspaceId, collection_id: plan.collectionId, name: plan.name,
        protocol: 'http', method: plan.request.method, url: plan.request.url, description: plan.description,
        params_json: JSON.stringify(plan.request.params), headers_json: JSON.stringify(plan.request.headers),
        auth_json: JSON.stringify(plan.request.auth), body_json: JSON.stringify(plan.request.body),
        settings_json: JSON.stringify(plan.request.settings), stream_config_json: '{}',
      })
      return { request, variables }
    })()
  } catch {
    throw new Error('cURL import could not be saved.')
  }
}
```

Keep the method on the existing repository. Do not add IPC or a second repository abstraction.

- [ ] **Step 8: Run focused tests, lint, and typecheck**

Run:

```bash
npm test -- src/main/repository.test.ts src/shared/curl/curl-import-save.test.ts src/shared/curl/curl-import-preview.test.ts src/shared/curl/curl-parser.test.ts src/shared/assets/request-asset.test.ts
npm run lint
npm run typecheck
git diff --check
```

Expected: all commands PASS and no plaintext credential fixture appears in persisted rows or error output.

- [ ] **Step 9: Commit the implementation**

```bash
git add src/shared/curl/curl-import-save.ts src/shared/curl/curl-import-save.test.ts src/main/repository.ts src/main/repository.test.ts
git diff --cached --check
git commit -m "feat: add curl import save flow foundation"
```

Expected: one implementation commit containing only the four scoped files.

### Task 2: Full verification and delivery closure

**Files:**
- No production files unless a verification failure proves an in-scope defect.

**Interfaces:**
- Consumes: committed B2.2 implementation.
- Produces: verified `main`, synchronized remote, successful CI, and clean temporary worktree state.

- [ ] **Step 1: Run the full local matrix**

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:all
npm run smoke:database
npm run smoke:media
npm run smoke:streaming
npm run smoke:electron
git diff --check
```

Expected: all commands PASS. If Windows MSBuild FileTracker returns `E_ACCESSDENIED`, rerun the unchanged Electron smoke with suitable permission, then run `npm run smoke:database` to restore and verify the Node ABI.

- [ ] **Step 2: Verify CodeGraph and scope**

```bash
codegraph sync
codegraph explore "mapCurlImportSave Repository.importCurl CurlImportPreview requestAssetV1Schema call chain and blast radius"
git diff --stat main...HEAD
git diff --name-only main...HEAD
git status --ignored --short
```

Expected: only the four implementation files differ; CodeGraph is current; ignored runtime/build/index artifacts remain untracked.

- [ ] **Step 3: Integrate, retest, push, and observe CI**

Fast-forward the verified feature branch into `main`, rerun `npm test`, remove the task-owned `.worktrees` worktree and merged local branch, push `main` without force, and watch only the exact final HEAD Actions run until completion.

Expected final state:

```text
HEAD = origin/main
ahead / behind = 0 / 0
working tree clean
CI success
```
