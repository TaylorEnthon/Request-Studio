import { useEffect,useState } from 'react'
import ResourceViewer from './features/response/ResourceViewer'
import BinaryViewer from './features/response/BinaryViewer'
import JsonViewer from './features/response/JsonViewer'

export default function HttpResponsePanel({response,error}:{response:any;error:string}){
 const media=['image','audio','video','pdf'].includes(response?.kind),binary=response?.kind==='binary',[tab,setTab]=useState('Overview')
 const tabs=response?['Overview','Headers',...(media?['Preview']:binary?['Binary']:['Pretty','Raw'])]:[]
 useEffect(()=>setTab('Overview'),[response?.historyId,response?.resource?.id])
 return <aside aria-label="Response">
  <h2>Response</h2>{error&&<p role="alert" className="error">{error}</p>}
  {!response&&!error?<div className="empty">Send a request to see the response here.</div>:response&&<>
   <div className="tabs">{tabs.map(t=><button key={t} onClick={()=>setTab(t)}>{t}</button>)}</div>
   {tab==='Overview'&&<><dl><dt>Status</dt><dd>{response.status} {response.statusText}</dd><dt>Duration</dt><dd>{response.durationMs} ms</dd><dt>Size</dt><dd>{response.sizeBytes} bytes</dd><dt>Response kind</dt><dd>{response.kind}</dd><dt>Declared MIME</dt><dd>{response.classification?.declaredMimeType||response.contentType||'Not provided'}</dd><dt>Detected MIME</dt><dd>{response.classification?.detectedMimeType||'Not detected'}</dd><dt>Storage</dt><dd>{response.resource?'Managed resource':'Inline'}</dd></dl>{response.classification?.warnings?.map((w:string)=><p className="warning" key={w}>{w}</p>)}<button onClick={()=>response.resource?window.requestStudio.responseResources.saveAs(response.resource.id):window.requestStudio.responseResources.saveInline(response.text||'',`response.${response.kind==='json'?'json':'txt'}`)}>Save As...</button></>}
   {tab==='Headers'&&<pre>{JSON.stringify(response.headers,null,2)}</pre>}
   {tab==='Pretty'&&(response.kind==='json'&&response.text?<JsonViewer text={response.text} historyId={response.historyId}/>:<pre>{response.text||''}</pre>)}
   {tab==='Raw'&&<pre>{response.text||''}</pre>}
   {tab==='Preview'&&<ResourceViewer resource={response.resource&&{...response.resource,kind:response.kind}}/>}
   {tab==='Binary'&&<BinaryViewer resource={response.resource}/>}</>}
 </aside>
}
