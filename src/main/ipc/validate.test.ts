import { expect, it } from 'vitest'
import { workspaceNameSchema } from '../../shared/schemas/entities'
import { validate } from './validate'

it('returns a stable validation error without echoing input', () => {
  const result = validate(workspaceNameSchema, { name: 'secret-invalid-input'.repeat(20) })
  expect(result.ok).toBe(false)
  expect(JSON.stringify(result)).not.toContain('secret-invalid-input')
})
