import { useEffect, useState } from 'react'
import { communityRequest, type SendLog } from './community'
type Page = { items: SendLog[]; nextCursor?: string }
export default function SendHistory({ baseUrl, onOpen }: { baseUrl: string; onOpen: (id: string) => Promise<void> }) {
  const [data, setData] = useState<Page>({ items: [] })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let live = true
    setBusy(true); setError('')
    void communityRequest<Page>(baseUrl, '/v1/me/sends', 'GET', undefined, true)
      .then((page) => { if (live) setData(page) })
      .catch((e) => { if (live) setError(e.message) })
      .finally(() => { if (live) setBusy(false) })
    return () => { live = false }
  }, [baseUrl, reload])
  return <section className="send-history" aria-label="Your sends">
    <h3>Your sends</h3>
    {busy && <p role="status">Loading sends…</p>}
    {error && <p role="alert" className="error-message">{error}</p>}
    <button className="ghost small" disabled={busy} onClick={() => setReload((n) => n + 1)}>Refresh sends</button>
    {!busy && !data.items.length && !error && <p className="muted">No sends logged yet. Open a route and tap Log send.</p>}
    {data.items.map((send) => <button className="problem-card" key={send.problemId} disabled={busy} onClick={async () => {
      setBusy(true); setError('')
      try { await onOpen(send.problemId) } catch (e) { setError(e instanceof Error ? e.message : 'Could not open route.') }
      finally { setBusy(false) }
    }}>
      <span className="grade-chip">{send.grade}</span><span className="problem-copy"><strong>{send.name}</strong><small>{send.setter} · Sent {new Date(send.sentAt).toLocaleDateString()}</small></span>
    </button>)}
    {data.nextCursor && <button className="ghost" disabled={busy} onClick={async () => {
      setBusy(true); setError('')
      try {
        const next = await communityRequest<Page>(baseUrl, '/v1/me/sends?cursor=' + encodeURIComponent(data.nextCursor!), 'GET', undefined, true)
        setData((previous) => ({ items: [...new Map([...previous.items, ...next.items].map((s) => [s.problemId, s])).values()], nextCursor: next.nextCursor }))
      } catch (e) { setError(e instanceof Error ? e.message : 'Could not load sends.') }
      finally { setBusy(false) }
    }}>More sends</button>}
  </section>
}
