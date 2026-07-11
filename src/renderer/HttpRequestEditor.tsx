import type { HttpRequestDraft } from '../shared/schemas/http'
import { useState } from 'react'
type Entry = HttpRequestDraft['params'][number]
export type EditableHttpDraft = HttpRequestDraft
const addEntry = (): Entry => ({ id: crypto.randomUUID(), enabled: true, key: '', value: '', description: '' })
function Entries({
  label,
  entries,
  onChange,
}: {
  label: string
  entries: Entry[]
  onChange: (entries: Entry[]) => void
}) {
  return (
    <div>
      <button onClick={() => onChange([...entries, addEntry()])}>Add {label}</button>
      {entries.map((entry, index) => (
        <div className="kv" key={entry.id}>
          <input
            aria-label={`${label} enabled ${index}`}
            type="checkbox"
            checked={entry.enabled}
            onChange={(e) =>
              onChange(entries.map((x) => (x.id === entry.id ? { ...x, enabled: e.target.checked } : x)))
            }
          />
          <input
            aria-label={`${label} key ${index}`}
            placeholder="Key"
            value={entry.key}
            onChange={(e) => onChange(entries.map((x) => (x.id === entry.id ? { ...x, key: e.target.value } : x)))}
          />
          <input
            aria-label={`${label} value ${index}`}
            placeholder="Value"
            type={/authorization|cookie|token|api.?key/i.test(entry.key) ? 'password' : 'text'}
            value={entry.value}
            onChange={(e) => onChange(entries.map((x) => (x.id === entry.id ? { ...x, value: e.target.value } : x)))}
          />
          <input
            aria-label={`${label} description ${index}`}
            placeholder="Description"
            value={entry.description || ''}
            onChange={(e) =>
              onChange(entries.map((x) => (x.id === entry.id ? { ...x, description: e.target.value } : x)))
            }
          />
          <button
            aria-label={`Delete ${label} ${index}`}
            onClick={() => onChange(entries.filter((x) => x.id !== entry.id))}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
function MultipartEntries({entries,onChange}:{entries:any[];onChange:(entries:any[])=>void}) {
  return <>{entries.map((entry,index)=><div className="kv" key={entry.id}><input aria-label={`Multipart enabled ${index}`} type="checkbox" checked={entry.enabled} onChange={e=>onChange(entries.map(x=>x.id===entry.id?{...x,enabled:e.target.checked}:x))}/><input aria-label={`Multipart key ${index}`} placeholder="Key" value={entry.key} onChange={e=>onChange(entries.map(x=>x.id===entry.id?{...x,key:e.target.value}:x))}/><select aria-label={`Multipart kind ${index}`} value={entry.kind} onChange={e=>onChange(entries.map(x=>x.id===entry.id?{...x,kind:e.target.value,fileRef:null,textValue:''}:x))}><option value="text">Text</option><option value="file">File</option></select>{entry.kind==='text'?<input aria-label={`Multipart value ${index}`} value={entry.textValue||''} onChange={e=>onChange(entries.map(x=>x.id===entry.id?{...x,textValue:e.target.value}:x))}/>:<button onClick={async()=>{const r=await window.requestStudio.files.selectRequestFile();if(r.ok&&r.data)onChange(entries.map(x=>x.id===entry.id?{...x,fileRef:r.data.fileRef,filename:r.data.name}:x))}}>{entry.fileRef?'File selected':'Select file'}</button>}<button aria-label={`Delete Multipart ${index}`} onClick={()=>onChange(entries.filter(x=>x.id!==entry.id))}>×</button></div>)}</>
}
export default function HttpRequestEditor({
  draft,
  onChange,
}: {
  draft: EditableHttpDraft
  onChange: (draft: EditableHttpDraft) => void
}) {
  const [tab, setTab] = useState('Params'),
    auth = (value: any) => onChange({ ...draft, auth: value }),
    body = (value: any) => onChange({ ...draft, body: value })
  return (
    <section>
      <div className="tabs">
        {['Params', 'Auth', 'Headers', 'Body', 'Settings'].map((t) => (
          <button className={tab === t ? 'active' : ''} onClick={() => setTab(t)} key={t}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Params' && (
        <Entries label="Param" entries={draft.params} onChange={(params) => onChange({ ...draft, params })} />
      )}{' '}
      {tab === 'Headers' && (
        <Entries label="Header" entries={draft.headers} onChange={(headers) => onChange({ ...draft, headers })} />
      )}{' '}
      {tab === 'Auth' && (
        <div className="editor">
          <select
            aria-label="Auth type"
            value={draft.auth.type}
            onChange={(e) => {
              const type = e.target.value
              auth(
                type === 'bearer'
                  ? { type, token: '' }
                  : type === 'basic'
                    ? { type, username: '', password: '' }
                    : type === 'api-key'
                      ? { type, placement: 'header', key: '', value: '' }
                      : { type: 'none' },
              )
            }}
          >
            <option value="none">No Auth</option>
            <option value="bearer">Bearer</option>
            <option value="basic">Basic</option>
            <option value="api-key">API Key</option>
          </select>
          {draft.auth.type === 'bearer' && (
            <input
              aria-label="Bearer token"
              type="password"
              value={draft.auth.token}
              onChange={(e) => auth({ ...draft.auth, token: e.target.value })}
            />
          )}{' '}
          {draft.auth.type === 'basic' && (
            <>
              <input
                aria-label="Basic username"
                value={draft.auth.username}
                onChange={(e) => auth({ ...draft.auth, username: e.target.value })}
              />
              <input
                aria-label="Basic password"
                type="password"
                value={draft.auth.password}
                onChange={(e) => auth({ ...draft.auth, password: e.target.value })}
              />
            </>
          )}{' '}
          {draft.auth.type === 'api-key' && (
            <>
              <select
                aria-label="API key placement"
                value={draft.auth.placement}
                onChange={(e) => auth({ ...draft.auth, placement: e.target.value })}
              >
                <option value="header">Header</option>
                <option value="query">Query</option>
              </select>
              <input
                aria-label="API key name"
                value={draft.auth.key}
                onChange={(e) => auth({ ...draft.auth, key: e.target.value })}
              />
              <input
                aria-label="API key value"
                type="password"
                value={draft.auth.value}
                onChange={(e) => auth({ ...draft.auth, value: e.target.value })}
              />
            </>
          )}
        </div>
      )}{' '}
      {tab === 'Body' && (
        <div className="editor">
          <select
            aria-label="Body type"
            value={draft.body.type}
            onChange={(e) => {
              const type = e.target.value
              body(
                type === 'json'
                  ? { type, content: '{}' }
                  : type === 'text'
                    ? { type, content: '' }
                    : type === 'form-urlencoded'
                      ? { type, entries: [] }
                      : type === 'multipart'
                        ? { type, entries: [] }
                        : type === 'binary'
                          ? { type, fileRef: null }
                          : { type: 'none' },
              )
            }}
          >
            <option value="none">None</option>
            <option value="json">JSON</option>
            <option value="text">Text</option>
            <option value="form-urlencoded">Form URL Encoded</option>
            <option value="multipart">Multipart</option>
            <option value="binary">Binary File</option>
          </select>
          {(draft.body.type === 'json' || draft.body.type === 'text') && (
            <textarea
              aria-label="Body content"
              rows={12}
              value={draft.body.content}
              onChange={(e) => body({ ...draft.body, content: e.target.value })}
            />
          )}{' '}
          {draft.body.type === 'form-urlencoded' && (
            <Entries
              label="Form"
              entries={draft.body.entries}
              onChange={(entries) => body({ ...draft.body, entries })}
            />
          )}{' '}
          {draft.body.type === 'binary' && (
            <button
              onClick={async () => {
                const r = await window.requestStudio.files.selectRequestFile()
                if (r.ok && r.data) body({ ...draft.body, fileRef: r.data.fileRef })
              }}
            >
              {draft.body.fileRef ? 'File selected' : 'Select file'}
            </button>
          )}{' '}
          {draft.body.type === 'multipart' && (
            <><button
              onClick={() => {
                if (draft.body.type === 'multipart')
                  body({
                    ...draft.body,
                    entries: [
                      ...draft.body.entries,
                      { id: crypto.randomUUID(), enabled: true, key: '', kind: 'text', textValue: '' },
                    ],
                  })
              }}
            >
              Add multipart field
            </button><MultipartEntries entries={draft.body.entries} onChange={entries=>body({...draft.body,entries})}/></>
          )}
        </div>
      )}{' '}
      {tab === 'Settings' && (
        <label>
          Timeout (ms)
          <input
            aria-label="Timeout"
            type="number"
            min={100}
            max={300000}
            value={draft.settings.timeoutMs}
            onChange={(e) => onChange({ ...draft, settings: { ...draft.settings, timeoutMs: Number(e.target.value) } })}
          />
        </label>
      )}
    </section>
  )
}
