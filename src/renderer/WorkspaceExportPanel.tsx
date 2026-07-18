import { useEffect, useState } from 'react'

type WorkspaceSummary = { id: string; name: string }
type WorkspacePreview = {
  format: 'request-studio.workspace'
  version: 1
  workspaceName: string
  counts: { collections: number; requests: number; environments: number }
  warnings: { code: string; message: string }[]
  content: string
  truncated: boolean
}
type Props = {
  workspaces: WorkspaceSummary[]
  initialWorkspaceId: string
  onClose: () => void
}

export default function WorkspaceExportPanel({ workspaces, initialWorkspaceId, onClose }: Props) {
  const initial = workspaces.find((workspace) => workspace.id === initialWorkspaceId) ?? workspaces[0]
  const [workspaceId, setWorkspaceId] = useState(initial?.id ?? '')
  const [previewState, setPreviewState] = useState<{ previewId: string; preview: WorkspacePreview } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  const clear = () => {
    setPreviewState(null)
    setError('')
    setStatus('')
  }
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const generate = async () => {
    if (!workspaceId) return
    setBusy(true)
    clear()
    try {
      const result = await window.requestStudio.workspaceExport.preview({ workspaceId })
      if (result.ok) setPreviewState(result.data)
      else setError(result.error.message)
    } catch {
      setError('Workspace export could not be previewed.')
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
      const result = await window.requestStudio.workspaceExport.save(previewState.previewId)
      if (result.ok) {
        if (result.data.saved) {
          setPreviewState(null)
          setStatus('File saved.')
        } else setStatus('Save canceled.')
      } else setError(result.error.message)
    } catch {
      setError('Workspace export could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const preview = previewState?.preview
  return (
    <section className="modal request-export workspace-export" role="dialog" aria-modal="true" aria-labelledby="workspace-export-title">
      <div className="curl-import-titlebar">
        <div>
          <span className="hint">TOOLS / EXPORT</span>
          <h2 id="workspace-export-title">Export Workspace</h2>
        </div>
        <button autoFocus onClick={onClose}>Close</button>
      </div>

      <div className="row">
        <label>
          Workspace to export
          <select disabled={busy} value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); clear() }}>
            <option value="">Select a workspace</option>
            {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
        </label>
        <button onClick={generate} disabled={!workspaceId || busy}>
          {busy ? 'Working…' : 'Generate Preview'}
        </button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {preview && (
        <>
          <section className="workspace-export-summary" aria-label="Workspace export summary">
            <div><span>Workspace</span><strong>{preview.workspaceName}</strong></div>
            <div><span>Collections</span><strong>{preview.counts.collections}</strong></div>
            <div><span>Requests</span><strong>{preview.counts.requests}</strong></div>
            <div><span>Environments</span><strong>{preview.counts.environments}</strong></div>
          </section>
          {preview.warnings.length > 0 && (
            <section aria-label="Workspace export warnings">
              <h3>Warnings</h3>
              {preview.warnings.map((warning) => <p className="warning" key={warning.code}>{warning.message}</p>)}
            </section>
          )}
          <pre className="export-content" aria-label="Workspace export preview">{preview.content}</pre>
          <div className="row"><span className="spacer" /><button onClick={save} disabled={busy}>Save File</button></div>
        </>
      )}
    </section>
  )
}
