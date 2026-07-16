import { useEffect, useRef, useState } from 'react'

type Collection = { id: string; name: string }
type Props = {
  workspaceId: string
  collections: Collection[]
  onClose: () => void
  onImported: (request: any) => void
}
type Mapping = { placeholder: string; variableName: string }

const variableName = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/

export default function CurlImportPanel({ workspaceId, collections, onClose, onImported }: Props) {
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const [dialect, setDialect] = useState('auto')
  const [previewState, setPreviewState] = useState<any>(null)
  const [mappings, setMappings] = useState<Mapping[]>([])
  const [collectionId, setCollectionId] = useState(collections[0]?.id ?? '')
  const [environments, setEnvironments] = useState<any[]>([])
  const [environmentId, setEnvironmentId] = useState('')
  const [name, setName] = useState('Imported Request')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.requestStudio.environments.list(workspaceId).then((result: any) => {
      if (result.ok) setEnvironments(result.data)
    })
  }, [workspaceId])

  const parse = async () => {
    setBusy(true)
    setError('')
    setPreviewState(null)
    setMappings([])
    try {
      const result = await window.requestStudio.curlImport.preview({
        source: sourceRef.current?.value ?? '',
        dialect,
      })
      if (result.ok) {
        if (sourceRef.current) sourceRef.current.value = ''
        setPreviewState(result.data)
        setMappings(
          result.data.preview.sensitiveMappings.map((item: any) => ({
            placeholder: item.placeholder,
            variableName: item.suggestedVariable,
          })),
        )
      } else setError(result.error.message)
    } catch {
      setError('The cURL command could not be previewed.')
    } finally {
      setBusy(false)
    }
  }

  const names = new Set(mappings.map((mapping) => mapping.variableName))
  const valid = Boolean(
    previewState &&
      collectionId &&
      name.trim() &&
      mappings.every((mapping) => variableName.test(mapping.variableName)) &&
      names.size === mappings.length &&
      (!mappings.length || environmentId),
  )

  const save = async () => {
    if (!valid) return
    setBusy(true)
    setError('')
    try {
      const result = await window.requestStudio.curlImport.save({
        previewId: previewState.previewId,
        workspaceId,
        collectionId,
        environmentId: mappings.length ? environmentId : undefined,
        name: name.trim(),
        variableMappings: mappings,
      })
      if (result.ok) onImported(result.data.request)
      else setError(result.error.message)
    } catch {
      setError('The cURL request could not be imported.')
    } finally {
      setBusy(false)
    }
  }

  const preview = previewState?.preview
  return (
    <section className="modal curl-import" role="dialog" aria-modal="true" aria-labelledby="curl-import-title">
      <div className="curl-import-titlebar">
        <div>
          <span className="hint">TOOLS / IMPORT</span>
          <h2 id="curl-import-title">Import cURL</h2>
        </div>
        <button onClick={onClose}>Close</button>
      </div>

      <label>
        cURL command
        <textarea ref={sourceRef} rows={7} spellCheck={false} placeholder="Paste a cURL command" />
      </label>
      <div className="row">
        <label>
          Shell dialect
          <select value={dialect} onChange={(event) => setDialect(event.target.value)}>
            <option value="auto">Auto detect</option>
            <option value="posix">POSIX shell</option>
            <option value="powershell">PowerShell</option>
            <option value="cmd">Command Prompt</option>
          </select>
        </label>
        <button onClick={parse} disabled={busy}>{busy ? 'Working…' : 'Parse Preview'}</button>
      </div>

      {error && <p className="error" role="alert">{error}</p>}
      {preview && (
        <>
          <section className="curl-preview" aria-label="Sanitized preview">
            <div><span>Dialect</span><strong>{preview.dialect}</strong></div>
            <div><span>Method</span><strong>{preview.request.method}</strong></div>
            <div className="curl-preview-url"><span>URL</span><code>{preview.request.url}</code></div>
          </section>

          {preview.warnings.length > 0 && (
            <section>
              <h3>Warnings</h3>
              {preview.warnings.map((warning: any) => <p className="warning" key={warning.code}>{warning.message}</p>)}
            </section>
          )}

          <section>
            <h3>Headers</h3>
            {preview.request.headers.length
              ? preview.request.headers.map((header: any) => <code className="curl-line" key={header.id}>{header.key}: {header.value}</code>)
              : <p className="hint">No headers</p>}
          </section>

          <section>
            <h3>Body</h3>
            <pre className="curl-body">{preview.request.body.type === 'none' ? 'No body' : preview.request.body.content}</pre>
          </section>

          {preview.sensitiveMappings.length > 0 && (
            <section>
              <h3>Sensitive mapping</h3>
              {preview.sensitiveMappings.map((item: any, index: number) => (
                <div className="curl-mapping" key={item.placeholder}>
                  <div><strong>{item.kind}</strong><span>{item.location}</span><code>{item.placeholder}</code></div>
                  <label>
                    Variable for {item.location}
                    <input
                      value={mappings[index]?.variableName ?? ''}
                      aria-invalid={!variableName.test(mappings[index]?.variableName ?? '')}
                      onChange={(event) => setMappings((current) => current.map((mapping, position) => position === index ? { ...mapping, variableName: event.target.value } : mapping))}
                    />
                  </label>
                </div>
              ))}
            </section>
          )}

          <section className="curl-destination">
            <h3>Save destination</h3>
            <label>
              Request name
              <input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              Collection
              <select value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>
                <option value="">Select a Collection</option>
                {collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
              </select>
            </label>
            {mappings.length > 0 && (
              <label>
                Environment
                <select value={environmentId} onChange={(event) => setEnvironmentId(event.target.value)}>
                  <option value="">Select an Environment</option>
                  {environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}
                </select>
              </label>
            )}
          </section>
          <div className="row"><span className="spacer" /><button onClick={save} disabled={!valid || busy}>Import</button></div>
        </>
      )}
    </section>
  )
}
