import { useEffect, useRef, useState } from 'react'
import EnvironmentPanel from './EnvironmentPanel'
import HttpRequestEditor, { type EditableHttpDraft } from './HttpRequestEditor'
import HttpResponsePanel from './HttpResponsePanel'
import HistoryPanel from './HistoryPanel'
import StreamingRequestEditor from './StreamingRequestEditor'
import StreamHistoryPanel from './StreamHistoryPanel'
import ExperimentWorkspace from './ExperimentWorkspace'
import CurlImportPanel from './CurlImportPanel'
import RequestExportPanel from './RequestExportPanel'
import CodeGenerationPanel from './CodeGenerationPanel'
import { httpRequestDraftSchema } from '../shared/schemas/http'
import {
  defaultSseConfig,
  defaultWebSocketConfig,
  sseDraftSchema,
  webSocketDraftSchema,
} from '../shared/streaming/streaming-schemas'

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
  stream_config_json?: string
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
const asStreamDraft = (row: RequestRow, workspaceId: string) => ({
  savedRequestId: row.id,
  workspaceId,
  name: row.name,
  url: row.url,
  params: parse(row.params_json, []),
  headers: parse(row.headers_json, []),
  auth: parse(row.auth_json, { type: 'none' }),
  ...(row.protocol === 'websocket'
    ? { ...defaultWebSocketConfig, ...parse(row.stream_config_json, {}) }
    : { ...defaultSseConfig, ...parse(row.stream_config_json, {}) }),
})

