import { useEffect, useState } from 'react'

const addEntry = () => ({ id: crypto.randomUUID(), enabled: true, key: '', value: '', description: '' })
function Entries({ label, entries, onChange }: { label: string; entries: any[]; onChange: (v: any[]) => void }) {
  return (
    <div>
      <button onClick={() => onChange([...entries, addEntry()])}>Add {label}</button>
      {entries.map((x, i) => (
        <div className="kv" key={x.id}>
          <input
            aria-label={`${label} enabled ${i}`}
            type="checkbox"
            checked={x.enabled}
            onChange={(e) => onChange(entries.map((y) => (y.id === x.id ? { ...y, enabled: e.target.checked } : y)))}
          />
          <input
            aria-label={`${label} key ${i}`}
            placeholder="Key"
            value={x.key}
            onChange={(e) => onChange(entries.map((y) => (y.id === x.id ? { ...y, key: e.target.value } : y)))}
          />
          <input
            aria-label={`${label} value ${i}`}
            placeholder="Value"
            type={/authorization|cookie|token|api.?key/i.test(x.key) ? 'password' : 'text'}
            value={x.value}
            onChange={(e) => onChange(entries.map((y) => (y.id === x.id ? { ...y, value: e.target.value } : y)))}
          />
          <button aria-label={`Delete ${label} ${i}`} onClick={() => onChange(entries.filter((y) => y.id !== x.id))}>
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
export default function StreamingRequestEditor({
  protocol,
  draft,
  state,
  records,
  onChange,
  onConnect,
  onStop,
  onSend,
}: {
  protocol: 'websocket' | 'sse'
  draft: any
  state: string
  records: any[]
  onChange: (v: any) => void
  onConnect: () => void
  onStop: () => void
  onSend: (kind: string, value: string) => void
}) {
  const [tab, setTab] = useState('Messages'),
    [kind, setKind] = useState('text'),
    [payload, setPayload] = useState(''),
    [templates, setTemplates] = useState<any[]>([])
  const loadTemplates = async () => {
    if (!window.requestStudio?.streamTemplates || !draft.savedRequestId) return
    const r = await window.requestStudio.streamTemplates.list(draft.savedRequestId)
    if (r.ok) setTemplates(r.data)
  }
  useEffect(() => {
    void loadTemplates()
  }, [draft.savedRequestId])
  const active = ['connecting', 'open', 'reconnecting', 'streaming', 'closing', 'stopping'].includes(state)
  return (
    <>
      <label>
        Name
        <input value={draft.name || ''} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
      </label>
      <div className="row">
        <span className={`protocol-badge ${protocol}`}>{protocol === 'websocket' ? 'WS' : 'SSE'}</span>
        {protocol === 'sse' && (
          <select
            aria-label="SSE method"
            value={draft.method || 'GET'}
            onChange={(e) =>
              onChange({
                ...draft,
                method: e.target.value,
                body: e.target.value === 'GET' ? { type: 'none' } : draft.body,
              })
            }
          >
            <option>GET</option>
            <option>POST</option>
          </select>
        )}
        <input
          aria-label="URL"
          placeholder={protocol === 'websocket' ? 'wss://echo.example.com' : 'https://events.example.com'}
          value={draft.url || ''}
          onChange={(e) => onChange({ ...draft, url: e.target.value })}
        />
        <button
          aria-label={
            active
              ? protocol === 'sse'
                ? 'Stop stream'
                : 'Disconnect'
              : protocol === 'sse'
                ? 'Start stream'
                : 'Connect'
          }
          className="primary"
          onClick={active ? onStop : onConnect}
        >
          {active ? (protocol === 'sse' ? 'Stop' : 'Disconnect') : protocol === 'sse' ? 'Start' : 'Connect'}
        </button>
      </div>
      <div className="stream-status">
        <i className={state} />
        <strong>{state}</strong>
        <span>{records.length} records</span>
      </div>
      <div className="tabs">
        {['Messages', 'Params', 'Headers', 'Auth', 'Settings'].map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Params' && (
        <Entries label="Param" entries={draft.params || []} onChange={(params) => onChange({ ...draft, params })} />
      )}{' '}
      {tab === 'Headers' && (
        <Entries label="Header" entries={draft.headers || []} onChange={(headers) => onChange({ ...draft, headers })} />
      )}{' '}
      {tab === 'Auth' && (
        <div className="editor">
          <select
            aria-label="Auth type"
            value={draft.auth?.type || 'none'}
            onChange={(e) =>
              onChange({
                ...draft,
                auth: e.target.value === 'bearer' ? { type: 'bearer', token: '' } : { type: 'none' },
              })
            }
          >
            <option value="none">No Auth</option>
            <option value="bearer">Bearer Token</option>
          </select>
          {draft.auth?.type === 'bearer' && (
            <input
              aria-label="Bearer token"
              type="password"
              value={draft.auth.token}
              onChange={(e) => onChange({ ...draft, auth: { ...draft.auth, token: e.target.value } })}
            />
          )}
        </div>
      )}
      {tab === 'Settings' && (
        <div className="settings-grid">
          {protocol === 'websocket' ? (
            <>
              <label>
                Subprotocols
                <input
                  value={(draft.subprotocols || []).join(', ')}
                  onChange={(e) =>
                    onChange({
                      ...draft,
                      subprotocols: e.target.value
                        .split(',')
                        .map((x) => x.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!draft.autoReconnect}
                  onChange={(e) => onChange({ ...draft, autoReconnect: e.target.checked })}
                />{' '}
                Auto reconnect
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!draft.pingEnabled}
                  onChange={(e) => onChange({ ...draft, pingEnabled: e.target.checked })}
                />{' '}
                Send ping frames
              </label>
            </>
          ) : (
            <>
              <label>
                Maximum session (ms)
                <input
                  type="number"
                  value={draft.maxSessionDurationMs || 1800000}
                  onChange={(e) => onChange({ ...draft, maxSessionDurationMs: Number(e.target.value) })}
                />
              </label>
              <label>
                Maximum event bytes
                <input
                  type="number"
                  value={draft.maxEventBytes || 1048576}
                  onChange={(e) => onChange({ ...draft, maxEventBytes: Number(e.target.value) })}
                />
              </label>
            </>
          )}
        </div>
      )}
      {tab === 'Messages' && (
        <div className="stream-workbench">
          {protocol === 'sse' && draft.method === 'POST' && (
            <div className="editor">
              <select
                aria-label="SSE body type"
                value={draft.body?.type || 'none'}
                onChange={(e) =>
                  onChange({
                    ...draft,
                    body:
                      e.target.value === 'json'
                        ? { type: 'json', content: '{}' }
                        : e.target.value === 'text'
                          ? { type: 'text', content: '' }
                          : { type: 'none' },
                  })
                }
              >
                <option value="none">No body</option>
                <option value="json">JSON</option>
                <option value="text">Text</option>
              </select>
              {(draft.body?.type === 'json' || draft.body?.type === 'text') && (
                <textarea
                  aria-label="SSE body"
                  rows={5}
                  value={draft.body.content}
                  onChange={(e) => onChange({ ...draft, body: { ...draft.body, content: e.target.value } })}
                />
              )}
            </div>
          )}
          <div className="timeline" aria-label="Stream timeline">
            {records.length === 0 ? (
              <div className="empty compact">Connect to begin streaming.</div>
            ) : (
              records.map((r) => (
                <article key={r.id || r.sequence} className={`stream-record ${r.direction}`}>
                  <header>
                    <span>{r.direction}</span>
                    <span>{r.dataKind}</span>
                    <time>{new Date(r.timestamp).toLocaleTimeString()}</time>
                  </header>
                  <pre>{r.preview}</pre>
                </article>
              ))
            )}
          </div>
          {protocol === 'websocket' && (
            <div className="composer">
              <select aria-label="Message kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="text">Text</option>
                <option value="json">JSON</option>
                <option value="base64">Base64</option>
                <option value="file">File</option>
              </select>
              {kind === 'file' ? (
                <button
                  onClick={async () => {
                    const r = await window.requestStudio.files.selectRequestFile()
                    if (r.ok && r.data) onSend('file', r.data.fileRef)
                  }}
                  disabled={state !== 'open'}
                >
                  Select and send file
                </button>
              ) : (
                <textarea
                  aria-label="Message payload"
                  rows={4}
                  value={payload}
                  onChange={(e) => setPayload(e.target.value)}
                  placeholder="Compose a message…"
                />
              )}
              <select
                aria-label="Message template"
                value=""
                onChange={(e) => {
                  const t = templates.find((x) => x.id === e.target.value)
                  if (t) {
                    setKind(t.kind)
                    setPayload(t.content)
                  }
                }}
              >
                <option value="">Load template…</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                disabled={kind === 'file' || !payload}
                onClick={async () => {
                  const name = prompt('Template name')
                  if (name) {
                    await window.requestStudio.streamTemplates.save({
                      savedRequestId: draft.savedRequestId,
                      name,
                      kind,
                      content: payload,
                    })
                    void loadTemplates()
                  }
                }}
              >
                Save template
              </button>
              <button
                aria-label="Send message"
                disabled={kind === 'file' || state !== 'open' || !payload}
                onClick={() => {
                  onSend(kind, payload)
                  setPayload('')
                }}
              >
                Send
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
