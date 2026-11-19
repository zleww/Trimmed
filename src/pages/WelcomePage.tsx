import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router'
import { Button, Field, Glass, Notice, Skeleton } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { errorMessage } from '../lib/format'
import { safeNext } from './AuthPage'

// After sign-up: the two things the shop needs, plus the privacy consent.
export function WelcomePage() {
  const { session, profile, setProfile } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const consentId = useId()

  const [name, setName] = useState('')
  const [mobile, setMobile] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // already has a profile: nothing to do here
  useEffect(() => {
    if (profile) navigate(next, { replace: true })
  }, [profile, next, navigate])

  if (session === null) return <Navigate to={`/signin?next=${encodeURIComponent(`/welcome?next=${next}`)}`} replace />
  if (session === undefined || profile === undefined) {
    return (
      <div className="mx-auto max-w-md px-4 py-20">
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
      setProfile(await api.saveProfile(name, mobile, consent))
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-20">
      <h1 className="rise text-[32px] font-semibold tracking-tight">One last step</h1>
      <p className="rise mt-2 text-[16px] text-ink-2">The shop uses these to know who's coming, and to reach you if your booking changes.</p>

      <Glass className="rise mt-8 p-6 sm:p-8 [animation-delay:80ms]">
        <form onSubmit={submit} className="space-y-5" noValidate>
          {error && <Notice tone="bad">{error}</Notice>}
          <Field label="Full name" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} />
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
          <div className="flex gap-3">
            <input
              id={consentId}
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
            />
            <label htmlFor={consentId} className="text-[14px] leading-relaxed text-ink-2">
              I agree that the shop keeps my name, mobile number and bookings to manage my appointments, as described in the{' '}
              <Link to="/privacy" target="_blank" className="text-ink underline underline-offset-4">
                privacy notice
              </Link>
              . I can delete my data any time from Settings.
            </label>
          </div>
          <Button type="submit" className="h-12 w-full text-[16px]" loading={busy}>
            Save and continue
          </Button>
        </form>
      </Glass>
    </div>
  )
}
