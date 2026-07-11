import { expect, it } from 'vitest'
import { redact } from './redact'

it('redacts nested secret-bearing fields', () => {
  const secret = 'fixture-secret-value'
  expect(JSON.stringify(redact({ token: secret, nested: { cookie: secret }, name: 'safe' }))).not.toContain(secret)
})
