import { z } from 'zod'

const workspaceId = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/)
const id = z.string().uuid()
export const listExperimentsInputSchema = z.object({ workspaceId, limit: z.number().int().min(1).max(100).default(25), offset: z.number().int().min(0).default(0) }).strict()
export const createExperimentInputSchema = z.object({ workspaceId, savedRequestId: id, name: z.string().trim().min(1).max(100), description: z.string().trim().max(1000).default('') }).strict()
export const experimentInputSchema = z.object({ workspaceId, id }).strict()
export const renameExperimentInputSchema = experimentInputSchema.extend({ name: z.string().trim().min(1).max(100) }).strict()
export const createRunInputSchema = z.object({ workspaceId, experimentId: id, sourceRunId: id.optional() }).strict()
export const runInputSchema = z.object({ workspaceId, runId: id }).strict()
export const updateRunInputSchema = runInputSchema.extend({ snapshotJson: z.string().min(2).max(2 * 1024 * 1024) }).strict()
export const executeRunInputSchema = runInputSchema.extend({ environmentId: id.nullable().optional() }).strict()
export const sendRunInputSchema = runInputSchema.extend({ kind: z.enum(['text', 'json', 'binary', 'file']), value: z.string().max(50 * 1024 * 1024) }).strict()
export const compareRunsInputSchema = z.object({ workspaceId, leftRunId: id, rightRunId: id }).strict().refine((value) => value.leftRunId !== value.rightRunId, { message: 'Select two different Runs.' })
