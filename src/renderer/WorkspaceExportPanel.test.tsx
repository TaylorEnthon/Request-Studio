// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import WorkspaceExportPanel from './WorkspaceExportPanel'

const workspaces = [
  { id: 'workspace-a-db-id', name: 'Workspace A' },
  { id: 'workspace-b-db-id', name: 'Workspace B' },
]
const previewState = {
  previewId: '00000000-0000-4000-8000-000000000001',
  preview: {
    format: 'request-studio.workspace',
    version: 1,
    workspaceName: 'Workspace A',
    counts: { collections: 2, requests: 4, environments: 1 },
    warnings: [{ code: 'sanitized-values', message: 'Sensitive values and local file references were sanitized.' }],
    content: '{"format":"request-studio.workspace","workspace":{"name":"Workspace A"}}\n',
    truncated: false,
  },
}

const setup = (overrides: Record<string, unknown> = {}) => {
  const preview = vi.fn().mockResolvedValue({ ok: true, data: previewState })
  const save = vi.fn().mockResolvedValue({ ok: true, data: { saved: true } })
  window.requestStudio = { workspaceExport: { preview, save }, ...overrides }
  const onClose = vi.fn()
  render(
    <WorkspaceExportPanel
      workspaces={workspaces}
      initialWorkspaceId="workspace-a-db-id"
      onClose={onClose}
    />,
  )
  return { preview, save, onClose }
}

it('previews workspace counts and saves only the Main-owned capability', async () => {
  const { preview, save } = setup()
  expect(screen.getByLabelText('Workspace to export')).toHaveValue('workspace-a-db-id')
  fireEvent.click(screen.getByRole('button', { name: 'Generate Preview' }))

  expect(await screen.findByText('Workspace A', { selector: 'strong' })).toBeInTheDocument()
  expect(screen.getByText('2', { selector: 'strong' })).toBeInTheDocument()
  expect(screen.getByText('4', { selector: 'strong' })).toBeInTheDocument()
  expect(screen.getByText('1', { selector: 'strong' })).toBeInTheDocument()
  expect(screen.getByText('Sensitive values and local file references were sanitized.')).toBeInTheDocument()
  expect(screen.getByLabelText('Workspace export preview')).toHaveTextContent('request-studio.workspace')
  expect(preview).toHaveBeenCalledWith({ workspaceId: 'workspace-a-db-id' })

  fireEvent.click(screen.getByRole('button', { name: 'Save File' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith(previewState.previewId))
  expect(await screen.findByRole('status')).toHaveTextContent('File saved.')
  expect(document.body.textContent).not.toMatch(/raw-secret|C:\\\\Users|workspace-a-db-id/)
})

it('clears stale preview when the workspace changes and reports cancellation', async () => {
  const save = vi.fn().mockResolvedValue({ ok: true, data: { saved: false } })
  setup({ workspaceExport: { preview: vi.fn().mockResolvedValue({ ok: true, data: previewState }), save } })
  fireEvent.click(screen.getByRole('button', { name: 'Generate Preview' }))
  await screen.findByLabelText('Workspace export preview')
  fireEvent.change(screen.getByLabelText('Workspace to export'), { target: { value: 'workspace-b-db-id' } })
  expect(screen.queryByLabelText('Workspace export preview')).not.toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Workspace to export'), { target: { value: 'workspace-a-db-id' } })
  fireEvent.click(screen.getByRole('button', { name: 'Generate Preview' }))
  await screen.findByLabelText('Workspace export preview')
  fireEvent.click(screen.getByRole('button', { name: 'Save File' }))
  expect(await screen.findByRole('status')).toHaveTextContent('Save canceled.')
})

it('renders fixed errors and closes on Escape or Close', async () => {
  const { onClose } = setup({
    workspaceExport: {
      preview: vi.fn().mockResolvedValue({ ok: false, error: { message: 'Workspace is not available.' } }),
      save: vi.fn(),
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate Preview' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Workspace is not available.')
  fireEvent.keyDown(window, { key: 'Escape' })
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(onClose).toHaveBeenCalledTimes(2)
})
