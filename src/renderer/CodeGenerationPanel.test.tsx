// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import CodeGenerationPanel from './CodeGenerationPanel'

const requests = [
  { id: 'database-http-id', name: 'Users Request', protocol: 'http' as const },
  { id: 'database-websocket-id', name: 'Events Socket', protocol: 'websocket' as const },
  { id: 'database-sse-id', name: 'Events Feed', protocol: 'sse' as const },
]
const generated = {
  language: 'javascript-fetch',
  content: "fetch('https://api.example.com', { headers: { Authorization: 'Bearer {{TOKEN}}' } })",
  warnings: [{ code: 'sanitized-values', severity: 'warning', message: 'Sensitive values were redacted.' }],
}
const capabilities = [
  { language: 'javascript-fetch', displayName: 'JavaScript Fetch', supportedProtocols: ['http'] },
  { language: 'python-requests', displayName: 'Python requests', supportedProtocols: ['http'] },
  { language: 'typescript-axios', displayName: 'TypeScript Axios', supportedProtocols: ['http'] },
  { language: 'sse-fetch', displayName: 'SSE Fetch', supportedProtocols: ['sse'] },
  { language: 'browser-websocket', displayName: 'Browser WebSocket', supportedProtocols: ['websocket'] },
]

const setup = (
  result: any = { ok: true, data: generated },
  listResult: any = { ok: true, data: capabilities },
) => {
  const preview = vi.fn().mockResolvedValue(result)
  const list = vi.fn().mockResolvedValue(listResult)
  window.requestStudio = { codeGeneration: { list, preview } }
  const onClose = vi.fn()
  render(
    <CodeGenerationPanel
      workspaceId="workspace-id"
      requests={requests}
      initialRequestId="database-http-id"
      onClose={onClose}
    />,
  )
  return { list, preview, onClose }
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

it('selects a language and renders only the sanitized generated preview', async () => {
  const { list, preview } = setup()
  await waitFor(() => expect(list).toHaveBeenCalledOnce())
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled())
  expect(screen.getByLabelText('Saved Request')).toHaveValue('database-http-id')
  expect(screen.getByLabelText('Language')).toHaveValue('javascript-fetch')
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'python-requests' } })
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

  expect(await screen.findByLabelText('Generated code')).toHaveTextContent('{{TOKEN}}')
  expect(screen.getByText('Sensitive values were redacted.')).toBeInTheDocument()
  expect(screen.getByText('Sensitive values were redacted.')).toHaveAttribute('data-severity', 'warning')
  expect(preview).toHaveBeenCalledWith({
    workspaceId: 'workspace-id',
    requestId: 'database-http-id',
    language: 'python-requests',
  })
  expect(document.body.textContent).not.toMatch(
    /raw-codegen-secret|C:\\Users|database-http-id|workspace-id/,
  )
})

it('filters capability metadata by protocol and selects the first compatible language', async () => {
  const { preview } = setup()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled())
  expect(screen.queryByRole('option', { name: 'SSE Fetch' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled()

  fireEvent.change(screen.getByLabelText('Saved Request'), {
    target: { value: 'database-websocket-id' },
  })
  expect(screen.getByLabelText('Language')).toHaveValue('browser-websocket')
  expect(screen.getByRole('option', { name: 'Browser WebSocket' })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: 'JavaScript Fetch' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  await waitFor(() => expect(preview).toHaveBeenCalledWith({
    workspaceId: 'workspace-id', requestId: 'database-websocket-id', language: 'browser-websocket',
  }))

  fireEvent.change(screen.getByLabelText('Saved Request'), {
    target: { value: 'database-sse-id' },
  })
  expect(screen.getByLabelText('Language')).toHaveValue('sse-fetch')
  expect(screen.getByRole('option', { name: 'SSE Fetch' })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: 'Browser WebSocket' })).not.toBeInTheDocument()
})

it('loads capabilities safely and disables generation when no compatible generator exists', async () => {
  setup({ ok: true, data: generated }, { ok: false, error: { message: 'private IPC detail' } })
  expect(screen.getByRole('button', { name: 'Generate' })).toBeDisabled()
  expect(await screen.findByRole('alert')).toHaveTextContent('Code generators could not be loaded.')
  expect(document.body.textContent).not.toContain('private IPC detail')
})

it('handles an unavailable capability IPC method with the same fixed error', async () => {
  window.requestStudio = { codeGeneration: { preview: vi.fn() } }
  render(
    <CodeGenerationPanel
      workspaceId="workspace-id"
      requests={requests}
      initialRequestId="database-http-id"
      onClose={vi.fn()}
    />,
  )
  expect(await screen.findByRole('alert')).toHaveTextContent('Code generators could not be loaded.')
})

it('copies exactly the reviewed preview and reports clipboard failure safely', async () => {
  setup()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  await screen.findByLabelText('Generated code')
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(generated.content))
  expect(await screen.findByRole('status')).toHaveTextContent('Copied.')

  vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('private clipboard detail'))
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Generated code could not be copied.')
  expect(document.body.textContent).not.toContain('private clipboard detail')
})

it('clears stale output on selection changes and renders fixed IPC errors', async () => {
  const preview = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, data: generated })
    .mockResolvedValueOnce({ ok: false, error: { message: 'Code could not be generated.' } })
  setup({ ok: true, data: generated })
  window.requestStudio.codeGeneration.preview = preview
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  await screen.findByLabelText('Generated code')
  fireEvent.change(screen.getByLabelText('Saved Request'), {
    target: { value: 'database-websocket-id' },
  })
  expect(screen.queryByLabelText('Generated code')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Code could not be generated.')
})

it('closes on Escape and the Close button without generating', () => {
  const { preview, onClose } = setup()
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(onClose).toHaveBeenCalledTimes(2)
  expect(preview).not.toHaveBeenCalled()
})

it('selects a valid request when the request list arrives or removes the current item', () => {
  window.requestStudio = { codeGeneration: { list: vi.fn().mockResolvedValue({ ok: true, data: capabilities }), preview: vi.fn() } }
  const onClose = vi.fn()
  const view = render(
    <CodeGenerationPanel workspaceId="workspace-id" requests={[]} initialRequestId="database-http-id" onClose={onClose} />,
  )
  expect(screen.getByLabelText('Saved Request')).toHaveValue('')
  view.rerender(
    <CodeGenerationPanel workspaceId="workspace-id" requests={requests} initialRequestId="database-http-id" onClose={onClose} />,
  )
  expect(screen.getByLabelText('Saved Request')).toHaveValue('database-http-id')
  view.rerender(
    <CodeGenerationPanel workspaceId="workspace-id" requests={[requests[1]]} initialRequestId="database-http-id" onClose={onClose} />,
  )
  expect(screen.getByLabelText('Saved Request')).toHaveValue('database-websocket-id')
})

it('discards a delayed preview after the request selection changes', async () => {
  let resolvePreview!: (result: any) => void
  const preview = vi.fn().mockReturnValue(new Promise((resolve) => { resolvePreview = resolve }))
  window.requestStudio = { codeGeneration: { list: vi.fn().mockResolvedValue({ ok: true, data: capabilities }), preview } }
  render(
    <CodeGenerationPanel
      workspaceId="workspace-id"
      requests={requests}
      initialRequestId="database-http-id"
      onClose={vi.fn()}
    />,
  )
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))
  fireEvent.change(screen.getByLabelText('Saved Request'), {
    target: { value: 'database-websocket-id' },
  })
  await act(async () => resolvePreview({ ok: true, data: generated }))
  expect(screen.queryByLabelText('Generated code')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Generate' })).toBeEnabled()
})
