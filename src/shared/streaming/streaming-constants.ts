export const STREAM_LIMITS = {
  liveRecords: 500,
  dbRecords: 5000,
  sessionsPerWorkspace: 200,
  inlineTextBytes: 64 * 1024,
  wsDefaultMessageBytes: 10 * 1024 * 1024,
  wsHardMessageBytes: 50 * 1024 * 1024,
  sseDefaultEventBytes: 1024 * 1024,
  sseHardEventBytes: 10 * 1024 * 1024,
} as const
