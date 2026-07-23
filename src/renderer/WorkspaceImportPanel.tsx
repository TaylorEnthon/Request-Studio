import { useEffect, useState } from 'react'

type WorkspaceSummary = { id: string; name: string }
type ImportPreview = {
  format: 'request-studio.workspace'
  version: 1
  workspaceName: string
  counts: { collections: number; requests: number; environments: number; variables: number }
  warnings: { code: string; message: string }[]
  conflicts: { code: string; entity: string; name: string }[]
  blockedOperationCount: number
}
type Props = {
  workspaces: WorkspaceSummary[]
  initialWorkspaceId: string
  onClose: () => void
  onImported: () => void | Promise<void>
}

export default function WorkspaceImportPanel({ workspaces, initialWorkspaceId, onClose, onImported }: Props) {
  const initial = workspaces.find(({ id }) => id === initialWorkspaceId) ?? workspaces[0]
  const [mode, setMode] = useState<'create-workspace' | 'merge-into-workspace'>('create-workspace')
  const [targetWorkspaceId, setTargetWorkspaceId] = useState(initial?.id ?? '')
  const [previewState, setPreviewState] = useState<{ previewId: string; preview: ImportPreview } | null>(null)
  const [stage, setStage] = useState<'preview' | 'confirm' | 'complete'>('preview')
  const [completedCounts, setCompletedCounts] = useState<ImportPreview['counts'] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [busy, onClose])

  const clear = () => {
    setPreviewState(null)
    setStage('preview')
    setCompletedCounts(null)
    setError('')
    setStatus('')
  }
  const selectFile = async () => {
    setBusy(true)
    clear()
    try {
      const input = mode === 'merge-into-workspace' ? { mode, targetWorkspaceId } : { mode }
      const result = await window.requestStudio.workspaceImport.preview(input)
      if (result.ok) {
        if (result.data.selected) setPreviewState(result.data)
        else setStatus('File selection canceled.')
      } else setError(result.error.message)
    } catch {
      setError('Workspace import file could not be previewed.')
    } finally {
      setBusy(false)
    }
  }
  const applyImport = async () => {
    if (!previewState) return
    setBusy(true)
    setError('')
    setStatus('')
    try {
      const result = await window.requestStudio.workspaceImport.apply(previewState.previewId)
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      setCompletedCounts(result.data.counts)
      setPreviewState(null)
      setStage('complete')
      setStatus('Workspace imported successfully.')
      try { await onImported() } catch { /* Import is already committed; a later load can refresh the UI. */ }
    } catch {
      setError('Workspace import could not be applied.')
    } finally {
      setBusy(false)
    }
  }

  const preview = previewState?.preview
  const blocked = Boolean(preview && (preview.conflicts.length || preview.blockedOperationCount))
  return (
    <section className="modal request-export workspace-import" role="dialog" aria-modal="true" aria-labelledby="workspace-import-title">
      <div className="curl-import-titlebar">
        <div><span className="hint">TOOLS / IMPORT</span><h2 id="workspace-import-title">Import Workspace</h2></div>
        <button autoFocus onClick={onClose} disabled={busy}>Close</button>
      </div>

      {stage !== 'complete' && (
        <div className="row">
          <label>
            Import mode
            <select disabled={busy} value={mode} onChange={(event) => { setMode(event.target.value as typeof mode); clear() }}>
              <option value="create-workspace">Create a new Workspace</option>
              <option value="merge-into-workspace" disabled={!workspaces.length}>Merge into current Workspace</option>
            </select>
          </label>
          {mode === 'merge-into-workspace' && (
            <label>
              Target Workspace
              <select disabled={busy} value={targetWorkspaceId} onChange={(event) => { setTargetWorkspaceId(event.target.value); clear() }}>
                {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
              </select>
            </label>
          )}
          <button onClick={selectFile} disabled={busy || (mode === 'merge-into-workspace' && !targetWorkspaceId)}>
            {busy ? 'Working…' : preview ? 'Select Another File' : 'Select Workspace File'}
          </button>
        </div>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      {status && <p role="status">{status}</p>}
      {preview && (
        <>
          <section className="workspace-export-summary workspace-import-summary" aria-label="Workspace import summary">
            <div><span>Workspace</span><strong>{preview.workspaceName}</strong></div>
            <div><span>Collections</span><strong>{preview.counts.collections}</strong></div>
            <div><span>Requests</span><strong>{preview.counts.requests}</strong></div>
            <div><span>Environments</span><strong>{preview.counts.environments}</strong></div>
            <div><span>Variables</span><strong>{preview.counts.variables}</strong></div>
          </section>
          {preview.warnings.length > 0 && (
            <section aria-label="Workspace import warnings">
              <h3>Warnings</h3>
              {preview.warnings.map((warning) => <p className="warning" key={warning.code}>{warning.message}</p>)}
            </section>
          )}
          {preview.conflicts.length > 0 && (
            <section aria-label="Workspace import conflicts">
              <h3>Conflicts</h3>
              <ul>{preview.conflicts.map((conflict) => <li key={`${conflict.code}:${conflict.entity}:${conflict.name}`}>{conflict.name} — {conflict.code}</li>)}</ul>
            </section>
          )}
          {preview.blockedOperationCount > 0 && <p className="warning">{preview.blockedOperationCount} operations are blocked.</p>}
          {stage === 'preview' && <div className="row"><span className="spacer" /><button disabled={blocked || busy} onClick={() => setStage('confirm')}>Continue to Import</button></div>}
          {stage === 'confirm' && (
            <section aria-label="Confirm Workspace import">
              <h3>Confirm Import</h3>
              <p>Secrets will not be restored.</p>
              <p>This operation is transactional and cannot be undone from this dialog.</p>
              <div className="row">
                <button disabled={busy} onClick={() => setStage('preview')}>Back</button>
                <span className="spacer" />
                <button disabled={busy} onClick={applyImport}>{busy ? 'Importing…' : 'Import Workspace'}</button>
              </div>
            </section>
          )}
        </>
      )}
      {stage === 'complete' && completedCounts && (
        <section className="workspace-export-summary workspace-import-summary" aria-label="Imported Workspace counts">
          <div><span>Collections</span><strong>{completedCounts.collections}</strong></div>
          <div><span>Requests</span><strong>{completedCounts.requests}</strong></div>
          <div><span>Environments</span><strong>{completedCounts.environments}</strong></div>
          <div><span>Variables</span><strong>{completedCounts.variables}</strong></div>
        </section>
      )}
    </section>
  )
}
