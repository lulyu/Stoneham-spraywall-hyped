import SendHistory from './SendHistory'
import MyRoutes from './MyRoutes'
import { useId, useState } from 'react'
import { accessToken } from './auth'
import { profileRequest, type UserProfile } from './profile'

export default function Profile({ baseUrl, initial, email, userId, onSave, onClose, onOpenSend }: {
  baseUrl: string; initial: UserProfile; email: string; userId?: string
  onSave: (profile: UserProfile) => void; onClose: () => void; onOpenSend: (id: string) => Promise<void>
}) {
  const bioId = useId()
  const [displayName, setDisplayName] = useState(initial.displayName)
  const [bio, setBio] = useState(initial.bio)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <section className="profile-sheet" aria-label="Your profile">
    <div className="section-heading"><h2>Your profile</h2><button className="ghost small" disabled={busy} onClick={onClose}>Back to wall</button></div>
    <p className="muted">Your display name will prefill Setter for new problems. You can still change Setter for each problem.</p>
    <form onSubmit={async (event) => {
      event.preventDefault()
      if (busy) return
      setBusy(true); setError('')
      try {
        const result = await profileRequest(baseUrl, await accessToken(), { displayName: displayName.trim(), bio: bio.trim() })
        onSave(result)
      } catch (e) { setError(e instanceof Error ? e.message : 'Could not save profile.') }
      finally { setBusy(false) }
    }}>
      <fieldset className="editor-fields profile-fields" disabled={busy}>
        <label>Display name<input autoComplete="nickname" value={displayName} maxLength={60} required onChange={(e) => setDisplayName(e.target.value)} /></label>
        <div><label htmlFor={bioId}>Short bio</label><textarea id={bioId} rows={3} value={bio} maxLength={160} onChange={(e) => setBio(e.target.value)} placeholder="A little about you…" /></div>
        <span className="muted">{bio.length}/160</span>
        {email && <p className="muted">Email: {email} · Only visible to you</p>}
        {error && <p className="error-message" role="alert">{error}</p>}
        <button className="primary" disabled={busy || !displayName.trim()}>{busy ? 'Saving…' : 'Save profile'}</button>
      </fieldset>
    </form>
    {userId && <MyRoutes key={userId} baseUrl={baseUrl} onOpen={onOpenSend} />}
    <SendHistory baseUrl={baseUrl} onOpen={onOpenSend} />
  </section>
}
