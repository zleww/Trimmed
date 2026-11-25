import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { Consent } from '../components/Consent'
import { Button, Field, Glass, Notice, Skeleton } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { errorMessage } from '../lib/format'
import { safeNext } from './AuthPage'

// After the email link. The sign-up form already collected everything, so the
// profile is made right away. The form below only shows when something is
// missing (an older account) or the username was taken in the meantime.
export function WelcomePage() {
  const { session, profile, staffRole, setProfile } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const pending = session?.pending ?? null

  const [username, setUsername] = useState(pending?.username ?? '')
  const [name, setName] = useState(pending?.full_name ?? '')
  const [mobile, setMobile] = useState(pending?.mobile ?? '')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(!pending)
  const tried = useRef(false)

  // already has a profile, or is staff: nothing to do here
  useEffect(() => {
    if (staffRole) navigate('/shop', { replace: true })
    else if (profile) navigate(next, { replace: true })
  }, [profile, staffRole, next, navigate])

  // they ticked the privacy box on the sign-up form, so finish with what they typed there
  useEffect(() => {
    if (!pending || profile !== null || staffRole !== null || tried.current) return
    tried.current = true
    api
      .saveProfile(pending.username, pending.full_name, pending.mobile, true)
      .then(async (saved) => {
        // the details now live in the profile; don't keep a second copy on the login
        await api.clearPending().catch(() => {})
        setProfile(saved)
      })
      .catch((reason) => {
        setError(errorMessage(reason))
        setConsent(true)
        setShowForm(true)
      })
  }, [pending, profile, staffRole, setProfile])

  if (session === null) return <Navigate to={`/signin?next=${encodeURIComponent(`/welcome?next=${next}`)}`} replace />
  if (session === undefined || profile === undefined || !showForm) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
        <p className="mb-4 text-center text-[15px] text-ink-2">{pending ? 'Finishing your account…' : 'Loading…'}</p>
        <Skeleton className="h-80" />
      </div>
    )
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (!consent) {
      setError('Please agree to the privacy notice to continue.')
      return
    }
    setBusy(true)
    try {
      const saved = await api.saveProfile(username, name, mobile, consent)
      await api.clearPending().catch(() => {})
      setProfile(saved)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-20">
      <h1 className="rise font-display text-[34px] leading-tight tracking-tight">One last step</h1>
      <p className="rise mt-2 text-[16px] text-ink-2">The shop uses these to know who's coming, and to reach you if your booking changes.</p>

      <Glass className="rise mt-8 p-6 sm:p-8 [animation-delay:80ms]">
        <form onSubmit={submit} className="space-y-5" noValidate>
          {error && <Notice tone="bad">{error}</Notice>}
          <Field
            label="Username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            hint="3 to 20 letters, numbers, dots or underscores. Shown on reviews."
          />
          <Field label="Display name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} hint="The name the shop will call you." />
          <Field
            label="Mobile number"
            type="tel"
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="0917 123 4567"
            required
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            hint="Philippine mobile, starting with 09."
          />
          <Consent checked={consent} onChange={setConsent} />
          <Button type="submit" className="h-12 w-full text-[16px]" loading={busy}>
            Save and continue
          </Button>
        </form>
      </Glass>
    </div>
  )
}
