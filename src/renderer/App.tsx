import { useEffect, useRef, useState } from 'react'
import EnvironmentPanel from './EnvironmentPanel'
import HttpRequestEditor, { type EditableHttpDraft } from './HttpRequestEditor'
import HttpResponsePanel from './HttpResponsePanel'
import HistoryPanel from './HistoryPanel'
import { httpRequestDraftSchema } from '../shared/schemas/http'

type RequestRow = {
  id: string
  name: string
  protocol: 'http' | 'websocket' | 'sse'
  method: string | null
  url: string
  description: string
  params_json?: string
  headers_json?: string
  auth_json?: string
  body_json?: string
  settings_json?: string
}
const api = () => window.requestStudio,
  parse = (value: string | undefined, fallback: any) => {
    try {
      return value ? JSON.parse(value) : fallback
    } catch {
      return fallback
    }
  }
const asDraft = (row: RequestRow, workspaceId: string): EditableHttpDraft => ({
  savedRequestId: row.id,
  workspaceId,
  name: row.name,
  method: (row.method || 'GET') as EditableHttpDraft['method'],
  url: row.url,
  params: parse(row.params_json, []),
  headers: parse(row.headers_json, []),
  auth: parse(row.auth_json, { type: 'none' }),
  body: parse(row.body_json, { type: 'none' }),
  settings: parse(row.settings_json, { timeoutMs: 30000 }),
})

