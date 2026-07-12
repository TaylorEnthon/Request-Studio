import { useEffect, useState } from 'react'
export default function StreamHistoryPanel({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [rows, setRows] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(null),
    [protocol, setProtocol] = useState('all')
  const load = async () => {
    const r = await window.requestStudio.streamHistory.list({
      workspaceId,
      protocol: protocol === 'all' ? undefined : protocol,
    })
    if (r.ok) setRows(r.data)
  }
  useEffect(() => {
    void load()
  }, [workspaceId, protocol])
  return (
    <section className="modal history stream-history">
      <div className="row">
        <h2>Streaming History</h2>
        <span className="spacer" />
        <button onClick={onClose}>Close</button>
      </div>
      <div className="row">
        <select aria-label="History protocol" value={protocol} onChange={(e) => setProtocol(e.target.value)}>
          <option value="all">All protocols</option>
          <option value="websocket">WebSocket</option>
          <option value="sse">SSE</option>
        </select>
        <button
          onClick={async () => {
            if (confirm('Clear all streaming history for this workspace?')) {
              await window.requestStudio.streamHistory.clear({ workspaceId })
              setSelected(null)
              void load()
            }
          }}
        >
          Clear all
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="hint">No streaming sessions yet.</p>
      ) : (
        rows.map((row) => (
          <div className="history-row" key={row.id}>
            <button
              onClick={async () => {
                const r = await window.requestStudio.streamHistory.get({ id: row.id, workspaceId })
                if (r.ok) setSelected(r.data)
              }}
            >
              <strong>{String(row.protocol).toUpperCase()}</strong> · {row.request_name || 'Untitled'} · {row.status}
            </button>
            <button
              aria-label={`Delete session ${row.id}`}
              onClick={async () => {
                await window.requestStudio.streamHistory.delete({ id: row.id, workspaceId })
                if (selected?.session?.id === row.id) setSelected(null)
                void load()
              }}
            >
              ×
            </button>
          </div>
        ))
      )}
      {selected && (
        <div className="history-detail">
          <h3>Session Timeline</h3>
          {selected.records.map((r: any) => (
            <article className={`stream-record ${r.direction}`} key={r.id}>
              <header>
                <span>{r.direction}</span>
                <span>{r.data_kind}</span>
                <span className="spacer" />
                {r.byte_length} B
              </header>
              <pre>{r.text_preview}</pre>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
