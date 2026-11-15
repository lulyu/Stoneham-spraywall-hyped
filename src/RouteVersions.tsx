import {useEffect,useRef,useState} from 'react'
import type {Problem} from './types'
import type {ProblemPage,ProblemStore} from './problemStore'
import {compareRouteVersions} from './routeVersionGroups'
export default function RouteVersions({active,store,onOpen,busy}:{active:Problem;store:ProblemStore;onOpen:(route:Problem)=>Promise<void>;busy:boolean}){
 const [open,setOpen]=useState(false),[data,setData]=useState<ProblemPage>({items:[]})
 const [loading,setLoading]=useState(false),[error,setError]=useState(''),[attempt,setAttempt]=useState(0)
 const generation=useRef(0),inFlight=useRef(false)
 useEffect(()=>{
  const request=++generation.current
  if(!open)return
  setLoading(true);setError('');setData({items:[]})
  void store.listVersions(active.id).then(page=>{if(generation.current===request)setData(page)})
   .catch(e=>{if(generation.current===request)setError(e instanceof Error?e.message:'Could not load versions.')})
   .finally(()=>{if(generation.current===request)setLoading(false)})
  return()=>{generation.current++}
 },[active.id,store,open,attempt])
 return <details className="route-versions" open={open} onToggle={e=>setOpen(e.currentTarget.open)}>
  <summary>Other versions</summary>
  {open&&<div>
   {loading&&<p className="muted" role="status">Loading versions…</p>}
   {error&&<p role="alert" className="error-message">{error} <button className="ghost small" disabled={loading} onClick={()=>setAttempt(value=>value+1)}>Retry versions</button></p>}
   <ul>{[...new Map([...data.items,active].map(route=>[route.id,route])).values()].sort(compareRouteVersions).map(route=><li key={route.id}>
    {route.id===active.id?<span aria-current="page">V{route.upgradeNumber??1} · {route.name} · Viewing</span>:<button className="route-version-link" disabled={busy||loading} onClick={()=>void onOpen(route)}>V{route.upgradeNumber??1} · {route.name}{route.outdated?' · Old wall':''}</button>}
   </li>)}</ul>
   {!loading&&!error&&!data.items.some(route=>route.id!==active.id)&&!data.nextCursor&&<p className="muted">No other versions available.</p>}
   {data.nextCursor&&<button className="route-version-link" disabled={loading||busy} onClick={async()=>{
    if(inFlight.current)return
    const request=generation.current;inFlight.current=true;setLoading(true);setError('')
    try{
     const next=await store.listVersions(active.id,data.nextCursor)
     if(next.nextCursor&&next.nextCursor===data.nextCursor)throw new Error('Could not advance versions. Please retry.')
     if(request===generation.current)setData(previous=>({items:[...new Map([...previous.items,...next.items].map(route=>[route.id,route])).values()],nextCursor:next.nextCursor}))
    }catch(e){if(request===generation.current)setError(e instanceof Error?e.message:'Could not load more versions.')}
    finally{inFlight.current=false;if(request===generation.current)setLoading(false)}
   }}>More versions</button>}
  </div>}
 </details>
}
