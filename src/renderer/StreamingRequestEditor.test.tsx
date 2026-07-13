// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import StreamingRequestEditor from './StreamingRequestEditor'
import { defaultWebSocketConfig } from '../shared/streaming/streaming-schemas'

describe('StreamingRequestEditor', () => {
  it('composes and sends WebSocket text messages while open', () => {
    const onSend = vi.fn()
    render(
      <StreamingRequestEditor
        protocol="websocket"
        draft={{
          savedRequestId: 'r',
          workspaceId: 'w',
          name: 'Echo',
          url: 'ws://localhost',
          params: [],
          headers: [],
          auth: { type: 'none' },
          ...defaultWebSocketConfig,
        }}
        state="open"
        records={[]}
        onChange={vi.fn()}
        onConnect={vi.fn()}
        onStop={vi.fn()}
        onSend={onSend}
      />,
    )
    fireEvent.change(screen.getByLabelText('Message payload'), { target: { value: 'hello' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(onSend).toHaveBeenCalledWith('text', 'hello')
  })

  it('does not expose a composer for SSE', () => {
    render(
      <StreamingRequestEditor
        protocol="sse"
        draft={{}}
        state="streaming"
        records={[]}
        onChange={vi.fn()}
        onConnect={vi.fn()}
        onStop={vi.fn()}
        onSend={vi.fn()}
      />,
    )
    expect(screen.queryByLabelText('Message payload')).toBeNull()
    expect(screen.getByRole('button', { name: 'Stop stream' })).toBeTruthy()
  })
})
