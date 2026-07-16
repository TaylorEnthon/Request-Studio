import { useEffect, useState } from 'react'
import type {
  RequestExportFormat,
  RequestExportPreview,
} from '../shared/assets/request-export-preview'

type RequestSummary = { id: string; name: string; protocol: 'http' | 'websocket' | 'sse' }
type Props = {
  workspaceId: string
  requests: RequestSummary[]
  initialRequestId: string
  onClose: () => void
}

export default function RequestExportPanel({ workspaceId, requests, initialRequestId, onClose }: Props) {
  const initial = requests.find((request) => request.id === initialRequestId) ?? requests[0]
  const [requestId, setRequestId] = useState(initial?.id ?? '')
  const [format, setFormat] = useState<RequestExportFormat>(
    initial?.protocol === 'http' ? 'curl' : 'request-json',
  )
  const [previewState, setPreviewState] = useState<{
    previewId: string
    preview: RequestExportPreview
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  const clear = () => {
    setPreviewState(null)
    setError('')
    setStatus('')
  }
  const changeRequest = (nextId: string) => {
    setRequestId(nextId)
    setFormat(requests.find((request) => request.id === nextId)?.protocol === 'http' ? 'curl' : 'request-json')
    clear()
  }
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])
  const generate = async () => {
    if (!requestId) return
    setBusy(true)
    clear()
    try {
      const result = await window.requestStudio.requestExport.preview({ workspaceId, requestId, format })
      if (result.ok) setPreviewState(result.data)
      else setError(result.error.message)
    } catch {
      setError('Request export could not be previewed.')
    } finally {
      setBusy(false)
    }
  }
  const save = async () => {
    if (!previewState) return
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const result = await window.requestStudio.requestExport.save(previewState.previewId)
      if (result.ok) {
        if (result.data.saved) {
          setPreviewState(null)
          setStatus('File saved.')
        } else setStatus('Save canceled.')
      } else setError(result.error.message)
    } catch {
      setError('Request export could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const selected = requests.find((request) => request.id === requestId)
  const preview = previewState?.preview
  return (
    <section className="modal request-export" role="dialog" aria-modal="true" aria-labelledby="request-export-title">
      <div className="curl-import-titlebar">
        <div>
          <span className="hint">TOOLS / EXPORT</span>
          <h2 id="request-export-title">Export Request</h2>
        </div>
        <button autoFocus onClick={onClose}>Close</button>
      </div>

      <div className="row">
        <label>
          Saved Request
          <select value={requestId} onChange={(event) => changeRequest(event.target.value)}>
            <option value="">Select a request</option>
            {requests.map((request) => <option key={request.id} value={request.id}>{request.protocol.toUpperCase()} · {request.name}</option>)}
          </select>
        </label>
        <label>
          Format
          <select
            value={format}
            onChange={(event) => { setFormat(event.target.value as RequestExportFormat); clear() }}
          >
            <option value="curl" disabled={selected?.protocol !== 'http'}>cURL</option>
            <option value="request-json">Request JSON</option>
          </select>
        </label>
        <button onClick={generate} disabled={!requestId || busy}>
          {busy ? 'Working…' : 'Generate Preview'}
        </button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {preview && (
        <>
          <section className="export-preview-meta" aria-label="Export preview details">
            <div><span>Format</span><strong>{preview.format}</strong></div>
            <div><span>Filename</span><strong>{preview.filenameSuggestion}</strong></div>
          </section>
          {preview.warnings.length > 0 && (
            <section>
              <h3>Warnings</h3>
              {preview.warnings.map((warning) => <p className="warning" key={warning.code}>{warning.message}</p>)}
            </section>
          )}
          <pre className="export-content" aria-label="Export content">{preview.content}</pre>
          <div className="row"><span className="spacer" /><button onClick={save} disabled={busy}>Save File</button></div>
        </>
      )}
    </section>
  )
}
