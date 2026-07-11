import type { z } from 'zod'

export function validate<T>(schema: z.ZodType<T>, input: unknown): { ok: true; data: T } | { ok: false; error: { code: string; category: 'validation'; message: string; retryable: false } } {
  const parsed = schema.safeParse(input)
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, error: { code: 'INVALID_INPUT', category: 'validation', message: 'Please check the highlighted input.', retryable: false } }
}
