// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import WorkspaceImportPanel from './WorkspaceImportPanel'

const workspaces = [
  { id: 'workspace-a-db-id', name: 'Workspace A' },
  { id: 'workspace-b-db-id', name: 'Workspace B' },
]
const previewState = {
  selected: true,
  previewId: '00000000-0000-4000-8000-000000000001',
  preview: {
    format: 'request-studio.workspace', version: 1, workspaceName: 'Imported Workspace',
    counts: { collections: 2, requests: 4, environments: 1, variables: 3 },
    warnings: [{ code: 'sanitized-values', message: 'Sensitive values remain empty.' }],
    conflicts: [], blockedOperationCount: 0,
  },
}

const setup = (overrides: Record<string, unknown> = {}) => {
  const preview = vi.fn().mockResolvedValue({ ok: true, data: previewState })
  const apply = vi.fn().mockResolvedValue({
    ok: true,
    data: { mode: 'create-workspace', counts: previewState.preview.counts },
  })
  window.requestStudio = { workspaceImport: { preview, apply }, ...overrides }
  const onClose = vi.fn()
  const onImported = vi.fn().mockResolvedValue(undefined)
  render(<WorkspaceImportPanel workspaces={workspaces} initialWorkspaceId="workspace-a-db-id" onClose={onClose} onImported={onImported} />)
  return { preview, apply, onClose, onImported }
}

it('previews safe counts and requires two confirmation actions before import', async () => {
  const { preview, apply, onImported } = setup()
  expect(screen.getByLabelText('Import mode')).toHaveValue('create-workspace')
  fireEvent.click(screen.getByRole('button', { name: 'Select Workspace File' }))

  expect(await screen.findByText('Imported Workspace', { selector: 'strong' })).toBeInTheDocument()
  expect(screen.getByLabelText('Workspace import summary')).toHaveTextContent('Collections2Requests4Environments1Variables3')
  expect(screen.getByText('Sensitive values remain empty.')).toBeInTheDocument()
  expect(preview).toHaveBeenCalledWith({ mode: 'create-workspace' })

  fireEvent.click(screen.getByRole('button', { name: 'Continue to Import' }))
  expect(screen.getByText('Secrets will not be restored.')).toBeInTheDocument()
  expect(apply).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Import Workspace' }))
  await waitFor(() => expect(apply).toHaveBeenCalledWith(previewState.previewId))
  expect(await screen.findByRole('status')).toHaveTextContent('Workspace imported successfully.')
  expect(onImported).toHaveBeenCalledTimes(1)
  expect(document.body.textContent).not.toMatch(/raw-secret|C:\\Users|workspace-a-db-id|collection-1/)
})

it('previews merge mode against the selected target Workspace', async () => {
  const { preview } = setup()
  fireEvent.change(screen.getByLabelText('Import mode'), { target: { value: 'merge-into-workspace' } })
  expect(screen.getByLabelText('Target Workspace')).toHaveValue('workspace-a-db-id')
  fireEvent.change(screen.getByLabelText('Target Workspace'), { target: { value: 'workspace-b-db-id' } })
  fireEvent.click(screen.getByRole('button', { name: 'Select Workspace File' }))
  await screen.findByText('Imported Workspace', { selector: 'strong' })
  expect(preview).toHaveBeenCalledWith({ mode: 'merge-into-workspace', targetWorkspaceId: 'workspace-b-db-id' })
})

it('shows safe conflicts and disables confirmation for blocked operations', async () => {
  setup({
    workspaceImport: {
      preview: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          ...previewState,
          preview: {
            ...previewState.preview,
            conflicts: [{ code: 'COLLECTION_NAME_CONFLICT', entity: 'collection', name: 'API' }],
            blockedOperationCount: 2,
          },
        },
      }),
      apply: vi.fn(),
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Select Workspace File' }))
  expect(await screen.findByText(/API — COLLECTION_NAME_CONFLICT/)).toBeInTheDocument()
  expect(screen.getByText('2 operations are blocked.')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Continue to Import' })).toBeDisabled()
})

it('handles cancellation and fixed failures without stale preview content', async () => {
  const preview = vi.fn()
    .mockResolvedValueOnce({ ok: true, data: previewState })
    .mockResolvedValueOnce({ ok: true, data: { selected: false } })
    .mockResolvedValueOnce({ ok: false, error: { message: 'Workspace import file could not be read.' } })
  setup({ workspaceImport: { preview, apply: vi.fn() } })
  fireEvent.click(screen.getByRole('button', { name: 'Select Workspace File' }))
  await screen.findByText('Imported Workspace', { selector: 'strong' })
  fireEvent.click(screen.getByRole('button', { name: 'Select Another File' }))
  expect(await screen.findByRole('status')).toHaveTextContent('File selection canceled.')
  expect(screen.queryByText('Imported Workspace', { selector: 'strong' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Select Workspace File' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Workspace import file could not be read.')
})

it('locks controls while pending and closes on Escape when idle', async () => {
  let finishPreview!: (value: unknown) => void
  const { onClose } = setup({
    workspaceImport: {
      preview: vi.fn().mockReturnValue(new Promise((resolve) => { finishPreview = resolve })),
      apply: vi.fn(),
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Select Workspace File' }))
  expect(screen.getByLabelText('Import mode')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled()
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onClose).not.toHaveBeenCalled()
  finishPreview({ ok: true, data: previewState })
  await screen.findByText('Imported Workspace', { selector: 'strong' })
  fireEvent.keyDown(window, { key: 'Escape' })
  expect(onClose).toHaveBeenCalledTimes(1)
})
