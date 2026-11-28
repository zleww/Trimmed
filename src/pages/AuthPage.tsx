import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Consent } from '../components/Consent'
import { Calendar, Camera, Move, Star } from '../components/icons'
import { Button, Field, Glass, Notice, PasswordField } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { cleanMobile, cleanUsername, errorMessage, passwordProblem } from '../lib/format'
import { useDebounced } from '../lib/useLoad'

/** Only allow going back to a page on this site after sign-in. */
export function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : '/account'
}

export function AuthPage({ mode }: { mode: 'signin' | 'signup' }) {
  const { session, profile, staffRole } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))

  // signed in: staff go to the shop screens; customers go on, through the profile step if it isn't done
  useEffect(() => {
    if (!session || profile === undefined || staffRole === undefined) return
    if (staffRole) navigate(params.get('next') ? next : '/shop', { replace: true })
    else navigate(profile ? next : `/welcome?next=${encodeURIComponent(next)}`, { replace: true })
  }, [session, profile, staffRole, next, params, navigate])

  const other = mode === 'signin' ? 'signup' : 'signin'
  const otherLink = `/${other}${params.get('next') ? `?next=${encodeURIComponent(next)}` : ''}`

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 sm:px-6 sm:py-10 lg:grid-cols-[1.05fr_1fr] lg:gap-12 lg:py-14">
      {/* the shop, so the page isn't just a form: photo + what an account gives you */}
      <aside className="rise relative min-h-56 overflow-hidden rounded-3xl lg:min-h-[640px]">
        <img src="/images/client-chair.webp" alt="" className="absolute inset-0 size-full object-cover" />
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/10" />
        <div className="relative flex h-full flex-col justify-end p-6 text-white sm:p-8">
          <p className="text-[12px] font-semibold tracking-[0.2em] text-accent-ink uppercase">{mode === 'signin' ? 'Welcome back' : 'Join Trimmed'}</p>
          <p className="mt-2 max-w-sm font-display text-[30px] leading-tight sm:text-[38px]">
            {mode === 'signin' ? 'Your chair is waiting.' : 'Book your barber in a few taps.'}
          </p>
          <ul className="mt-5 hidden space-y-2.5 text-[15px] text-white/85 sm:block">
            {PERKS.map(([Icon, text]) => (
              <li key={text} className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/15 backdrop-blur">
                  <Icon size={16} />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <div className="flex flex-col justify-center lg:py-6">
        <div className="rise [animation-delay:60ms]">
          <h1 className="font-display text-[34px] leading-tight tracking-tight">{mode === 'signin' ? 'Sign in' : 'Create your account'}</h1>
          <p className="mt-2 text-[16px] text-ink-2">
            {mode === 'signin' ? 'Use your email or username.' : 'So you can book, and cancel or move a booking any time.'}
          </p>
        </div>

        <Glass className="rise mt-6 p-6 sm:p-8 [animation-delay:120ms]">{mode === 'signin' ? <SignInForm /> : <SignUpForm />}</Glass>

        <p className="mt-6 text-center text-[15px] text-ink-2">
          {mode === 'signin' ? 'New here? ' : 'Already have an account? '}
          <Link to={otherLink} className="font-medium text-ink underline-offset-4 hover:underline">
            {mode === 'signin' ? 'Create an account' : 'Sign in'}
          </Link>
        </p>
        <p className="mt-3 text-center text-[13px] text-ink-3">
          Just looking?{' '}
          <Link to="/" className="underline-offset-4 hover:underline">
            Browse services and prices
          </Link>
        </p>
      </div>
    </div>
  )
}

// what an account gives you, on the photo panel
const PERKS: [typeof Calendar, string][] = [
  [Calendar, 'Pick your barber, day and time'],
  [Move, 'Move or cancel from your phone'],
  [Camera, 'Send inspo photos to your barber'],
  [Star, 'Rate your cut after the visit'],
]

function SignInForm() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetSent, setResetSent] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(email.trim(), password)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  async function forgot() {
    setError(null)
    if (!email.trim().includes('@')) {
      setError('Type your email (not your username) first, then tap "Forgot password" again.')
      return
    }
    setBusy(true)
    try {
      await api.sendPasswordReset(email.trim())
      setResetSent(true)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  if (resetSent) {
    return (
      <Notice tone="good">
        If there's an account for {email}, a link to set a new password is on its way. Open it on this device; it takes you
        straight to a page to type the new one.
      </Notice>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && <Notice tone="bad">{error}</Notice>}
      <Field
        label="Email or username"
        type="text"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <PasswordField label="Password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      <Button type="submit" className="h-12 w-full text-[16px]" loading={busy}>
        Sign in
      </Button>
      <button type="button" onClick={forgot} className="block min-h-11 w-full text-center text-[14px] text-ink-2 hover:text-ink">
        Forgot password?
      </button>
    </form>
  )
}

type Errors = Partial<Record<'username' | 'name' | 'email' | 'mobile' | 'password' | 'confirm' | 'consent', string>>

function SignUpForm() {
  const { signUp } = useAuth()
  const [username, setUsername] = useState('')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [mobile, setMobile] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)

  // check the username while they type, after a short pause
  const typed = useDebounced(username, 400)
  const [free, setFree] = useState<{ name: string; ok: boolean } | null>(null)
  useEffect(() => {
    const clean = cleanUsername(typed)
    if (!clean) return
    let current = true
    api
      .usernameAvailable(clean)
      .then((ok) => current && setFree({ name: clean, ok }))
      .catch(() => {})
    return () => {
      current = false
    }
  }, [typed])

  const clean = cleanUsername(username)
  const usernameHint =
    username.trim() === ''
      ? '3 to 20 letters, numbers, dots or underscores. Shown on reviews instead of your name.'
      : !clean
        ? 'Use 3 to 20 letters, numbers, dots or underscores. No spaces.'
        : free?.name !== clean
          ? 'Checking…'
          : free.ok
            ? `@${clean} is free.`
            : undefined

  function check(): Errors {
    const found: Errors = {}
    if (!clean) found.username = 'Use 3 to 20 letters, numbers, dots or underscores. No spaces.'
    else if (free?.name === clean && !free.ok) found.username = `@${clean} is taken. Try another.`
    if (name.trim().length < 2 || name.trim().length > 80) found.name = 'Enter the name the shop should call you.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) found.email = 'Enter a valid email address.'
    if (!cleanMobile(mobile)) found.mobile = 'Enter an 11-digit mobile number that starts with 09.'
    const weak = passwordProblem(password)
    if (weak) found.password = weak
    if (!weak && confirm !== password) found.confirm = "The two passwords don't match."
    if (!consent) found.consent = 'Please agree to the privacy notice to continue.'
    return found
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const found = check()
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    try {
      // last check right before sending, in case someone took it a moment ago
      if (!(await api.usernameAvailable(clean!))) {
        setErrors({ username: `@${clean} is taken. Try another.` })
        return
      }
      const result = await signUp(email.trim(), password, { username: clean!, full_name: name.trim(), mobile: cleanMobile(mobile)! })
      if (result.needsConfirm) setSentTo(email.trim())
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  if (sentTo) {
    return (
      <Notice tone="good">
        We sent a link to {sentTo}. Open it on this phone to finish making your account. Your username, name and number are
        saved for when you do.
      </Notice>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      {error && <Notice tone="bad">{error}</Notice>}
      <Field
        label="Username"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        error={errors.username ?? (clean && free?.name === clean && !free.ok ? `@${clean} is taken. Try another.` : null)}
        hint={usernameHint}
      />
      <Field
        label="Display name"
        autoComplete="name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={errors.name}
        hint="The name the shop will call you."
      />
      <Field label="Email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} error={errors.email} />
      <Field
        label="Mobile number"
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        placeholder="0917 123 4567"
        required
        value={mobile}
        onChange={(e) => setMobile(e.target.value)}
        error={errors.mobile}
        hint="The shop calls or texts only about your bookings."
      />
      <PasswordField
        label="Create password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        error={errors.password}
        hint="At least 10 characters, with letters and numbers."
      />
      <PasswordField
        label="Confirm password"
        autoComplete="new-password"
        required
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={errors.confirm}
      />
      <Consent checked={consent} onChange={setConsent} error={errors.consent} />
      <Button type="submit" className="h-12 w-full text-[16px]" loading={busy}>
        Create account
      </Button>
    </form>
  )
}
