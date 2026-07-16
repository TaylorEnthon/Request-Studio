import { useEffect, useState } from 'react'

type Language = 'javascript-fetch' | 'python-requests'
type RequestSummary = { id: string; name: string; protocol: 'http' | 'websocket' | 'sse' }
type Preview = {
  language: Language
  content: string
  warnings: readonly { code: string; message: string }[]
}
type Props = {
  workspaceId: string
  requests: RequestSummary[]
  initialRequestId: string
  onClose: () => void
}

export default function CodeGenerationPanel({ workspaceId, requests, initialRequestId, onClose }: Props) {
  const initial = requests.find((request) => request.id === initialRequestId) ?? requests[0]
  const [requestId, setRequestId] = useState(initial?.id ?? '')
  const [language, setLanguage] = useState<Language>('javascript-fetch')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  const clear = () => {
    setPreview(null)
    setError('')
    setStatus('')
  }
  useEffect(() => {
    const next = requests.find((request) => request.id === initialRequestId)?.id ?? requests[0]?.id ?? ''
    if (!requests.some((request) => request.id === requestId) && requestId !== next) {
      setRequestId(next)
      setPreview(null)
      setError('')
      setStatus('')
    }
  }, [requests, initialRequestId, requestId])
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
      const result = await window.requestStudio.codeGeneration.preview({ workspaceId, requestId, language })
      if (result.ok) setPreview(result.data)
      else setError(result.error.message)
    } catch {
      setError('Code could not be generated.')
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    if (!preview) return
    setError('')
    setStatus('')
    try {
      await navigator.clipboard.writeText(preview.content)
      setStatus('Copied.')
    } catch {
      setError('Generated code could not be copied.')
    }
  }

  return (
    <section className="modal request-export" role="dialog" aria-modal="true" aria-labelledby="code-generation-title">
      <div className="curl-import-titlebar">
        <div>
          <span className="hint">TOOLS / CODE</span>
          <h2 id="code-generation-title">Generate Code</h2>
        </div>
        <button autoFocus onClick={onClose}>Close</button>
      </div>

      <div className="row">
        <label>
          Saved Request
          <select value={requestId} onChange={(event) => { setRequestId(event.target.value); clear() }}>
            <option value="">Select a request</option>
            {requests.map((request) => <option key={request.id} value={request.id}>{request.protocol.toUpperCase()} · {request.name}</option>)}
          </select>
        </label>
        <label>
          Language
          <select value={language} onChange={(event) => { setLanguage(event.target.value as Language); clear() }}>
            <option value="javascript-fetch">JavaScript Fetch</option>
            <option value="python-requests">Python requests</option>
          </select>
        </label>
        <button onClick={generate} disabled={!requestId || busy}>{busy ? 'Working…' : 'Generate'}</button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {preview && (
        <>
          <section className="export-preview-meta" aria-label="Code generation details">
            <div><span>Language</span><strong>{preview.language}</strong></div>
          </section>
          {preview.warnings.length > 0 && (
            <section>
              <h3>Warnings</h3>
              {preview.warnings.map((warning) => <p className="warning" key={warning.code}>{warning.message}</p>)}
            </section>
          )}
          <pre className="export-content" aria-label="Generated code">{preview.content}</pre>
          <div className="row"><span className="spacer" /><button onClick={copy}>Copy</button></div>
        </>
      )}
    </section>
  )
}
