import { expect, it } from 'vitest'
import { redactStreamingValue } from './streaming-redaction'
it('redacts known secret values and credential-shaped JSON keys', () => {
  expect(redactStreamingValue('{"token":"secret","name":"secret"}', ['secret'])).toBe(
    '{"token":"[REDACTED]","name":"[REDACTED]"}',
  )
  expect(redactStreamingValue('Bearer secret', ['secret'])).toBe('Bearer [REDACTED]')
})