export default function App() {
  const [workspaces, setWorkspaces] = useState<any[]>([]),
    [workspace, setWorkspace] = useState(''),
    [collections, setCollections] = useState<any[]>([]),
    [requests, setRequests] = useState<RequestRow[]>([]),
    [experiments, setExperiments] = useState<any[]>([]),
    [selected, setSelected] = useState<RequestRow | null>(null),
    [selectedExperimentId, setSelectedExperimentId] = useState(''),
    [draft, setDraft] = useState<EditableHttpDraft | null>(null),
    [status, setStatus] = useState('Saved'),
    [showEnv, setShowEnv] = useState(false),
    [showSettings, setShowSettings] = useState(false),
    [showHistory, setShowHistory] = useState(false),
    [showStreamHistory, setShowStreamHistory] = useState(false),
    [showTools, setShowTools] = useState(false),
    [showCurlImport, setShowCurlImport] = useState(false),
    [showRequestExport, setShowRequestExport] = useState(false),
    [showCodeGeneration, setShowCodeGeneration] = useState(false),
    [executionId, setExecutionId] = useState(''),
    [executionState, setExecutionState] = useState('idle'),
    [response, setResponse] = useState<any>(null),
    [executionError, setExecutionError] = useState('')
  const [streamDraft, setStreamDraft] = useState<any>(null),
    [streamState, setStreamState] = useState('closed'),
    [connectionId, setConnectionId] = useState(''),
    [streamRecords, setStreamRecords] = useState<any[]>([]),
    [streamError, setStreamError] = useState('')
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
    const [c, r, e] = await Promise.all([api().collections.list(workspace), api().savedRequests.list(workspace), api().experiments?.list({ workspaceId: workspace, limit: 25, offset: 0 }) ?? Promise.resolve({ok:true,data:[]})])
    if (c.ok) setCollections(c.data)
    if (r.ok) setRequests(r.data)
    if (e.ok) setExperiments(e.data)
  }
  useEffect(() => {
    void load()
  }, [])
  useEffect(() => {
    void loadWorkspace()
  }, [workspace])
  useEffect(() => {
    if (selected?.protocol === 'http') setDraft(asDraft(selected, workspace))
    else {
      setDraft(null)
      setStreamDraft(selected ? asStreamDraft(selected, workspace) : null)
      setStreamState('closed')
      setConnectionId('')
      setStreamRecords([])
      setStreamError('')
    }
  }, [selected, workspace])
  useEffect(() => {
    if (!window.requestStudio?.streaming) return
    return api().streaming.onEvent((event: any) => {
      if (!selected || event.requestId !== selected.id || (connectionId && event.connectionId !== connectionId)) return
      if (event.connectionId) setConnectionId(event.connectionId)
      if (event.type === 'lifecycle') {
        setStreamState(event.state)
        if (event.state === 'failed') setStreamError(event.reason || 'Streaming request failed.')
      } else setStreamRecords((v) => [...v, event.record])
    })
  }, [selected, connectionId])
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
  const createExperiment = async () => {
    if (!workspace || !selected) return
    const name = prompt('Experiment name', `${selected.name} Experiment`)?.trim()
    if (!name) return
    const result = await api().experiments.create({ workspaceId: workspace, savedRequestId: selected.id, name })
    if (result.ok) { await loadWorkspace(); setSelected(null); setSelectedExperimentId(result.data.id) }
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
  const saveStream = async (current: any) => {
    setStatus('Saving…')
    const result = await api().savedRequests.update({ id: current.savedRequestId, ...current })
    setStatus(result.ok ? 'Saved' : 'Save failed')
    return result
  }
  const changeStream = (next: any) => {
    setStreamDraft(next)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void saveStream(next), 350)
  }
  const connectStream = async () => {
    if (!streamDraft || !selected) return
    setStreamError('')
    setStreamRecords([])
    setConnectionId('')
    setStreamState('validating')
    const schema = selected.protocol === 'websocket' ? webSocketDraftSchema : sseDraftSchema,
      result = schema.safeParse(streamDraft)
    if (!result.success) {
      setStreamState('failed')
      setStreamError(result.error.issues[0]?.message || 'Invalid streaming request.')
      return
    }
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const saved = await saveStream(result.data)
    if (!saved.ok) {
      setStreamState('failed')
      setStreamError(saved.error.message)
      return
    }
    setStreamState(selected.protocol === 'websocket' ? 'connecting' : 'streaming')
    const started = await api()[selected.protocol].connect(result.data)
    if (started.ok) setConnectionId(started.data.connectionId)
    else {
      setStreamState('failed')
      setStreamError(started.error.message)
    }
  }
  const stopStream = async () => {
    if (!connectionId || !selected) return
    setStreamState(selected.protocol === 'websocket' ? 'closing' : 'stopping')
    await api()[selected.protocol][selected.protocol === 'websocket' ? 'disconnect' : 'stop'](connectionId)
  }
  const sendStream = async (kind: string, value: string) => {
    if (!connectionId) return
    const result =
      kind === 'text'
        ? await api().websocket.sendText(connectionId, value)
        : kind === 'json'
          ? await api().websocket.sendJson(connectionId, value)
          : kind === 'file'
            ? await api().websocket.sendFile(connectionId, value)
            : await api().websocket.sendBinary(connectionId, value)
    if (!result.ok) setStreamError(result.error.message)
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
        <div className="tools-menu">
          <button
            aria-haspopup="menu"
            aria-expanded={showTools}
            disabled={!workspace}
            onClick={() => setShowTools((value) => !value)}
          >
            Tools
          </button>
          {showTools && (
            <div className="tools-menu-popup" role="menu">
              <button
                role="menuitem"
                onClick={() => {
                  setShowTools(false)
                  setShowCurlImport(true)
                }}
              >
                Import cURL...
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setShowTools(false)
                  setShowRequestExport(true)
                }}
              >
                Export Request...
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setShowTools(false)
                  setShowCodeGeneration(true)
                }}
              >
                Generate Code...
              </button>
            </div>
          )}
        </div>
        <button onClick={() => setShowHistory(true)} disabled={!workspace}>
          HTTP History
        </button>
        <button onClick={() => setShowStreamHistory(true)} disabled={!workspace}>
          Stream History
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
              <button className="request" onClick={() => { setSelectedExperimentId(''); setSelected(r) }}>
                {r.protocol.toUpperCase()} · {r.name}
              </button>
              <button onClick={() => duplicateRequest(r)}>⧉</button>
              <button onClick={() => deleteRequest(r)}>×</button>
            </div>
          ))}
          <div className="pane-title">
            Experiments <button aria-label="New Experiment" disabled={!selected} onClick={createExperiment}>+</button>
          </div>
          {experiments.map((experiment) => (
            <div className="entity" key={experiment.id}>
              <button className="request" onClick={() => { setSelected(null); setSelectedExperimentId(experiment.id) }}>
                {String(experiment.protocol).toUpperCase()} · {experiment.name} · {experiment.run_count} {experiment.run_count === 1 ? 'Run' : 'Runs'}
              </button>
            </div>
          ))}
        </nav>
        <main className={selectedExperimentId ? 'experiment-main' : ''}>
          {selectedExperimentId ? <ExperimentWorkspace workspaceId={workspace} experimentId={selectedExperimentId} onDeleted={() => { setSelectedExperimentId(''); void loadWorkspace() }} /> : draft ? (
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
          ) : selected && streamDraft ? (
            <>
              <StreamingRequestEditor
                protocol={selected.protocol as 'websocket' | 'sse'}
                draft={streamDraft}
                state={streamState}
                records={streamRecords}
                onChange={changeStream}
                onConnect={connectStream}
                onStop={stopStream}
                onSend={sendStream}
              />
              {streamError && (
                <p className="error" role="alert">
                  {streamError}
                </p>
              )}
            </>
          ) : (
            <div className="empty">
              <h2>Create or select a request</h2>
            </div>
          )}
        </main>
        {!selectedExperimentId && <HttpResponsePanel response={response} error={executionError} />}
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
          onRerun={(id) => {
            setExecutionId(id)
            setExecutionState('sending')
            setShowHistory(false)
          }}
        />
      )}
      {showStreamHistory && <StreamHistoryPanel workspaceId={workspace} onClose={() => setShowStreamHistory(false)} />}
      {showCurlImport && (
        <CurlImportPanel
          workspaceId={workspace}
          collections={collections}
          onClose={() => setShowCurlImport(false)}
          onImported={async (request) => {
            await loadWorkspace()
            setSelected(request as RequestRow)
            setSelectedExperimentId('')
            setShowCurlImport(false)
          }}
        />
      )}
      {showRequestExport && (
        <RequestExportPanel
          workspaceId={workspace}
          requests={requests}
          initialRequestId={selected?.id ?? ''}
          onClose={() => setShowRequestExport(false)}
        />
      )}
      {showCodeGeneration && (
        <CodeGenerationPanel
          workspaceId={workspace}
          requests={requests}
          initialRequestId={selected?.id ?? ''}
          onClose={() => setShowCodeGeneration(false)}
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
