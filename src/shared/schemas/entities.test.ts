import { describe, expect, it } from 'vitest'
import { savedRequestInputSchema, workspaceNameSchema } from './entities'

describe('entity schemas', () => {
  it('rejects a blank workspace name', () => expect(workspaceNameSchema.safeParse({ name: ' ' }).success).toBe(false))
  it('normalizes methods by protocol', () => {
    expect(savedRequestInputSchema.parse({ workspaceId: 'w', collectionId: 'c', name: 'A', protocol: 'http', url: '' }).method).toBe('GET')
    expect(savedRequestInputSchema.parse({ workspaceId: 'w', collectionId: 'c', name: 'A', protocol: 'websocket', method: 'POST', url: '' }).method).toBeNull()
  })
})
