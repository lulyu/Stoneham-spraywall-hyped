import {useEffect,useId,useRef,useState} from 'react'
import {communityRequest} from './community'
type Entry={id?:string;name?:string;problemId?:string;text?:string;author?:string;userId?:string;hidden?:boolean;banned?:boolean;reason?:string}
type Page={items:Entry[];nextCursor?:string}
type Decision={label:string;path:string;payload:{hidden?:boolean;banned?:boolean}}
export default function AdminModeration({baseUrl}:{baseUrl:string}){
 const reasonId=useId(),kindId=useId()
 const [open,setOpen]=useState(false),[kind,setKind]=useState('routes'),[page,setPage]=useState<Page>({items:[]})
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[reload,setReload]=useState(0)
 const [decision,setDecision]=useState<Decision|null>(null),[reason,setReason]=useState('')
 const generation=useRef(0),pending=useRef(false)
 useEffect(()=>{
  const sequence=++generation.current
  if(!open)return
  setBusy(true);setError('');setPage({items:[]});setDecision(null)
  void communityRequest<Page>(baseUrl,'/v1/admin/moderation?kind='+kind,'GET',undefined,true)
   .then(value=>{if(generation.current===sequence)setPage(value)})
   .catch(e=>{if(generation.current===sequence)setError(e instanceof Error?e.message:'Could not load moderation.')})
   .finally(()=>{if(generation.current===sequence)setBusy(false)})
  return()=>{generation.current++}
 },[baseUrl,open,kind,reload])
 const choose=(value:Decision)=>{setDecision(value);setReason('');setError('');setNotice('')}
 return <section className="moderation-panel" aria-label="Admin moderation">
  <button className="ghost" aria-expanded={open} aria-controls="moderation-content" onClick={()=>setOpen(value=>!value)}>Admin moderation</button>
  {open&&<div id="moderation-content">
   <h3>Moderation</h3>
   <p className="muted">Hide spam without deleting it. Suspended accounts can browse but cannot make changes.</p>
   <label htmlFor={kindId}>Content</label><select id={kindId} value={kind} disabled={busy} onChange={e=>setKind(e.target.value)}><option value="routes">Routes</option><option value="comments">Comments</option><option value="users">Account restrictions</option></select>
   {busy&&<p role="status">Loading…</p>}
   {error&&<p role="alert" className="error-message">{error}</p>}
   {notice&&<p role="status">{notice}</p>}
   {decision&&<form onSubmit={async e=>{
    e.preventDefault();if(pending.current||!reason.trim())return
    pending.current=true;setBusy(true);setError('')
    try{
     await communityRequest(baseUrl,decision.path,'PATCH',{...decision.payload,reason:reason.trim()},true)
     setNotice('Saved: '+decision.label);setDecision(null);setReason('');setReload(value=>value+1)
    }catch(e){setError(e instanceof Error?e.message:'Could not save moderation. Your reason is kept.')}
    finally{pending.current=false;setBusy(false)}
   }}>
    <p>{decision.label}</p>
    <label htmlFor={reasonId}>Reason</label><textarea id={reasonId} required maxLength={300} value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} />
    <div className="comment-actions"><button className="primary small" disabled={busy||!reason.trim()}>Confirm moderation</button><button type="button" className="ghost small" disabled={busy} onClick={()=>setDecision(null)}>Cancel moderation</button></div>
   </form>}
   <div className="moderation-list">{page.items.map(entry=>{
    const label=entry.name??entry.text??entry.userId??'Content'
    const target=entry.problemId??entry.id
    const path='/v1/admin/problems/'+encodeURIComponent(target??'')+(kind==='comments'?'/comments/'+encodeURIComponent(entry.id??''):'')+'/visibility'
    return <article key={entry.problemId?entry.problemId+'/'+entry.id:entry.id??entry.userId}>
     <strong>{label}</strong>
     <p className="muted">{kind==='users'?(entry.banned?'Suspended':'Allowed'):(entry.hidden?'Hidden':'Visible')}{entry.author?' · '+entry.author:''}</p>
     {entry.reason&&<p>{entry.reason}</p>}
     <div className="comment-actions">
      {kind!=='users'&&<button className="ghost small" disabled={busy} onClick={()=>choose({label:(entry.hidden?'Restore: ':'Hide: ')+label,path,payload:{hidden:!entry.hidden}})}>{entry.hidden?'Restore':'Hide'}</button>}
      {entry.userId&&<button className="ghost small" disabled={busy} onClick={()=>choose({label:(kind==='users'&&entry.banned?'Restore account: ':'Suspend account: ')+entry.userId,path:'/v1/admin/users/'+encodeURIComponent(entry.userId!)+'/access',payload:{banned:!(kind==='users'&&entry.banned)}})}>{kind==='users'&&entry.banned?'Unban account':'Suspend account'}</button>}
     </div>
    </article>
   })}</div>
   {!busy&&!page.items.length&&<p className="muted">No entries on this page.</p>}
   <div className="comment-actions"><button className="ghost small" disabled={busy} onClick={()=>setReload(value=>value+1)}>Refresh moderation</button>
   {page.nextCursor&&<button className="ghost small" disabled={busy} onClick={async()=>{
    if(pending.current)return
    const sequence=generation.current;pending.current=true;setBusy(true);setError('')
    try{const next=await communityRequest<Page>(baseUrl,'/v1/admin/moderation?kind='+kind+'&cursor='+encodeURIComponent(page.nextCursor!),'GET',undefined,true);if(generation.current===sequence)setPage(previous=>({items:[...new Map([...previous.items,...next.items].map(entry=>[entry.problemId?entry.problemId+'/'+entry.id:entry.id??entry.userId,entry])).values()],nextCursor:next.nextCursor}))}
    catch(e){if(generation.current===sequence)setError(e instanceof Error?e.message:'Could not load more.')}
    finally{pending.current=false;if(generation.current===sequence)setBusy(false)}
   }}>Load more moderation</button>}</div>
  </div>}
 </section>
}
