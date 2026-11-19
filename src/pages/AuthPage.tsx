import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Eye, EyeOff } from '../components/icons'
import { Button, Field, Glass, Notice } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { errorMessage } from '../lib/format'

/** Only allow going back to a page on this site after sign-in. */
export function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/account'
}

export function AuthPage({ mode }: { mode: 'signin' | 'signup' }) {
  const { session, profile, signIn, signUp } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<'confirm' | 'reset' | null>(null)

  // signed in: go on, through the profile step if it isn't done
  useEffect(() => {
    if (!session || profile === undefined) return
    navigate(profile ? next : `/welcome?next=${encodeURIComponent(next)}`, { replace: true })
  }, [session, profile, next, navigate])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (mode === 'signup' && !/^(?=.*[A-Za-z])(?=.*\d).{10,}$/.test(password)) {
      setError('Use at least 10 characters, with letters and numbers.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'signin') {
        await signIn(email.trim(), password)
      } else {
        const result = await signUp(email.trim(), password)
        if (result.needsConfirm) setSent('confirm')
      }
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  async function forgot() {
    setError(null)
    if (!email.trim()) {
      setError('Type your email first, then tap "Forgot password" again.')
      return
    }
    setBusy(true)
    try {
      await api.sendPasswordReset(email.trim())
      setSent('reset')
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const other = mode === 'signin' ? 'signup' : 'signin'
  const otherLink = `/${other}${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-20">
      <div className="rise">
        <h1 className="text-[32px] font-semibold tracking-tight">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1>
        <p className="mt-2 text-[16px] text-ink-2">
          {mode === 'signin' ? 'Sign in to book and manage your bookings.' : 'So you can book, and cancel or move a booking any time.'}
        </p>
      </div>

      <Glass className="rise mt-8 p-6 sm:p-8 [animation-delay:80ms]">
        {sent ? (
          <Notice tone="good">
            {sent === 'confirm'
              ? `We sent a link to ${email}. Open it on this phone to finish making your account.`
              : `If there's an account for ${email}, a link to set a new password is on its way.`}
          </Notice>
        ) : (
          <form onSubmit={submit} className="space-y-5" noValidate>
            {error && <Notice tone="bad">{error}</Notice>}
            <Field
              label="Email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <Field
              label="Password"
              type={showPassword ? 'text' : 'password'}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              hint={mode === 'signup' ? 'At least 10 characters, with letters and numbers.' : undefined}
              trailing={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="flex size-11 items-center justify-center rounded-full text-ink-2 hover:text-ink"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              }
            />
            <Button type="submit" className="h-12 w-full text-[16px]" loading={busy}>
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
            {mode === 'signin' && (
              <button type="button" onClick={forgot} className="block min-h-11 w-full text-center text-[14px] text-ink-2 hover:text-ink">
                Forgot password?
              </button>
            )}
          </form>
        )}
      </Glass>

      <p className="mt-6 text-center text-[15px] text-ink-2">
        {mode === 'signin' ? 'New here? ' : 'Already have an account? '}
        <Link to={otherLink} className="font-medium text-ink underline-offset-4 hover:underline">
          {mode === 'signin' ? 'Create an account' : 'Sign in'}
        </Link>
      </p>
    </div>
  )
}
