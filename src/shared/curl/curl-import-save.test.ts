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
      workspaceId: 'workspace',
      collectionId: 'collection',
      name: ' Users ',
      variableMappings: [],
    })
    expect(plan).toMatchObject({
      workspaceId: 'workspace',
      collectionId: 'collection',
      name: 'Users',
      description: '',
      request: {
        method: 'GET',
        url: 'https://example.com/users',
        params: [],
        headers: [],
        auth: { type: 'none' },
        body: { type: 'none' },
      },
      variables: [],
    })
  })

  it('renames sanitized Bearer and API-key placeholders', () => {
    const credential = ['save', 'bearer', 'fixture'].join('-')
    const apiKey = ['save', 'api', 'fixture'].join('-')
    const plan = mapCurlImportSave({
      preview: preview(
        `curl -H "Authorization: Bearer ${credential}" -H "X-API-Key: ${apiKey}" https://example.com`,
      ),
      workspaceId: 'workspace',
      collectionId: 'collection',
      environmentId: 'environment',
      name: 'Auth',
      variableMappings: [
        { placeholder: '{{TOKEN}}', variableName: 'SERVICE_TOKEN' },
        { placeholder: '{{API_KEY}}', variableName: 'SERVICE_API_KEY' },
      ],
    })
    expect(plan.request.auth).toEqual({ type: 'bearer', token: '{{SERVICE_TOKEN}}' })
    expect(plan.request.headers).toContainEqual(
      expect.objectContaining({ key: 'X-API-Key', value: '{{SERVICE_API_KEY}}' }),
    )
    expect(plan.variables).toEqual([
      {
        environmentId: 'environment',
        key: 'SERVICE_TOKEN',
        value: '',
        isSecret: true,
        description: 'Imported from cURL',
      },
      {
        environmentId: 'environment',
        key: 'SERVICE_API_KEY',
        value: '',
        isSecret: true,
        description: 'Imported from cURL',
      },
    ])
    expect(JSON.stringify(plan)).not.toContain(credential)
    expect(JSON.stringify(plan)).not.toContain(apiKey)
  })

  it('preserves POST JSON and maps Basic placeholders', () => {
    const username = ['save', 'basic', 'user'].join('-')
    const password = ['save', 'basic', 'password'].join('-')
    const plan = mapCurlImportSave({
      preview: preview(
        `curl -u ${username}:${password} -H 'Content-Type: application/json' -d '{"name":"Ada"}' https://example.com`,
      ),
      workspaceId: 'workspace',
      collectionId: 'collection',
      environmentId: 'environment',
      name: 'Basic',
      variableMappings: [
        { placeholder: '{{BASIC_USERNAME}}', variableName: 'USER' },
        { placeholder: '{{BASIC_PASSWORD}}', variableName: 'PASSWORD' },
      ],
    })
    expect(plan.request).toMatchObject({
      method: 'POST',
      auth: { type: 'basic', username: '{{USER}}', password: '{{PASSWORD}}' },
      body: { type: 'json', content: '{"name":"Ada"}' },
    })
    expect(JSON.stringify(plan)).not.toContain(username)
    expect(JSON.stringify(plan)).not.toContain(password)
  })

  it.each([
    { variableMappings: [], message: 'Every sensitive placeholder must be mapped exactly once.' },
    {
      variableMappings: [{ placeholder: '{{OTHER}}', variableName: 'TOKEN' }],
      message: 'Variable mapping does not match the preview.',
    },
    {
      variableMappings: [{ placeholder: '{{TOKEN}}', variableName: 'invalid-name' }],
      message: 'Variable name is invalid.',
    },
    {
      variableMappings: [
        { placeholder: '{{TOKEN}}', variableName: 'TOKEN' },
        { placeholder: '{{TOKEN}}', variableName: 'TOKEN_2' },
      ],
      message: 'Every sensitive placeholder must be mapped exactly once.',
    },
  ])('rejects invalid mappings', ({ variableMappings, message }) => {
    expect(() =>
      mapCurlImportSave({
        preview: preview('curl -H "Authorization: Bearer fixture" https://example.com'),
        workspaceId: 'workspace',
        collectionId: 'collection',
        environmentId: 'environment',
        name: 'Auth',
        variableMappings,
      }),
    ).toThrow(message)
  })

  it('rejects duplicate variable names', () => {
    expect(() =>
      mapCurlImportSave({
        preview: preview(
          'curl -H "Authorization: Bearer fixture" -H "X-API-Key: fixture" https://example.com',
        ),
        workspaceId: 'workspace',
        collectionId: 'collection',
        environmentId: 'environment',
        name: 'Auth',
        variableMappings: [
          { placeholder: '{{TOKEN}}', variableName: 'CREDENTIAL' },
          { placeholder: '{{API_KEY}}', variableName: 'CREDENTIAL' },
        ],
      }),
    ).toThrow('Variable names must be unique.')
  })

  it('requires an Environment for sensitive mappings', () => {
    expect(() =>
      mapCurlImportSave({
        preview: preview('curl -H "Authorization: Bearer fixture" https://example.com'),
        workspaceId: 'workspace',
        collectionId: 'collection',
        name: 'Auth',
        variableMappings: [{ placeholder: '{{TOKEN}}', variableName: 'TOKEN' }],
      }),
    ).toThrow('Environment is required for sensitive variables.')
  })
})
