// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import App from './App'

it('renders the fixed three-pane milestone shell', () => {
  render(<App />)
  expect(screen.getByRole('navigation', { name: 'Request explorer' })).toBeInTheDocument()
  expect(screen.getByRole('main')).toBeInTheDocument()
  expect(screen.getByRole('complementary', { name: 'Response' })).toHaveTextContent('Send a request to see the response here.')
  expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
})

it('creates an Experiment from the selected request and lists it in the explorer', async () => {
  const create = vi.fn().mockResolvedValue({ ok: true, data: { id: 'experiment-1' } })
  window.requestStudio = {
    workspaces: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'w', name: 'Workspace' }] }) },
    collections: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'c', name: 'API' }] }) },
    savedRequests: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: '00000000-0000-4000-8000-000000000001', name: 'Prompt', protocol: 'http', method: 'GET', url: '', description: '' }] }) },
    experiments: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'experiment-1', name: 'Prompt Test', protocol: 'http', run_count: 1 }] }), create, get: vi.fn().mockResolvedValue({ok:true,data:{experiment:{id:'experiment-1',name:'Prompt Test',protocol:'http'},runs:[]}}) },
    experimentRuns: {},
    streaming: { onEvent: vi.fn() }, http: { onExecutionEvent: vi.fn() },
  }
  vi.spyOn(window, 'prompt').mockReturnValue('Prompt Test')
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'HTTP · Prompt' }))
  fireEvent.click(screen.getByRole('button', { name: 'New Experiment' }))
  await waitFor(() => expect(create).toHaveBeenCalledWith({ workspaceId: 'w', savedRequestId: '00000000-0000-4000-8000-000000000001', name: 'Prompt Test' }))
  expect(await screen.findByRole('button', { name: 'HTTP · Prompt Test · 1 Run' })).toBeInTheDocument()
})

it('opens cURL Import from the Tools menu for the selected workspace', async () => {
  window.requestStudio = {
    workspaces: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'w', name: 'Workspace' }] }) },
    collections: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'c', name: 'API' }] }) },
    savedRequests: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
    experiments: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
    environments: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
    curlImport: { preview: vi.fn(), save: vi.fn() },
    streaming: { onEvent: vi.fn() },
    http: { onExecutionEvent: vi.fn() },
  }
  render(<App />)
  await screen.findByText('API')
  fireEvent.click(await screen.findByRole('button', { name: 'Tools' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Import cURL...' }))
  expect(screen.getByRole('heading', { name: 'Import cURL' })).toBeInTheDocument()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

it('opens and closes Request Export from the Tools menu', async () => {
  window.requestStudio = {
    workspaces: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'w', name: 'Workspace' }] }) },
    collections: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'c', name: 'API' }] }) },
    savedRequests: {
      list: vi.fn().mockResolvedValue({
        ok: true,
        data: [{ id: 'request-id', name: 'Users', protocol: 'http', method: 'GET', url: '', description: '' }],
      }),
    },
    experiments: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
    requestExport: { preview: vi.fn(), save: vi.fn() },
    streaming: { onEvent: vi.fn() },
    http: { onExecutionEvent: vi.fn() },
  }
  render(<App />)
  await screen.findByText('API')
  fireEvent.click(screen.getByRole('button', { name: 'Tools' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Export Request...' }))
  expect(screen.getByRole('dialog', { name: 'Export Request' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog', { name: 'Export Request' })).not.toBeInTheDocument()
})

it('opens and closes Workspace Export from the Tools menu', async () => {
  window.requestStudio = {
    workspaces: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'w', name: 'Workspace' }] }) },
    collections: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
    savedRequests: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
    experiments: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
    workspaceExport: { preview: vi.fn(), save: vi.fn() },
    streaming: { onEvent: vi.fn() },
    http: { onExecutionEvent: vi.fn() },
  }
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'Tools' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Export Workspace...' }))
  expect(screen.getByRole('dialog', { name: 'Export Workspace' })).toBeInTheDocument()
  expect(screen.getByLabelText('Workspace to export')).toHaveValue('w')
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog', { name: 'Export Workspace' })).not.toBeInTheDocument()
})

it('opens and closes Code Generation from the Tools menu with the selected request', async () => {
  window.requestStudio = {
    workspaces: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'w', name: 'Workspace' }] }) },
    collections: { list: vi.fn().mockResolvedValue({ ok: true, data: [{ id: 'c', name: 'API' }] }) },
    savedRequests: {
      list: vi.fn().mockResolvedValue({
        ok: true,
        data: [{ id: 'request-id', name: 'Users', protocol: 'http', method: 'GET', url: '', description: '' }],
      }),
    },
    experiments: { list: vi.fn().mockResolvedValue({ ok: true, data: [] }) },
    codeGeneration: { preview: vi.fn() },
    streaming: { onEvent: vi.fn() },
    http: { onExecutionEvent: vi.fn() },
  }
  render(<App />)
  fireEvent.click(await screen.findByRole('button', { name: 'HTTP · Users' }))
  fireEvent.click(screen.getByRole('button', { name: 'Tools' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Generate Code...' }))
  expect(screen.getByRole('dialog', { name: 'Generate Code' })).toBeInTheDocument()
  expect(screen.getByLabelText('Saved Request')).toHaveValue('request-id')
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog', { name: 'Generate Code' })).not.toBeInTheDocument()
})