export default function App() {
  const [workspaces, setWorkspaces] = useState<any[]>([]),
    [workspace, setWorkspace] = useState(''),
    [collections, setCollections] = useState<any[]>([]),
    [requests, setRequests] = useState<RequestRow[]>([]),
    [selected, setSelected] = useState<RequestRow | null>(null),
    [draft, setDraft] = useState<EditableHttpDraft | null>(null),
    [status, setStatus] = useState('Saved'),
    [showEnv, setShowEnv] = useState(false),
    [showSettings, setShowSettings] = useState(false),
    [showHistory, setShowHistory] = useState(false),
    [executionId, setExecutionId] = useState(''),
    [executionState, setExecutionState] = useState('idle'),
    [response, setResponse] = useState<any>(null),
    [executionError, setExecutionError] = useState('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const load = async () => {
    if (!window.requestStudio) return
    const w = await api().workspaces.list()
    if (w.ok) {
      setWorkspaces(w.data)
      setWorkspace((x) => x || w.data[0]?.id || '')
    }
  }
  const loadWorkspace = async () => {
    if (!workspace) return
    const [c, r] = await Promise.all([api().collections.list(workspace), api().savedRequests.list(workspace)])
    if (c.ok) setCollections(c.data)
    if (r.ok) setRequests(r.data)
  }
  useEffect(() => {
    void load()
  }, [])
  useEffect(() => {
    void loadWorkspace()
  }, [workspace])
  useEffect(() => {
    if (selected?.protocol === 'http') setDraft(asDraft(selected, workspace))
    else setDraft(null)
  }, [selected, workspace])
  useEffect(() => {
    if (!window.requestStudio?.http) return
    return api().http.onExecutionEvent((event: any) => {
      if (event.executionId !== executionId) return
      if (event.type === 'completed') {
        setExecutionState('completed')
        setResponse(event.data.response)
        setExecutionError('')
        void loadWorkspace()
      } else {
        setExecutionState(event.type)
        setExecutionError(event.error?.message || 'Request failed.')
        void loadWorkspace()
      }
      setExecutionId('')
    })
  }, [executionId])
  const createWorkspace = async () => {
    const name = prompt('Workspace name')
    if (name) {
      await api().workspaces.create({ name })
      void load()
    }
  }
  const renameWorkspace = async () => {
    const current = workspaces.find((w) => w.id === workspace),
      name = current && prompt('Workspace name', current.name)
    if (name) {
      await api().workspaces.rename({ id: workspace, name })
      void load()
    }
  }
  const deleteWorkspace = async () => {
    if (workspace && confirm('Delete this workspace and all related data?')) {
      await api().workspaces.delete({ id: workspace })
      setWorkspace('')
      setSelected(null)
      void load()
    }
  }
  const createCollection = async () => {
    const name = prompt('Collection name')
    if (name && workspace) {
      await api().collections.create({ workspace_id: workspace, name })
      void loadWorkspace()
    }
  }
  const renameCollection = async (c: any) => {
    const name = prompt('Collection name', c.name)
    if (name) {
      await api().collections.rename({ id: c.id, name })
      void loadWorkspace()
    }
  }
  const deleteCollection = async (c: any) => {
    if (confirm('Delete this collection and its requests?')) {
      await api().collections.delete({ id: c.id })
      setSelected(null)
      void loadWorkspace()
    }
  }
  const createRequest = async () => {
    if (!workspace || !collections[0]) return
    const protocol = (prompt('Protocol: http, websocket, or sse', 'http') || 'http') as RequestRow['protocol']
    const r = await api().savedRequests.create({
      workspace_id: workspace,
      collection_id: collections[0].id,
      name: 'New Request',
      protocol,
      method: protocol === 'http' ? 'GET' : null,
      url: '',
      description: '',
    })
    if (r.ok) {
      await loadWorkspace()
      setSelected(r.data)
    }
  }
  const duplicateRequest = async (r: RequestRow) => {
    await api().savedRequests.duplicate({ id: r.id })
    void loadWorkspace()
  }
  const deleteRequest = async (r: RequestRow) => {
    if (confirm('Delete this saved request?')) {
      await api().savedRequests.delete({ id: r.id })
      if (selected?.id === r.id) setSelected(null)
      void loadWorkspace()
    }
  }
  const saveDraft = async (current: EditableHttpDraft) => {
    setStatus('Saving…')
    const result = await api().savedRequests.update({ id: current.savedRequestId, ...current })
    setStatus(result.ok ? 'Saved' : 'Save failed')
    return result
  }
  const changeDraft = (next: EditableHttpDraft) => {
    setDraft(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void saveDraft(next), 350)
  }
  const send = async () => {
    if (!draft || executionId) return
    setExecutionState('validating')
    setExecutionError('')
    setResponse(null)
    const checked = httpRequestDraftSchema.safeParse(draft)
    if (!checked.success) {
      setExecutionState('failed')
      setExecutionError(checked.error.issues[0]?.message || 'Invalid request.')
      return
    }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const saved = await saveDraft(checked.data)
    if (!saved.ok) {
      setExecutionState('failed')
      setExecutionError(saved.error.message)
      return
    }
    setExecutionState('sending')
    const result = await api().http.execute(checked.data)
    if (result.ok) setExecutionId(result.data.executionId)
    else {
      setExecutionState('failed')
      setExecutionError(result.error.message)
    }
  }
  const cancel = async () => {
    if (!executionId) return
    setExecutionState('cancelling')
    await api().http.cancel(executionId)
  }
  return (
    <div className="app">
      <header>
        <strong>Request Studio</strong>
        <select aria-label="Workspace" value={workspace} onChange={(e) => setWorkspace(e.target.value)}>
          <option value="">No workspace</option>
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <button onClick={createWorkspace}>New</button>
        <button onClick={renameWorkspace} disabled={!workspace}>
          Rename
        </button>
        <button onClick={deleteWorkspace} disabled={!workspace}>
          Delete
        </button>
        <span className="spacer" />
        <span>{status}</span>
        <button onClick={() => setShowHistory(true)} disabled={!workspace}>
          History
        </button>
        <button onClick={() => setShowEnv(true)}>Environment</button>
        <button onClick={() => setShowSettings(true)}>Settings</button>
      </header>
      <div className="studio">
        <nav aria-label="Request explorer">
          <div className="pane-title">
            Collections <button onClick={createCollection}>+</button>
          </div>
          {collections.map((c) => (
            <div className="entity" key={c.id}>
              <span>{c.name}</span>
              <button onClick={() => renameCollection(c)}>✎</button>
              <button onClick={() => deleteCollection(c)}>×</button>
            </div>
          ))}
          <div className="pane-title">
            Requests <button onClick={createRequest}>+</button>
          </div>
          {requests.map((r) => (
            <div className="entity" key={r.id}>
              <button className="request" onClick={() => setSelected(r)}>
                {r.protocol.toUpperCase()} · {r.name}
              </button>
              <button onClick={() => duplicateRequest(r)}>⧉</button>
              <button onClick={() => deleteRequest(r)}>×</button>
            </div>
          ))}
        </nav>
        <main>
          {draft ? (
            <>
              <label>
                Name
                <input value={draft.name} onChange={(e) => changeDraft({ ...draft, name: e.target.value })} />
              </label>
              <div className="row">
                <select
                  aria-label="Method"
                  value={draft.method}
                  onChange={(e) => changeDraft({ ...draft, method: e.target.value as EditableHttpDraft['method'] })}
                >
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <input
                  aria-label="URL"
                  placeholder="https://api.example.com"
                  value={draft.url}
                  onChange={(e) => changeDraft({ ...draft, url: e.target.value })}
                />
              </div>
              <HttpRequestEditor draft={draft} onChange={changeDraft} />
              <div className="row">
                {executionId ? (
                  <button onClick={cancel}>{executionState === 'cancelling' ? 'Cancelling…' : 'Cancel'}</button>
                ) : (
                  <button onClick={send}>Send</button>
                )}
                <span>{executionState}</span>
              </div>
            </>
          ) : selected ? (
            <div className="empty">HTTP execution is only available for HTTP requests.</div>
          ) : (
            <div className="empty">
              <h2>Create or select a request</h2>
            </div>
          )}
        </main>
        <HttpResponsePanel response={response} error={executionError} />
      </div>
      {showEnv && <EnvironmentPanel workspaceId={workspace} onClose={() => setShowEnv(false)} />}{' '}
      {showSettings && (
        <section className="modal">
          <h2>Settings</h2>
          <p>Maximum response: 50 MiB · Inline threshold: 10 MiB · History: 500 per workspace</p>
          <button onClick={() => setShowSettings(false)}>Close</button>
        </section>
      )}{' '}
      {showHistory && (
        <HistoryPanel
          workspaceId={workspace}
          collectionId={collections[0]?.id || ''}
          onClose={() => setShowHistory(false)}
          onCreated={loadWorkspace}
          onRerun={(id) => { setExecutionId(id);setExecutionState('sending');setShowHistory(false) }}
        />
      )}
    </div>
  )
}
declare global {
  interface Window {
    requestStudio: any
  }
}
