import { useEffect, useState } from 'react'
export default function HistoryPanel({
  workspaceId,
  collectionId,
  onClose,
  onCreated,
  onRerun,
}: {
  workspaceId: string
  collectionId: string
  onClose: () => void
  onCreated: () => void
  onRerun: (executionId: string) => void
}) {
  const [rows, setRows] = useState<any[]>([]),
    [selected, setSelected] = useState<any>(null)
  const load = async () => {
    const r = await window.requestStudio.history.list(workspaceId)
    if (r.ok) setRows(r.data)
  }
  useEffect(() => {
    void load()
  }, [workspaceId])
  return (
    <section className="modal history" aria-label="Request history">
      <div className="pane-title">
        <h2>History</h2>
        <button onClick={onClose}>Close</button>
      </div>
      <button
        onClick={async () => {
          if (confirm('Clear all request history?')) {
            await window.requestStudio.history.clear(workspaceId)
            setSelected(null)
            void load()
          }
        }}
        disabled={!rows.length}
      >
        Clear all
      </button>
      {rows.map((row) => (
        <div className="history-row" key={row.id}>
          <button onClick={() => setSelected(row)}>
            {row.method} {row.request_name} · {row.status_code ?? (row.error_json ? 'Error' : '')}
          </button>
          <button
            aria-label={`Delete history ${row.id}`}
            onClick={async () => {
              await window.requestStudio.history.delete(row.id, workspaceId)
              void load()
            }}
          >
            ×
          </button>
        </div>
      ))}
      {selected && (
        <div className="editor">
          <h3>{selected.request_name}</h3>
          <pre>{JSON.stringify(JSON.parse(selected.request_snapshot_json), null, 2)}</pre>
          <button onClick={async () => { const r=await window.requestStudio.history.rerun(selected.id,workspaceId);if(r.ok)onRerun(r.data.executionId) }}>Rerun</button>
          <button
            disabled={!collectionId}
            onClick={async () => {
              const r = await window.requestStudio.history.createRequest({ id: selected.id, workspaceId, collectionId })
              if (r.ok) onCreated()
            }}
          >
            Create saved request
          </button>
        </div>
      )}
    </section>
  )
}
