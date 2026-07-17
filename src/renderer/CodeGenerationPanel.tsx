import { useEffect, useRef, useState } from 'react'

type RequestSummary = { id: string; name: string; protocol: 'http' | 'websocket' | 'sse' }
type Language = string
type Capability = {
  language: Language
  displayName: string
  supportedProtocols: readonly RequestSummary['protocol'][]
}
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
  const [language, setLanguage] = useState<Language>('')
  const [capabilities, setCapabilities] = useState<Capability[]>([])
  const [loaded, setLoaded] = useState(false)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const generation = useRef(0)

  const clear = () => {
    generation.current += 1
    setPreview(null)
    setBusy(false)
    setError('')
    setStatus('')
  }
  const request = requests.find((item) => item.id === requestId)
  const compatible = request
    ? capabilities.filter((capability) => capability.supportedProtocols.includes(request.protocol))
    : []
  const hasCompatibleLanguage = compatible.some((capability) => capability.language === language)

  useEffect(() => {
    let active = true
    void Promise.resolve()
      .then(() => window.requestStudio.codeGeneration.list())
      .then((result: any) => {
        if (!active) return
        generation.current += 1
        setPreview(null)
        setBusy(false)
        setStatus('')
        if (result.ok) {
          setCapabilities(result.data)
          setError('')
        } else {
          setCapabilities([])
          setError('Code generators could not be loaded.')
        }
        setLoaded(true)
      })
      .catch(() => {
        if (!active) return
        generation.current += 1
        setPreview(null)
        setBusy(false)
        setStatus('')
        setCapabilities([])
        setError('Code generators could not be loaded.')
        setLoaded(true)
      })
    return () => { active = false }
  }, [])
  useEffect(() => {
    const next = requests.find((request) => request.id === initialRequestId)?.id ?? requests[0]?.id ?? ''
    if (!requests.some((request) => request.id === requestId) && requestId !== next) {
      generation.current += 1
      setRequestId(next)
      setPreview(null)
      setBusy(false)
      setError('')
      setStatus('')
    }
  }, [requests, initialRequestId, requestId])
  useEffect(() => {
    generation.current += 1
    setPreview(null)
    setBusy(false)
    setError('')
    setStatus('')
  }, [workspaceId])
  useEffect(() => {
    const next = compatible.some((capability) => capability.language === language)
      ? language
      : compatible[0]?.language ?? ''
    if (next !== language) {
      generation.current += 1
      setLanguage(next)
      setPreview(null)
      setBusy(false)
      setError('')
      setStatus('')
    }
  }, [capabilities, language, request?.protocol])
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const generate = async () => {
    if (!requestId || !hasCompatibleLanguage) return
    clear()
    setBusy(true)
    const current = generation.current
    try {
      const result = await window.requestStudio.codeGeneration.preview({ workspaceId, requestId, language })
      if (current !== generation.current) return
      if (result.ok) setPreview(result.data)
      else setError(result.error.message)
    } catch {
      if (current !== generation.current) return
      setError('Code could not be generated.')
    } finally {
      if (current === generation.current) setBusy(false)
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
          <select value={language} disabled={!loaded || compatible.length === 0} onChange={(event) => { setLanguage(event.target.value); clear() }}>
            {compatible.length === 0 && <option value="">No compatible language</option>}
            {compatible.map((capability) => (
              <option key={capability.language} value={capability.language}>{capability.displayName}</option>
            ))}
          </select>
        </label>
        <button onClick={generate} disabled={!requestId || !loaded || !hasCompatibleLanguage || busy}>{busy ? 'Working…' : 'Generate'}</button>
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
