import { describe, expect, it } from 'vitest'
import { environmentRenameSchema, savedRequestInputSchema, variableUpdateSchema, workspaceNameSchema } from './entities'

describe('entity schemas', () => {
  it('rejects a blank workspace name', () => expect(workspaceNameSchema.safeParse({ name: ' ' }).success).toBe(false))
  it('normalizes methods by protocol', () => {
    expect(savedRequestInputSchema.parse({ workspaceId: 'w', collectionId: 'c', name: 'A', protocol: 'http', url: '' }).method).toBe('GET')
    expect(savedRequestInputSchema.parse({ workspaceId: 'w', collectionId: 'c', name: 'A', protocol: 'websocket', method: 'POST', url: '' }).method).toBeNull()
  })
})

it('trims environment names and restricts variable updates', () => {
  expect(environmentRenameSchema.parse({ id: 'e', workspaceId: 'w', name: '  Local  ' }).name).toBe('Local')
  expect(environmentRenameSchema.safeParse({ id: 'e', workspaceId: 'w', name: ' ' }).success).toBe(false)
  expect(variableUpdateSchema.safeParse({ id: 'v', environmentId: 'e', key: 'TOKEN', value: 'x', isSecret: true, description: '', createdAt: 'forbidden' }).success).toBe(false)
})
