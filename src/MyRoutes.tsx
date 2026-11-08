import { useEffect, useRef, useState } from 'react'
import { communityRequest } from './community'
import type { ProblemPage } from './problemStore'

export default function MyRoutes({baseUrl, onOpen}: {baseUrl: string; onOpen: (id: string) => Promise<void>}) {
  const [data, setData] = useState<ProblemPage>({items: []})
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const generation = useRef(0)
  const inFlight = useRef(false)
  useEffect(() => {
    const request = ++generation.current
    inFlight.current = true
    setBusy(true); setError(''); setData({items: []})
    void communityRequest<ProblemPage>(baseUrl, '/v1/me/problems', 'GET', undefined, true)
      .then(page => {if (request === generation.current) setData(page)})
      .catch(error => {if (request === generation.current) setError(error instanceof Error ? error.message : 'Could not load your routes.')})
      .finally(() => {if (request === generation.current) {inFlight.current = false; setBusy(false)}})
    return () => {generation.current++; inFlight.current = false}
  }, [baseUrl, attempt])

  const loadMore = async () => {
    if (inFlight.current || !data.nextCursor) return
    const request = generation.current
    inFlight.current = true; setBusy(true); setError('')
    try {
      const next = await communityRequest<ProblemPage>(baseUrl, '/v1/me/problems?cursor=' + encodeURIComponent(data.nextCursor), 'GET', undefined, true)
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
    <p className="muted">Routes you created · newest first</p>
    {busy && <p role="status">Loading…</p>}
    {error && <div role="alert"><p className="error-message">{error}</p>
      {!data.items.length && !data.nextCursor && <button className="ghost small" disabled={busy} onClick={() => setAttempt(value => value + 1)}>Retry routes</button>}
    </div>}
    {!busy && !error && !data.items.length && <p className="muted">You haven't set any routes yet.</p>}
    {data.items.map(route => <button key={route.id} className={`problem-card ${route.outdated ? 'outdated' : ''}`} disabled={busy} onClick={() => void open(route.id)}>
      <span className="grade-chip">{route.grade}</span>
      <span className="problem-copy"><strong>{route.name}</strong><small>{new Date(route.createdAt).toLocaleDateString()}{route.outdated ? ' · Old wall only' : ''}</small></span>
      <span className="chevron">›</span>
    </button>)}
    {data.nextCursor && <button className="ghost" disabled={busy} onClick={() => void loadMore()}>Load more</button>}
  </section>
}
