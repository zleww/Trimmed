import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button, Glass, Notice, PasswordField, Skeleton } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { errorMessage, passwordProblem } from '../lib/format'

// Where the "forgot password" email link lands. The link signs you in for a
// short while; this page uses that to save the new password.
// Signed-in customers also come here from Settings > Change password.
export function NewPasswordPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const weak = passwordProblem(password)
    const found = weak ? { password: weak } : confirm !== password ? { confirm: "The two passwords don't match." } : {}
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    try {
      await api.updatePassword(password)
      setSaved(true)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-20">
      <h1 className="rise font-display text-[34px] leading-tight tracking-tight">Set a new password</h1>
      <p className="rise mt-2 text-[16px] text-ink-2">Pick one you don't use anywhere else.</p>

      <Glass className="rise mt-8 p-6 sm:p-8 [animation-delay:80ms]">
        {session === undefined ? (
          <Skeleton className="h-48" />
        ) : session === null ? (
          // the link expired, was used already, or opened in another browser
          <div className="space-y-4">
            <Notice tone="warn">This link has expired or was already used. Ask for a new one from the sign-in page.</Notice>
            <Link to="/signin" className="block text-center text-[15px] font-medium text-ink underline-offset-4 hover:underline">
              Go to sign in
            </Link>
          </div>
        ) : saved ? (
          <div className="space-y-5">
            <Notice tone="good">Your password is changed. Use it next time you sign in.</Notice>
            <Button className="h-12 w-full text-[16px]" onClick={() => navigate('/account', { replace: true })}>
              Go to my account
            </Button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-5" noValidate>
            {error && <Notice tone="bad">{error}</Notice>}
            <p className="text-[14px] text-ink-2">For {session.email}</p>
            <PasswordField
              label="New password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={errors.password}
              hint="At least 10 characters, with letters and numbers."
            />
            <PasswordField
              label="Confirm new password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              error={errors.confirm}
            />
            <Button type="submit" className="h-12 w-full text-[16px]" loading={busy}>
              Save new password
            </Button>
          </form>
        )}
      </Glass>
    </div>
  )
}
