import { useEffect, useMemo, useState } from 'react'
import HttpRequestEditor, { type EditableHttpDraft } from './HttpRequestEditor'
import ResourceViewer from './features/response/ResourceViewer'
import { runCompare } from './run-compare'
import StreamingRequestEditor from './StreamingRequestEditor'

type Props = { workspaceId: string; experimentId: string; onDeleted: () => void }
const parse = (value: string | null | undefined, fallback: any = {}) => { try { return value ? JSON.parse(value) : fallback } catch { return fallback } }

export default function ExperimentWorkspace({ workspaceId, experimentId, onDeleted }: Props) {
  const [detail, setDetail] = useState<any>(), [error, setError] = useState(''), [selectedId, setSelectedId] = useState('')
  const [compareIds, setCompareIds] = useState<string[]>([]), [comparison, setComparison] = useState<any>(), [compareData, setCompareData] = useState<any>(), [draft, setDraft] = useState<EditableHttpDraft | null>(null), [streamDraft, setStreamDraft] = useState<any>(), [activeRuns, setActiveRuns] = useState<string[]>([])
  const load = async () => { const result = await window.requestStudio.experiments.get({ workspaceId, id: experimentId }); if (result.ok) { setDetail(result.data); setSelectedId((id) => id && result.data.runs.some((run: any) => run.id === id) ? id : result.data.runs[0]?.id || '') } else setError(result.error.message) }
  useEffect(() => { void load() }, [workspaceId, experimentId])
  const selected = detail?.runs.find((run: any) => run.id === selectedId)
  useEffect(() => {
    if (!selected || selected.status !== 'draft') { setDraft(null); setStreamDraft(null); return }
    const snapshot = parse(selected.request_snapshot_json)
    if (detail.experiment.protocol === 'http') { setDraft({ ...snapshot, savedRequestId: selected.id, workspaceId }); setStreamDraft(null) }
    else { setDraft(null); setStreamDraft({ savedRequestId: selected.id, workspaceId, name: snapshot.name, url: snapshot.url, params: snapshot.params ?? [], headers: snapshot.headers ?? [], auth: snapshot.auth ?? {type:'none'}, ...(snapshot.streamConfig ?? {}) }) }
  }, [selectedId, selected?.updated_at])
  const compared = useMemo(() => compareIds.map((id) => detail?.runs.find((run: any) => run.id === id)).filter(Boolean), [compareIds, detail])
  const toggleCompare = (id: string) => setCompareIds((ids) => ids.includes(id) ? ids.filter((value) => value !== id) : ids.length < 2 ? [...ids, id] : [ids[1], id])
  const addRun = async () => { const result = await window.requestStudio.experimentRuns.create({ workspaceId, experimentId, sourceRunId: selectedId || undefined }); if (result.ok) await load(); else setError(result.error.message) }
  const execute = async (runId: string) => { setError(''); setActiveRuns((ids)=>[...ids,runId]); const result = await window.requestStudio.experimentRuns.execute({ workspaceId, runId }); if (!result.ok) setError(result.error.message); setActiveRuns((ids)=>ids.filter((id)=>id!==runId)); await load() }
  const runAll = async () => { for (const run of detail.runs.filter((item: any) => item.status === 'draft')) await execute(run.id) }
  const saveDraft = async () => {
    if (!draft) return
    const snapshot: any = { ...draft }; delete snapshot.savedRequestId; delete snapshot.workspaceId
    const result = await window.requestStudio.experimentRuns.update({ workspaceId, runId: selectedId, snapshotJson: JSON.stringify({ version: 1, protocol: 'http', ...snapshot }) })
    if (result.ok) await load(); else setError(result.error.message)
  }
  const saveStreamDraft = async () => {
    if (!streamDraft) return true
    const snapshot = { ...streamDraft }; delete snapshot.savedRequestId; delete snapshot.workspaceId
    const { name, url, params, headers, auth, ...streamConfig } = snapshot
    const result = await window.requestStudio.experimentRuns.update({ workspaceId, runId: selectedId, snapshotJson: JSON.stringify({ version: 1, protocol: detail.experiment.protocol, name, url, params, headers, auth, streamConfig }) })
    if (!result.ok) setError(result.error.message)
    return result.ok
  }
  const connectStream = async () => { if (await saveStreamDraft()) void execute(selectedId) }
  const stopStream = async () => { await window.requestStudio.experimentRuns.cancel({workspaceId,runId:selectedId}) }
  const sendStream = async (kind:string,value:string) => { const result=await window.requestStudio.experimentRuns.send({workspaceId,runId:selectedId,kind,value});if(!result.ok)setError(result.error.message) }
  const compare = async () => {
    if (compareIds.length !== 2) return
    const result = await window.requestStudio.experimentRuns.compareData({ workspaceId, leftRunId: compareIds[0], rightRunId: compareIds[1] })
    if (!result.ok) return setError(result.error.message)
    setCompareData(result.data); setComparison(await runCompare(result.data))
  }
  if (!detail) return <section className="experiment-workspace"><p>{error || 'Loading Experiment…'}</p></section>
  const leftResult = compareData?.left.result ?? parse(compared[0]?.result_snapshot_json), rightResult = compareData?.right.result ?? parse(compared[1]?.result_snapshot_json)
  return <section className="experiment-workspace">
    <div className="experiment-header"><div><h2>{detail.experiment.name}</h2><span className="protocol-badge">{String(detail.experiment.protocol).toUpperCase()}</span></div><div className="row"><button onClick={addRun}>Add Run</button><button onClick={runAll} disabled={!detail.runs.some((run: any) => run.status === 'draft')}>Run all</button><button onClick={async()=>{const name=prompt('Experiment name',detail.experiment.name)?.trim();if(name){const result=await window.requestStudio.experiments.rename({workspaceId,id:experimentId,name});if(result.ok)await load();else setError(result.error.message)}}}>Rename</button><button onClick={async()=>{const result=await window.requestStudio.experiments.duplicate({workspaceId,id:experimentId});if(result.ok)onDeleted();else setError(result.error.message)}}>Duplicate</button><button onClick={async()=>{if(confirm('Delete this Experiment and all Runs?')){await window.requestStudio.experiments.delete({workspaceId,id:experimentId});onDeleted()}}}>Delete Experiment</button></div></div>
    {error && <p role="alert" className="error">{error}</p>}<p className="sr-status" aria-live="polite">{detail.runs.filter((run:any)=>run.status==='running').length ? 'Experiment Run in progress' : 'Experiment ready'}</p>
    <div className="experiment-body"><section className="run-list"><table><thead><tr><th>Compare</th><th>Run</th><th>Status</th><th>Result</th><th>Duration</th><th>Actions</th></tr></thead><tbody>{detail.runs.map((run: any) => { const result=parse(run.result_snapshot_json); return <tr key={run.id} className={run.id===selectedId?'selected':''}><td><input aria-label={`Compare ${run.label}`} type="checkbox" disabled={run.status!=='completed'} checked={compareIds.includes(run.id)} onChange={()=>toggleCompare(run.id)}/></td><td><button className="run-name" onClick={()=>setSelectedId(run.id)}>{run.label}</button></td><td><span className={`run-status ${run.status}`}>{run.status}</span></td><td>{result.status ?? '—'}</td><td>{run.duration_ms == null ? '—' : `${run.duration_ms} ms`}</td><td>{run.status==='draft'&&<button onClick={()=>execute(run.id)}>Run</button>}<button aria-label={`Delete ${run.label}`} onClick={async()=>{await window.requestStudio.experimentRuns.delete({workspaceId,runId:run.id});await load()}}>×</button></td></tr>})}</tbody></table>
      <button onClick={compare} disabled={compareIds.length!==2} aria-label="Compare selected Runs">Compare selected Runs</button></section>
      {comparison && compared.length===2 ? <section className="compare-view"><div className="compare-title"><h3>{compared[0].label}</h3><span>vs</span><h3>{compared[1].label}</h3></div><div className="compare-metrics"><dl><dt>Status</dt><dd>{leftResult.status} → {rightResult.status}</dd><dt>Duration delta</dt><dd>{comparison.metrics.durationDeltaMs} ms</dd><dt>Size delta</dt><dd>{comparison.metrics.sizeDeltaBytes} B</dd></dl></div><h4>Request</h4><div className="diff-list">{comparison.request.entries.filter((entry:any)=>entry.status!=='equal').map((entry:any,index:number)=><div className={`diff-row ${entry.status}`} key={entry.path||index}><code>{entry.path}</code><pre>{JSON.stringify(entry.left)}</pre><pre>{JSON.stringify(entry.right)}</pre></div>)}</div><h4>Response</h4><div className="diff-list">{comparison.response.warning&&<p className="warning">{comparison.response.warning}</p>}{comparison.response.entries.filter((entry:any)=>entry.status!=='equal').map((entry:any,index:number)=><div className={`diff-row ${entry.status}`} key={entry.path||index}><code>{entry.path||entry.status}</code><pre>{JSON.stringify(entry.left)}</pre><pre>{JSON.stringify(entry.right)}</pre></div>)}</div>{comparison.timeline&&<><h4>Timeline</h4><div className="diff-list">{comparison.timeline.warning&&<p className="warning">{comparison.timeline.warning}</p>}{comparison.timeline.entries.map((entry:any,index:number)=><div className={`diff-row ${entry.status}`} key={index}><code>#{index+1} {entry.status}</code><pre>{entry.left?.text_preview}</pre><pre>{entry.right?.text_preview}</pre></div>)}</div></>}<div className="media-compare">{leftResult.resource&&<ResourceViewer resource={leftResult.resource}/>} {rightResult.resource&&<ResourceViewer resource={rightResult.resource}/>}</div></section>
      : selected?.status==='draft' && draft ? <section className="run-editor"><h3>Edit {selected.label}</h3><label>Name<input value={draft.name} onChange={(event)=>setDraft({...draft,name:event.target.value})}/></label><div className="row"><select aria-label="Method" value={draft.method} onChange={(event)=>setDraft({...draft,method:event.target.value as EditableHttpDraft['method']})}>{['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].map((method)=><option key={method}>{method}</option>)}</select><input aria-label="URL" value={draft.url} onChange={(event)=>setDraft({...draft,url:event.target.value})}/></div><HttpRequestEditor draft={draft} onChange={setDraft}/><button onClick={saveDraft}>Save Run</button></section>
      : selected?.status==='draft' && streamDraft ? <section className="run-editor"><StreamingRequestEditor protocol={detail.experiment.protocol} draft={streamDraft} state={activeRuns.includes(selected.id)?'open':'closed'} records={[]} onChange={setStreamDraft} onConnect={connectStream} onStop={stopStream} onSend={sendStream}/><button onClick={saveStreamDraft}>Save Run</button></section>
      : selected ? <section className="run-summary"><h3>{selected.label}</h3><pre>{JSON.stringify(parse(selected.result_snapshot_json),null,2)}</pre></section> : null}</div>
  </section>
}
