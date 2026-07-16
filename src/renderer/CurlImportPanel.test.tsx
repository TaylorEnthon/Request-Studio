// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import CurlImportPanel from './CurlImportPanel'

const secret = ['fixture', 'secret', 'value'].join('-')
const previewData = {
  previewId: '00000000-0000-4000-8000-000000000001',
  preview: {
    protocol: 'http',
    dialect: 'posix',
    request: {
      method: 'POST',
      url: 'https://example.test/items',
      params: [],
      headers: [{ id: 'h', enabled: true, key: 'Authorization', value: '{{TOKEN}}' }],
      auth: { type: 'bearer', token: '{{TOKEN}}' },
      body: { type: 'json', content: '{"password":"{{PASSWORD}}"}' },
      settings: { timeoutMs: 30000 },
    },
    warnings: [{ code: 'METHOD_INFERRED', message: 'POST was inferred from request data.', severity: 'warning' }],
    sensitiveMappings: [
      { kind: 'bearer-token', placeholder: '{{TOKEN}}', location: 'auth.token', suggestedVariable: 'TOKEN' },
      { kind: 'header-secret', placeholder: '{{PASSWORD}}', location: 'body', suggestedVariable: 'PASSWORD' },
    ],
  },
}

const setup = (overrides: Record<string, unknown> = {}) => {
  const preview = vi.fn().mockResolvedValue({ ok: true, data: previewData })
  const save = vi.fn().mockResolvedValue({
    ok: true,
    data: { request: { id: 'request-1', name: 'Imported API', protocol: 'http' }, variables: [] },
  })
  window.requestStudio = {
    curlImport: { preview, save },
    environments: {
      list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'environment-1', name: 'Local' }] }),
    },
    ...overrides,
  }
  const onClose = vi.fn(), onImported = vi.fn()
  render(
    <CurlImportPanel
      workspaceId="workspace-1"
      collections={[{ id: 'collection-1', name: 'API' }]}
      onClose={onClose}
      onImported={onImported}
    />,
  )
  return { preview, save, onClose, onImported }
}

it('clears raw input and renders only the sanitized preview and warning', async () => {
  const { preview } = setup()
  fireEvent.change(screen.getByLabelText('cURL command'), {
    target: { value: `curl -H 'Authorization: Bearer ${secret}' https://example.test/items` },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Parse Preview' }))

  expect(await screen.findByText('POST')).toBeInTheDocument()
  expect(screen.getByText('https://example.test/items')).toBeInTheDocument()
  expect(screen.getByText('POST was inferred from request data.')).toBeInTheDocument()
  expect(screen.getByText(/Authorization/)).toHaveTextContent('{{TOKEN}}')
  expect(screen.getByText('{"password":"{{PASSWORD}}"}')).toBeInTheDocument()
  expect(screen.getByLabelText('cURL command')).toHaveValue('')
  expect(document.body.textContent).not.toContain(secret)
  expect(preview).toHaveBeenCalledWith({
    source: expect.stringContaining('Bearer'),
    dialect: 'auto',
  })
})

it('validates mappings and imports into the selected destination', async () => {
  const { save, onImported } = setup()
  fireEvent.change(screen.getByLabelText('cURL command'), { target: { value: 'curl https://example.test' } })
  fireEvent.click(screen.getByRole('button', { name: 'Parse Preview' }))
  await screen.findByText('Sensitive mapping')

  const token = screen.getByLabelText('Variable for auth.token')
  fireEvent.change(token, { target: { value: 'bad-name' } })
  expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled()
  fireEvent.change(token, { target: { value: 'API_TOKEN' } })
  fireEvent.change(screen.getByLabelText('Environment'), { target: { value: 'environment-1' } })
  fireEvent.change(screen.getByLabelText('Request name'), { target: { value: 'Imported API' } })
  fireEvent.click(screen.getByRole('button', { name: 'Import' }))

  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      previewId: previewData.previewId,
      workspaceId: 'workspace-1',
      collectionId: 'collection-1',
      environmentId: 'environment-1',
      name: 'Imported API',
      variableMappings: [
        { placeholder: '{{TOKEN}}', variableName: 'API_TOKEN' },
        { placeholder: '{{PASSWORD}}', variableName: 'PASSWORD' },
      ],
    }),
  )
  expect(onImported).toHaveBeenCalledWith({ id: 'request-1', name: 'Imported API', protocol: 'http' })
})

it('shows safe errors and closes without saving', async () => {
  const { onClose } = setup({
    curlImport: {
      preview: vi.fn().mockResolvedValue({
        ok: false,
        error: { message: 'The cURL command could not be previewed.' },
      }),
      save: vi.fn(),
    },
  })
  fireEvent.change(screen.getByLabelText('cURL command'), { target: { value: 'invalid' } })
  fireEvent.click(screen.getByRole('button', { name: 'Parse Preview' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('The cURL command could not be previewed.')
  expect(document.body.textContent).not.toContain(secret)
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(onClose).toHaveBeenCalledOnce()
})
