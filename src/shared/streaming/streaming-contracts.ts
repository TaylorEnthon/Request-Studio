export type StreamProtocol = 'websocket' | 'sse'
export type StreamState =
  | 'validating'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closing'
  | 'closed'
  | 'streaming'
  | 'stopping'
  | 'stopped'
  | 'completed'
  | 'failed'
export type StreamLifecycleEvent = {
  type: 'lifecycle'
  protocol: StreamProtocol
  connectionId: string
  sessionId: string
  requestId: string
  state: StreamState
  timestamp: number
  attempt?: number
  negotiatedProtocol?: string
  closeCode?: number
  reason?: string
  metrics?: Record<string, number | string | null>
}
export type StreamRecordEvent = {
  type: 'record'
  protocol: StreamProtocol
  connectionId: string
  sessionId: string
  requestId: string
  record: {
    id: string
    sequence: number
    direction: 'system' | 'inbound' | 'outbound'
    recordType: 'lifecycle' | 'message' | 'event'
    dataKind: 'text' | 'json' | 'binary'
    timestamp: number
    byteLength: number
    preview: string
    resourceId?: string
    eventName?: string
    eventId?: string
    retryMs?: number | null
    outcome?: 'sent' | 'received' | 'failed'
  }
}
export type StreamingEvent = StreamLifecycleEvent | StreamRecordEvent
