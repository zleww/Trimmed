import { useId } from 'react'
import { Link } from 'react-router'

/** The privacy consent tick box (Data Privacy Act): needed before the shop keeps anyone's details. */
export function Consent({ checked, onChange, error }: { checked: boolean; onChange: (checked: boolean) => void; error?: string | null }) {
  const id = useId()
  return (
    <div>
      <div className="flex gap-3">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={error ? true : undefined}
          className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
        />
        <label htmlFor={id} className="text-[14px] leading-relaxed text-ink-2">
          I agree that the shop keeps my name, mobile number and bookings to manage my appointments, as described in the{' '}
          <Link to="/privacy" target="_blank" className="text-ink underline underline-offset-4">
            privacy notice
          </Link>
          . I can delete my data any time from Settings.
        </label>
      </div>
      {error && <p className="mt-1.5 text-[13px] text-bad">{error}</p>}
    </div>
  )
}
