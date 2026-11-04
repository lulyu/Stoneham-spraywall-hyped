import { useEffect, useId, useRef, useState } from 'react'
import type { UserProfile } from './profile'

export default function PublicProfileLink({ baseUrl, path, name }: { baseUrl: string; path: string; name?: string }) {
  const [open, setOpen] = useState(false)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const displayName = profile?.displayName || name || 'Climber'

  useEffect(() => {
    if (open) dialog.current?.showModal()
    else dialog.current?.close()
  }, [open])

  useEffect(() => {
    if (name !== undefined && !open) return
    const controller = new AbortController()
    let live = true
    setLoading(true); setError('')
    void fetch(baseUrl.replace(/\/$/, '') + path, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) })
      .then(async (response) => {
        if (!response.ok) throw new Error(response.status === 404 ? 'This profile is unavailable.' : 'Could not load this profile. Please retry.')
        const value: unknown = await response.json()
        if (!value || typeof value !== 'object' || !('displayName' in value) || !('bio' in value) ||
          typeof value.displayName !== 'string' || typeof value.bio !== 'string') throw new Error('Could not load this profile. Please retry.')
        if (live) setProfile({ displayName: value.displayName, bio: value.bio })
      })
      .catch((error) => { if (live) setError(error instanceof Error ? error.message : 'Could not load this profile. Please retry.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false; controller.abort() }
  }, [baseUrl, path, name, open, attempt])

  return <>
    <button className="profile-link" aria-haspopup="dialog" aria-label={'View profile: ' + displayName} onClick={() => setOpen(true)}>{displayName}</button>
    <dialog className="public-profile-dialog" ref={dialog} aria-labelledby={titleId} onCancel={() => setOpen(false)} onClick={(event) => {
      if (event.target !== event.currentTarget) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setOpen(false)
    }}>
      <div className="public-profile-heading"><h2 id={titleId}>{displayName}</h2><button className="ghost small" aria-label="Close profile" onClick={() => setOpen(false)}>✕</button></div>
      {loading ? <p className="muted" role="status">Loading profile…</p> : error ? <div role="alert"><p>{error}</p><button className="ghost small" onClick={() => setAttempt((previous) => previous + 1)}>Retry profile</button></div> : <p className="public-profile-bio">{profile?.bio || 'No bio yet.'}</p>}
    </dialog>
  </>
}
