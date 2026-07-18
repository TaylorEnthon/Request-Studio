import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase } from '../src/main/database/database'
import { writeExportFileAtomic } from '../src/main/export/request-export-file'
import { Repository } from '../src/main/repository'
import type { SavedRequestAssetRow } from '../src/shared/assets/request-asset-mapper'
import { mapSavedRequestToExportAsset } from '../src/shared/assets/request-export'
import { createRequestExportPreview } from '../src/shared/assets/request-export-preview'
import {
  mapWorkspaceExportV1,
  serializeWorkspaceExportV1,
  serializeWorkspaceExportV1Chunks,
  workspaceExportV1Schema,
} from '../src/shared/assets/workspace-export'
import { generateCode, listCodeGenerators } from '../src/shared/codegen/code-generation'
import { previewCurlImport } from '../src/shared/curl/curl-import-preview'
import { mapCurlImportSave } from '../src/shared/curl/curl-import-save'

const root = mkdtempSync(join(tmpdir(), 'request-studio-assets-smoke-'))
const userData = join(root, 'user-data')
const output = join(root, 'output')
const credential = ['fixture', 'milestone6', 'secret', 'value'].join('-')
const paths = [
  'C:\\Users\\Example\\secret.txt',
  '/home/example/secret.txt',
  'file:///C:/Users/Example/secret.txt',
  'file:///home/example/secret.txt',
]
const databaseIds = [
  'workspace-db-id',
  'collection-db-id',
  'environment-db-id',
  'history-db-id',
  'experiment-db-id',
  'resource-db-id',
]
const safe = (value: unknown, label: string, excludeIds = false, excludePaths = true) => {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  assert.equal(serialized.includes(credential), false, `${label} exposed the credential fixture`)
  if (excludePaths) {
    for (const path of paths) assert.equal(serialized.includes(path), false, `${label} exposed a local path`)
  }
  if (excludeIds) {
    for (const id of databaseIds) assert.equal(serialized.includes(id), false, `${label} exposed database metadata`)
  }
}

