// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import RequestExportPanel from './RequestExportPanel'

const requests = [
  { id: 'database-http-id', name: 'Users Request', protocol: 'http' as const },
  { id: 'database-websocket-id', name: 'Events Socket', protocol: 'websocket' as const },
]
const curlPreview = {
  previewId: '00000000-0000-4000-8000-000000000001',
  preview: {
    format: 'curl',
    protocol: 'http',
    filenameSuggestion: 'users-request.sh',
    content: "curl --header 'Authorization: Bearer {{TOKEN}}'",
    warnings: [{ code: 'sanitized-values', message: 'Sensitive values were redacted.' }],
  },
}

const setup = (overrides: Record<string, unknown> = {}) => {
  const preview = vi.fn().mockResolvedValue({ ok: true, data: curlPreview })
  const save = vi.fn().mockResolvedValue({ ok: true, data: { saved: true } })
  window.requestStudio = { requestExport: { preview, save }, ...overrides }
  const onClose = vi.fn()
  render(
    <RequestExportPanel
      workspaceId="workspace-id"
      requests={requests}
      initialRequestId="database-http-id"
      onClose={onClose}
    />,
  )
  return { preview, save, onClose }
}

it('previews sanitized cURL and saves only the Main-owned preview capability', async () => {
  const { preview, save } = setup()
  expect(screen.getByLabelText('Saved Request')).toHaveValue('database-http-id')
  expect(screen.getByLabelText('Format')).toHaveValue('curl')
  fireEvent.click(screen.getByRole('button', { name: 'Generate Preview' }))

  expect(await screen.findByText('users-request.sh')).toBeInTheDocument()
  expect(screen.getByText('Sensitive values were redacted.')).toBeInTheDocument()
  expect(screen.getByLabelText('Export content')).toHaveTextContent('{{TOKEN}}')
  expect(preview).toHaveBeenCalledWith({
    workspaceId: 'workspace-id',
    requestId: 'database-http-id',
    format: 'curl',
  })

  fireEvent.click(screen.getByRole('button', { name: 'Save File' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith(curlPreview.previewId))
  expect(await screen.findByRole('status')).toHaveTextContent('File saved.')
  expect(screen.queryByRole('button', { name: 'Save File' })).not.toBeInTheDocument()
  expect(document.body.textContent).not.toMatch(
    /raw-export-secret|C:\\\\Users|database-http-id|workspace-id/,
  )
})

it('uses Request JSON for WebSocket, clears stale preview, and reports cancellation', async () => {
  const jsonPreview = {
    previewId: '00000000-0000-4000-8000-000000000002',
    preview: {
      format: 'request-json',
      protocol: 'websocket',
      filenameSuggestion: 'events-socket.request-studio.json',
      content: '{"protocol":"websocket"}\n',
      warnings: [],
    },
  }
  const parse = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, data: curlPreview })
    .mockResolvedValueOnce({ ok: true, data: jsonPreview })
  const save = vi.fn().mockResolvedValue({ ok: true, data: { saved: false } })
  setup({ requestExport: { preview: parse, save } })

  fireEvent.click(screen.getByRole('button', { name: 'Generate Preview' }))
  await screen.findByText('users-request.sh')
  fireEvent.change(screen.getByLabelText('Saved Request'), {
    target: { value: 'database-websocket-id' },
  })
  expect(screen.getByLabelText('Format')).toHaveValue('request-json')
  expect(screen.getByRole('option', { name: 'cURL' })).toBeDisabled()
  expect(screen.queryByText('users-request.sh')).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Generate Preview' }))
  await screen.findByText('events-socket.request-studio.json')
  expect(parse).toHaveBeenLastCalledWith({
    workspaceId: 'workspace-id',
    requestId: 'database-websocket-id',
    format: 'request-json',
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save File' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Save canceled.')
})

it('clears preview on format changes and renders fixed IPC errors', async () => {
  const parse = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, data: curlPreview })
    .mockResolvedValueOnce({ ok: false, error: { message: 'Request export could not be previewed.' } })
  setup({ requestExport: { preview: parse, save: vi.fn() } })
  fireEvent.click(screen.getByRole('button', { name: 'Generate Preview' }))
  await screen.findByText('users-request.sh')
  fireEvent.change(screen.getByLabelText('Format'), { target: { value: 'request-json' } })
  expect(screen.queryByText('users-request.sh')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Generate Preview' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Request export could not be previewed.',
  )
})

it('closes without invoking save', () => {
  const { onClose, save } = setup()
  expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(onClose).toHaveBeenCalledTimes(2)
  expect(save).not.toHaveBeenCalled()
})
