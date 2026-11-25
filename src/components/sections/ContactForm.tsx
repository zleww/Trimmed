import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { errorMessage } from '../../lib/format'
import type { Branch } from '../../lib/types'
import { ArrowRight, CheckCircle } from '../icons'
import { Button, Field, Notice } from '../ui'

const MAX_NOTE = 1000

/**
 * Email, mobile number and a note. At least one way to reply is needed.
 * The database checks everything again and limits how often one sender can post.
 * A hidden "website" box catches simple spam bots: people never see it, bots fill it in.
 */
export function ContactForm({ branches }: { branches?: Branch[] }) {
  const id = useId()
  const { session, profile } = useAuth()
  const [email, setEmail] = useState(session?.email ?? '')
  const [mobile, setMobile] = useState(profile?.mobile ?? '')
  const [note, setNote] = useState('')
  const [branchId, setBranchId] = useState('')
  const [consent, setConsent] = useState(false)
  const [trap, setTrap] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<{ reply?: string; note?: string; consent?: string }>({})
  const [sent, setSent] = useState(false)

  async function send(event: FormEvent) {
    event.preventDefault()
    setError(null)
    const problems: typeof fieldErrors = {}
    if (!email.trim() && !mobile.trim()) problems.reply = 'Leave an email or a mobile number so the shop can reply.'
    if (mobile.trim() && !/^(09\d{9}|\+?639\d{9})$/.test(mobile.replace(/[\s-]/g, ''))) problems.reply = 'Enter a mobile number like 09171234567.'
    if (note.trim().length < 5) problems.note = 'Write a short note (at least 5 characters).'
    if (!consent) problems.consent = 'Tick the box so the shop may use your details to reply.'
    setFieldErrors(problems)
    if (Object.keys(problems).length > 0) return

    setBusy(true)
    try {
      // a bot filled the hidden box: act as if it worked, send nothing
      if (!trap) await api.sendContactMessage({ email, mobile, note, branchId: branchId || null, consent })
      setSent(true)
      setNote('')
      setConsent(false)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="glass flex h-full flex-col items-start justify-center gap-4 rounded-[2rem] p-6 sm:p-8" role="status">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-good-bg text-good">
          <CheckCircle size={24} />
        </span>
        <h3 className="font-display text-[28px] leading-tight">Thanks, your note is in.</h3>
        <p className="text-[16px] leading-relaxed text-ink-2">The shop will reply by email or text. For anything urgent, call the branch.</p>
        <Button variant="ghost" onClick={() => setSent(false)}>
          Send another note
        </Button>
      </div>
    )
  }

  const many = (branches?.length ?? 0) > 1

  return (
    <form onSubmit={send} noValidate className="glass relative space-y-5 rounded-[2rem] p-5 sm:p-8" aria-labelledby={`${id}-title`}>
      <div>
        <h3 id={`${id}-title`} className="font-display text-[26px] leading-tight sm:text-[30px]">
          Send us a note
        </h3>
        <p className="mt-1.5 text-[15px] text-ink-2">Leave an email, a number, or both.</p>
      </div>

      {error && <Notice tone="bad">{error}</Notice>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          maxLength={254}
          aria-invalid={fieldErrors.reply ? true : undefined}
          aria-describedby={fieldErrors.reply ? `${id}-reply-error` : undefined}
        />
        <Field
          label="Mobile number"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
          placeholder="09XXXXXXXXX"
          maxLength={16}
          aria-invalid={fieldErrors.reply ? true : undefined}
          aria-describedby={fieldErrors.reply ? `${id}-reply-error` : undefined}
        />
      </div>
      {fieldErrors.reply && (
        <p id={`${id}-reply-error`} className="-mt-3 text-[13px] text-bad">
          {fieldErrors.reply}
        </p>
      )}

      {many && (
        <div>
          <label htmlFor={`${id}-branch`} className="mb-1.5 block text-[14px] font-medium">
            Branch <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <select
            id={`${id}-branch`}
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="h-12 w-full cursor-pointer rounded-2xl border border-glass-line bg-[var(--glass)] px-4 text-[16px] text-ink outline-none focus:border-ink-2"
          >
            <option value="">Any branch</option>
            {branches?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor={`${id}-note`} className="mb-1.5 block text-[14px] font-medium">
          Note
        </label>
        <textarea
          id={`${id}-note`}
          rows={5}
          maxLength={MAX_NOTE}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-invalid={fieldErrors.note ? true : undefined}
          aria-describedby={`${id}-note-hint`}
          placeholder="A question about a cut, a group booking, anything."
          className={`w-full resize-y rounded-2xl border bg-[var(--glass)] px-4 py-3 text-[16px] text-ink outline-none placeholder:text-ink-3 focus:border-ink-2 ${
            fieldErrors.note ? 'border-bad/60' : 'border-glass-line'
          }`}
        />
        <p id={`${id}-note-hint`} className={`mt-1 flex justify-between gap-4 text-[13px] ${fieldErrors.note ? 'text-bad' : 'text-ink-3'}`}>
          <span>{fieldErrors.note ?? ''}</span>
          <span className="num text-ink-3">
            {note.length}/{MAX_NOTE}
          </span>
        </p>
      </div>

      {/* spam trap: hidden from people and screen readers */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={`${id}-website`}>Website</label>
        <input id={`${id}-website`} name="website" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
      </div>

      <div>
        <div className="flex gap-3">
          <input
            id={`${id}-consent`}
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            aria-invalid={fieldErrors.consent ? true : undefined}
            className="mt-0.5 size-5 shrink-0 cursor-pointer accent-[var(--accent)]"
          />
          <label htmlFor={`${id}-consent`} className="text-[14px] leading-relaxed text-ink-2">
            The shop may use my email and number to reply to this note, as described in the{' '}
            <Link to="/privacy" target="_blank" className="text-ink underline underline-offset-4">
              privacy notice
            </Link>
            .
          </label>
        </div>
        {fieldErrors.consent && <p className="mt-1.5 text-[13px] text-bad">{fieldErrors.consent}</p>}
      </div>

      <Button type="submit" loading={busy} className="h-12 w-full px-7 text-[16px] sm:w-auto">
        Send note
        <ArrowRight size={18} />
      </Button>
    </form>
  )
}
