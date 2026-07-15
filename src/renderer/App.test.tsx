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
