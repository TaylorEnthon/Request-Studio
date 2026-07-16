// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import CodeGenerationPanel from './CodeGenerationPanel'

const requests = [
  { id: 'database-http-id', name: 'Users Request', protocol: 'http' as const },
  { id: 'database-websocket-id', name: 'Events Socket', protocol: 'websocket' as const },
]
const generated = {
  language: 'javascript-fetch',
  content: "fetch('https://api.example.com', { headers: { Authorization: 'Bearer {{TOKEN}}' } })",
  warnings: [{ code: 'sanitized-values', message: 'Sensitive values were redacted.' }],
}

const setup = (result: any = { ok: true, data: generated }) => {
  const preview = vi.fn().mockResolvedValue(result)
  window.requestStudio = { codeGeneration: { preview } }
  const onClose = vi.fn()
  render(
    <CodeGenerationPanel
      workspaceId="workspace-id"
      requests={requests}
      initialRequestId="database-http-id"
      onClose={onClose}
    />,
  )
  return { preview, onClose }
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  })
})

it('selects a language and renders only the sanitized generated preview', async () => {
  const { preview } = setup()
  expect(screen.getByLabelText('Saved Request')).toHaveValue('database-http-id')
  expect(screen.getByLabelText('Language')).toHaveValue('javascript-fetch')
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'python-requests' } })
  fireEvent.click(screen.getByRole('button', { name: 'Generate' }))

  expect(await screen.findByLabelText('Generated code')).toHaveTextContent('{{TOKEN}}')
  expect(screen.getByText('Sensitive values were redacted.')).toBeInTheDocument()
  expect(preview).toHaveBeenCalledWith({
    workspaceId: 'workspace-id',
    requestId: 'database-http-id',
    language: 'python-requests',
  })
  expect(document.body.textContent).not.toMatch(
    /raw-codegen-secret|C:\\Users|database-http-id|workspace-id/,
  )
})

it('copies exactly the reviewed preview and reports clipboard failure safely', async () => {
  setup()
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
  window.requestStudio = { codeGeneration: { preview: vi.fn() } }
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
