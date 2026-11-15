import { useEffect, useRef, useState } from 'react'
import {latestRouteVersions} from './routeVersionGroups'
import { communityRequest } from './community'
import type { ProblemPage } from './problemStore'

async function routeBatch(baseUrl:string,existing:ProblemPage['items']=[],cursor?:string,current:()=>boolean=()=>true):Promise<ProblemPage>{
 const target=latestRouteVersions(existing).length+5
 let items=existing,next=cursor
 for(let page=0;page<10;page++){
  const result=await communityRequest<ProblemPage>(baseUrl,'/v1/me/problems'+(next?'?cursor='+encodeURIComponent(next):''),'GET',undefined,true)
  if(!current())return {items,nextCursor:next}
  items=[...new Map([...items,...result.items].map(route=>[route.id,route])).values()]
  if(result.nextCursor&&result.nextCursor===next)throw new Error('Could not advance your route list. Please retry.')
  next=result.nextCursor
  if(!next||latestRouteVersions(items).length>=target)break
 }
 return {items,nextCursor:next}
}

export default function MyRoutes({baseUrl, onOpen}: {baseUrl: string; onOpen: (id: string) => Promise<void>}) {
  const [data, setData] = useState<ProblemPage>({items: []})
  const [visibleCount,setVisibleCount]=useState(5)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const generation = useRef(0)
  const inFlight = useRef(false)
  useEffect(() => {
    const request = ++generation.current
    inFlight.current = true
    setBusy(true); setError(''); setData({items: []});setVisibleCount(5)
    void routeBatch(baseUrl,[],undefined,()=>request===generation.current)
      .then(page => {if (request === generation.current) setData(page)})
      .catch(error => {if (request === generation.current) setError(error instanceof Error ? error.message : 'Could not load your routes.')})
      .finally(() => {if (request === generation.current) {inFlight.current = false; setBusy(false)}})
    return () => {generation.current++; inFlight.current = false}
  }, [baseUrl, attempt])

  const loadMore = async () => {
    if(inFlight.current)return
    if(!data.nextCursor){setVisibleCount(value=>value+5);return}
    const request = generation.current
    inFlight.current = true; setBusy(true); setError('')
    try {
      const next=await routeBatch(baseUrl,data.items,data.nextCursor,()=>request===generation.current)
      if(request===generation.current)setVisibleCount(value=>value+5)
      if (request === generation.current) setData(previous => ({
        items: [...new Map([...previous.items, ...next.items].map(route => [route.id, route])).values()],
        nextCursor: next.nextCursor,
      }))
    } catch (error) {
      if (request === generation.current) setError(error instanceof Error ? error.message : 'Could not load more routes.')
    } finally {
      if (request === generation.current) {inFlight.current = false; setBusy(false)}
    }
  }
  const open = async (id: string) => {
    if (inFlight.current) return
    const request = generation.current
    inFlight.current = true; setBusy(true); setError('')
    try {await onOpen(id)}
    catch (error) {if (request === generation.current) setError(error instanceof Error ? error.message : 'Could not open route.')}
    finally {if (request === generation.current) {inFlight.current = false; setBusy(false)}}
  }

  return <section className="my-routes" aria-label="My routes">
    <h3>My routes</h3>
    <p className="muted">Routes you created · latest versions first</p>
    {busy && <p role="status">Loading…</p>}
    {error && <div role="alert"><p className="error-message">{error}</p>
      {!data.items.length && !data.nextCursor && <button className="ghost small" disabled={busy} onClick={() => setAttempt(value => value + 1)}>Retry routes</button>}
    </div>}
    {!busy && !error && !data.items.length && <p className="muted">You haven't set any routes yet.</p>}
    {latestRouteVersions(data.items).slice(0,visibleCount).map(route => <button key={route.id} data-route-id={route.id} className={`problem-card ${route.outdated ? 'outdated' : ''}`} disabled={busy} onClick={() => void open(route.id)}>
      <span className="grade-chip">{route.grade}</span>
      <span className="problem-copy"><strong>{route.name}</strong><small>{new Date(route.createdAt).toLocaleDateString()}{route.outdated ? ' · Old wall only' : ''}</small></span>
      <span className="chevron">›</span>
    </button>)}
    {(data.nextCursor||latestRouteVersions(data.items).length>visibleCount) && <button className="ghost" disabled={busy} onClick={() => void loadMore()}>Load more</button>}
  </section>
}
