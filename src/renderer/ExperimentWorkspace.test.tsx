// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import ExperimentWorkspace from './ExperimentWorkspace'

const run = (id: string, label: string, status = 'completed', value = 1) => ({
  id, label, status, position: value, duration_ms: value * 10,
  request_snapshot_json: JSON.stringify({ version: 1, protocol: 'http', name: label, method: 'GET', url: `https://example.test/${value}`, params: [], headers: [], auth: { type: 'none' }, body: { type: 'none' }, settings: { timeoutMs: 1000 } }),
  result_snapshot_json: JSON.stringify({ status: 200, kind: 'json', text: JSON.stringify({ value }), headers: {}, durationMs: value * 10, sizeBytes: 10 }),
})

beforeEach(() => {
  window.requestStudio = {
    experiments: { get: vi.fn().mockResolvedValue({ ok: true, data: { experiment: { id: 'e', name: 'Latency', protocol: 'http' }, runs: [run('a', 'Run A'), run('b', 'Run B', 'completed', 2)] } }) },
    experimentRuns: { create: vi.fn().mockResolvedValue({ ok: true }), update: vi.fn().mockResolvedValue({ ok: true }), delete: vi.fn().mockResolvedValue({ ok: true }), execute: vi.fn().mockResolvedValue({ ok: true }), compareData: vi.fn().mockResolvedValue({ok:true,data:{left:{run:run('a','Run A'),request:JSON.parse(run('a','Run A').request_snapshot_json),result:JSON.parse(run('a','Run A').result_snapshot_json),records:[],resources:[]},right:{run:run('b','Run B','completed',2),request:JSON.parse(run('b','Run B','completed',2).request_snapshot_json),result:JSON.parse(run('b','Run B','completed',2).result_snapshot_json),records:[],resources:[]}}}) },
  }
})

it('enables Compare only after exactly two completed Runs are selected', async () => {
  render(<ExperimentWorkspace workspaceId="w" experimentId="e" onDeleted={vi.fn()} />)
  expect(await screen.findByRole('heading', { name: 'Latency' })).toBeInTheDocument()
  const compare = screen.getByRole('button', { name: 'Compare selected Runs' })
  expect(compare).toBeDisabled()
  const checks = screen.getAllByRole('checkbox', { name: /Compare Run/ })
  fireEvent.click(checks[0]); fireEvent.click(checks[1])
  expect(compare).toBeEnabled(); fireEvent.click(compare)
  expect(await screen.findByText('$.value')).toBeInTheDocument()
  expect(screen.getByText('$.url')).toBeInTheDocument()
})

it('clones the selected Run and reloads detail', async () => {
  render(<ExperimentWorkspace workspaceId="w" experimentId="e" onDeleted={vi.fn()} />)
  await screen.findByRole('heading', { name: 'Latency' })
  fireEvent.click(screen.getByRole('button', { name: 'Add Run' }))
  await waitFor(() => expect(window.requestStudio.experimentRuns.create).toHaveBeenCalledWith({ workspaceId: 'w', experimentId: 'e', sourceRunId: 'a' }))
})

it('reuses the streaming editor for a WebSocket draft Run', async () => {
  const snapshot = { version: 1, protocol: 'websocket', name: 'Socket', url: 'ws://localhost/socket', params: [], headers: [], auth: { type: 'none' }, streamConfig: { subprotocols: [], connectTimeoutMs: 10000, idleTimeoutMs: 0, pingEnabled: false, pingIntervalMs: 30000, autoReconnect: false, maxReconnectAttempts: 3, reconnectDelayMs: 1000, maxMessageBytes: 1024 } }
  window.requestStudio.experiments.get = vi.fn().mockResolvedValue({ ok: true, data: { experiment: { id: 'e', name: 'Socket Test', protocol: 'websocket' }, runs: [{ id: 'socket-run', label: 'Run A', status: 'draft', request_snapshot_json: JSON.stringify(snapshot) }] } })
  window.requestStudio.experimentRuns.send = vi.fn().mockResolvedValue({ ok: true })
  window.requestStudio.experimentRuns.cancel = vi.fn().mockResolvedValue({ ok: true })
  render(<ExperimentWorkspace workspaceId="w" experimentId="e" onDeleted={vi.fn()} />)
  expect(await screen.findByDisplayValue('ws://localhost/socket')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
})
