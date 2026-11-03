import { useEffect, useRef, useState } from 'react'
import { communityRequest, type CommunityData, type MyActivity, type Comment } from './community'
import { signIn } from './auth'

export default function Community({ baseUrl, problemId, name, userId }: { baseUrl: string; problemId: string; name: string; userId?: string }) {
  const path = '/v1/problems/' + encodeURIComponent(problemId)
  const [data, setData] = useState<CommunityData | null>(null)
  const [mine, setMine] = useState<MyActivity | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const pendingComment = useRef<string | null>(null)
  const saving = useRef(false)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let live = true
    setLoading(true); setError('')
    void Promise.all([
      communityRequest<CommunityData>(baseUrl, path + '/community'),
      userId ? communityRequest<MyActivity>(baseUrl, path + '/my-activity', 'GET', undefined, true).catch((e) => { if (live) setError(e.message); return null }) : Promise.resolve(null),
    ]).then(([summary, activity]) => { if (live) { setData(summary); setMine(activity) } })
      .catch((e) => { if (live) setError(e.message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [baseUrl, path, userId, reload])

  async function mutate(action: () => Promise<void>) {
    if (saving.current) return
    saving.current = true; setBusy(true); setError('')
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : 'Please retry.') }
    finally { saving.current = false; setBusy(false) }
  }
  return <section className="community-panel" aria-label="Route activity">
    <h3>{name}</h3>
    {loading && <p role="status">Loading route activity…</p>}
    {error && <p role="alert" className="error-message">{error} <button className="ghost small" disabled={busy} onClick={() => setReload((n) => n + 1)}>Retry activity</button></p>}
    {data && <>
      <p className="muted">{data.ratingCount ? data.ratingAverage!.toFixed(1) + '/5 · ' + data.ratingCount + ' ratings' : 'No ratings yet'}</p>
      {!userId ? <button className="ghost" onClick={() => void signIn().catch((e) => setError(e.message))}>Sign in to log a send, rate or comment</button> : <>
        <button className="primary" disabled={busy || !mine || mine.sent} onClick={() => void mutate(async () => {
          const sent = await communityRequest<{ sentAt: string }>(baseUrl, path + '/sends', 'POST', undefined, true)
          setMine((previous) => ({ sent: true, sentAt: sent.sentAt, rating: previous?.rating ?? null }))
        })}>{mine?.sent ? 'Send logged' : 'Log send'}</button>
        {mine?.sentAt && <p className="muted">Sent {new Date(mine.sentAt).toLocaleDateString()}</p>}
        <div className="rating-row" role="group" aria-label="Rate this route">
          <span>Enjoyment</span>
          {[1, 2, 3, 4, 5].map((score) => <button className="ghost small" key={score} aria-label={'Rate ' + score + ' out of 5'} aria-pressed={mine?.rating === score} disabled={busy || !mine} onClick={() => void mutate(async () => {
            await communityRequest(baseUrl, path + '/rating', 'PATCH', { score }, true)
            setMine((previous) => previous ? { ...previous, rating: score } : previous)
            const summary = await communityRequest<CommunityData>(baseUrl, path + '/community')
            setData((previous) => previous ? { ...previous, ratingAverage: summary.ratingAverage, ratingCount: summary.ratingCount } : summary)
          })}><svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9-6.2-3.3-6.2 3.3 1.2-6.9-5-4.9 6.9-1z" /></svg> {score}</button>)}
        </div>
      </>}
      <h4>Comments</h4>
      {userId && <form onSubmit={(event) => { event.preventDefault(); void mutate(async () => {
        pendingComment.current ??= crypto.randomUUID()
        const added = await communityRequest<Comment>(baseUrl, path + '/comments', 'POST', { text: text.trim(), requestId: pendingComment.current }, true)
        setData((previous) => previous ? { ...previous, comments: [added, ...previous.comments.filter((c) => c.id !== added.id)] } : previous)
        setText(''); pendingComment.current = null
      }) }}>
        <label htmlFor={'comment-' + problemId}>Your comment</label>
        <textarea id={'comment-' + problemId} rows={3} maxLength={1000} value={text} disabled={busy} onChange={(e) => { setText(e.target.value); pendingComment.current = null }} />
        <button className="ghost" disabled={busy || !text.trim()}>Post comment</button>
      </form>}
      {!data.comments.length && <p className="muted">No comments yet.</p>}
      <div className="comments-list">{data.comments.map((c) => <article key={c.id}>
        <strong>{c.author}</strong> <time className="muted" dateTime={c.createdAt}>{new Date(c.createdAt).toLocaleDateString()}</time>
        <p>{c.text}</p>
      </article>)}</div>
      {data.nextCursor && <button className="ghost small" disabled={busy} onClick={() => void mutate(async () => {
        const next = await communityRequest<CommunityData>(baseUrl, path + '/community?cursor=' + encodeURIComponent(data.nextCursor!))
        setData((previous) => previous ? { ...previous, comments: [...new Map([...previous.comments, ...next.comments].map((c) => [c.id, c])).values()], nextCursor: next.nextCursor } : next)
      })}>More comments</button>}
    </>}
  </section>
}