let db: ReturnType<typeof createDatabase> | undefined
try {
  mkdirSync(userData)
  mkdirSync(output)
  db = createDatabase(join(root, 'assets.db'))
  const repo = new Repository(db)
  repo.create('workspaces', { id: databaseIds[0], name: 'Milestone 6 Smoke' })
  repo.create('collections', { id: databaseIds[1], workspace_id: databaseIds[0], name: 'Imported' })
  repo.create('environments', { id: databaseIds[2], workspace_id: databaseIds[0], name: 'Local' })

  const body = JSON.stringify({ password: credential, windows: paths[0], unix: paths[1], windowsUri: paths[2], unixUri: paths[3] })
  const parsed = previewCurlImport(
    `curl -H 'Authorization: Bearer ${credential}' -H 'Content-Type: application/json' -d '${body}' 'https://api.example.test/users?limit=10'`,
  )
  assert.equal(parsed.ok, true, 'cURL preview must succeed')
  if (!parsed.ok) throw new Error('cURL preview must succeed')
  safe(parsed, 'cURL preview', false, false)
  assert.deepEqual(parsed.preview.sensitiveMappings.map(({ placeholder }) => placeholder), ['{{TOKEN}}', '{{PASSWORD}}'])

  const plan = mapCurlImportSave({
    preview: parsed.preview,
    workspaceId: databaseIds[0],
    collectionId: databaseIds[1],
    environmentId: databaseIds[2],
    name: 'Imported Users',
    variableMappings: [
      { placeholder: '{{TOKEN}}', variableName: 'SERVICE_TOKEN' },
      { placeholder: '{{PASSWORD}}', variableName: 'SERVICE_PASSWORD' },
    ],
  })
  safe(plan, 'cURL save plan', false, false)
  const imported = repo.importCurl(plan) as { request: { id: string } }
  const variables = repo.list('environment_variables') as Array<{ value: string; is_secret: number }>
  assert.equal(variables.length, 2)
  assert.equal(variables.every(({ value, is_secret }) => value === '' && is_secret === 1), true)

  const row = repo.getSavedRequestForExport(imported.request.id, databaseIds[0]) as SavedRequestAssetRow
  assert.ok(row)
  safe(row, 'saved request', false, false)
  const asset = mapSavedRequestToExportAsset(row)
  assert.equal(JSON.stringify(asset).includes('{{SERVICE_TOKEN}}'), true)
  assert.equal(JSON.stringify(asset).includes('{{SERVICE_PASSWORD}}'), true)

  const curlExport = createRequestExportPreview(row, 'curl')
  const jsonExport = createRequestExportPreview(row, 'request-json')
  safe(curlExport, 'cURL export', true)
  safe(jsonExport, 'Request JSON export', true)
  assert.equal(curlExport.content.includes("--request 'POST'"), true)
  assert.equal(JSON.parse(jsonExport.content).protocol, 'http')
  const curlFile = join(output, 'request.sh')
  const jsonFile = join(output, 'request.json')
  await writeExportFileAtomic(curlFile, curlExport.content, userData)
  await writeExportFileAtomic(jsonFile, jsonExport.content, userData)
  assert.equal(readFileSync(curlFile, 'utf8'), curlExport.content)
  assert.equal(readFileSync(jsonFile, 'utf8'), jsonExport.content)

  assert.deepEqual(
    listCodeGenerators().map(({ language }) => language),
    ['javascript-fetch', 'python-requests', 'typescript-axios', 'sse-fetch', 'browser-websocket'],
  )
  for (const language of ['javascript-fetch', 'python-requests', 'typescript-axios'] as const) {
    const generated = generateCode(asset, language)
    assert.deepEqual(generated, generateCode(asset, language))
    assert.equal(generated.content.includes('{{SERVICE_TOKEN}}'), true)
    safe(generated, `${language} code`, true)
  }

  db.prepare(`INSERT INTO request_history(id,workspace_id,request_name,method,url_template,resolved_url_redacted,started_at,request_snapshot_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(databaseIds[3], databaseIds[0], 'Excluded history', 'GET', 'https://history.invalid', 'https://history.invalid', '2026-07-18', '{}', '2026-07-18')
  db.prepare('INSERT INTO experiments(id,workspace_id,name,protocol,created_at,updated_at) VALUES(?,?,?,?,?,?)')
    .run(databaseIds[4], databaseIds[0], 'Excluded experiment', 'http', '2026-07-18', '2026-07-18')
  db.prepare(`INSERT INTO response_resources(id,history_id,source,kind,path,byte_length,suggested_filename,warnings_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(databaseIds[5], databaseIds[3], 'response', 'binary', join(root, 'managed.bin'), 0, 'managed.bin', '[]', '2026-07-18')

  const source = repo.getWorkspaceExportSource(databaseIds[0])
  assert.ok(source)
  const bundle = mapWorkspaceExportV1(source)
  assert.equal(workspaceExportV1Schema.safeParse(bundle).success, true)
  assert.equal(bundle.collections[0]?.ref, 'collection-1')
  assert.equal(bundle.requests[0]?.collectionRef, 'collection-1')
  assert.equal(bundle.environments[0]?.variables.every(({ value, isSecret }) => !isSecret || value === ''), true)
  const serialized = serializeWorkspaceExportV1(bundle)
  assert.equal(serialized, serializeWorkspaceExportV1(bundle))
  safe(serialized, 'Workspace bundle', true)
  assert.equal(/history|experiment|resource/i.test(serialized), false)
  const workspaceFile = join(output, 'workspace.json')
  await writeExportFileAtomic(workspaceFile, serializeWorkspaceExportV1Chunks(bundle), userData)
  assert.deepEqual(JSON.parse(readFileSync(workspaceFile, 'utf8')), bundle)
  assert.deepEqual(readdirSync(output).sort(), ['request.json', 'request.sh', 'workspace.json'])
  assert.deepEqual(readdirSync(root).filter((name) => name.endsWith('.tmp')), [])

  db.close()
  db = undefined
  console.log('Milestone 6 assets smoke passed')
} finally {
  if (db?.open) db.close()
  rmSync(root, { recursive: true, force: true })
}
