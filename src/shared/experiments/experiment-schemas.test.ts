import { expect, it } from 'vitest'
import { compareRunsInputSchema, createExperimentInputSchema, listExperimentsInputSchema } from './experiment-schemas'

it('validates bounded Experiment creation and pagination', () => {
  expect(createExperimentInputSchema.parse({ workspaceId: 'workspace-1', savedRequestId: crypto.randomUUID(), name: 'Latency' }).name).toBe('Latency')
  expect(() => createExperimentInputSchema.parse({ workspaceId: '../escape', savedRequestId: 'bad', name: '' })).toThrow()
  expect(listExperimentsInputSchema.parse({ workspaceId: 'workspace-1' })).toMatchObject({ limit: 25, offset: 0 })
  expect(() => listExperimentsInputSchema.parse({ workspaceId: 'workspace-1', limit: 101 })).toThrow()
})

it('requires two distinct Runs for comparison', () => {
  const id = crypto.randomUUID()
  expect(() => compareRunsInputSchema.parse({ workspaceId: 'workspace-1', leftRunId: id, rightRunId: id })).toThrow()
})
