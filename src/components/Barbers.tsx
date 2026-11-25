import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import type { Barber, Rating } from '../lib/types'
import { ArrowRight, Star } from './icons'
import { Avatar } from './ui'

/** 4.5 -> four full stars and a half one (rounded to the nearest half), with the number for screen readers. */
export function Stars({ value, size = 14 }: { value: number; size?: number }) {
  const halves = Math.round(value * 2) // 4.3 -> 9 halves -> 4.5 stars
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const fill = halves >= n * 2 ? 'full' : halves === n * 2 - 1 ? 'half' : 'none'
        return (
          <span key={n} className="relative inline-flex">
            <Star size={size} className={fill === 'full' ? 'text-accent' : 'text-ink-3'} filled={fill === 'full'} />
            {/* a half star: the filled one, cut off at the middle, on top of the empty one */}
            {fill === 'half' && (
              <span className="absolute inset-y-0 left-0 w-1/2 overflow-hidden text-accent">
                <Star size={size} filled />
              </span>
            )}
          </span>
        )
      })}
    </span>
  )
}

/** Short enough for a small card: "★ 4.5 (12)", or "New" when nobody has rated yet. */
export function RatingLine({ rating, className = '' }: { rating?: Rating; className?: string }) {
  if (!rating || rating.reviews === 0 || rating.average === null) {
    return <span className={`block text-[13px] text-ink-3 ${className}`}>No reviews yet</span>
  }
  return (
    <span
      className={`inline-flex items-center gap-1 text-[13px] text-ink-2 ${className}`}
      aria-label={`Rated ${rating.average.toFixed(1)} out of 5 from ${rating.reviews} review${rating.reviews === 1 ? '' : 's'}`}
    >
      <Star size={13} filled className="text-accent" />
      <span className="num font-medium text-ink">{rating.average.toFixed(1)}</span>
      <span className="num">({rating.reviews})</span>
    </span>
  )
}

/** Pick 1 to 5 stars. Arrow keys work too, since it's a radio group. */
export function StarPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const labels = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent']
  return (
    <div>
      <div role="radiogroup" aria-label="Your rating" className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="cursor-pointer">
            <input type="radio" name="rating" value={n} checked={value === n} onChange={() => onChange(n)} className="peer sr-only" />
            <span
              className={`flex size-11 items-center justify-center rounded-full transition peer-focus-visible:outline-2 peer-focus-visible:outline-ink-2 ${
                n <= value ? 'text-accent' : 'text-ink-3 hover:text-ink-2'
              }`}
            >
              <Star size={28} filled={n <= value} />
              <span className="sr-only">{labels[n - 1]}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="mt-1 h-5 text-[13px] text-ink-2">{value > 0 ? labels[value - 1] : 'Tap a star'}</p>
    </div>
  )
}

/**
 * The star in the corner: marks one barber as your favourite (picked for you
 * when you book). Signed out, it sends you to sign in first.
 */
export function FavouriteStar({ barber, className = '' }: { barber: Barber; className?: string }) {
  const { session, profile, setProfile } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [busy, setBusy] = useState(false)
  const on = profile?.preferred_barber === barber.id

  async function toggle() {
    if (!session || !profile) {
      navigate(`/signin?next=${encodeURIComponent(pathname)}`)
      return
    }
    setBusy(true)
    // show it at once; put it back if saving fails
    const before = profile
    setProfile({ ...profile, preferred_barber: on ? null : barber.id })
    try {
      setProfile(await api.setFavourite(on ? null : barber.id))
    } catch {
      setProfile(before)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={on}
      aria-label={on ? `${barber.display_name} is your favourite. Tap to remove.` : `Make ${barber.display_name} your favourite`}
      className={`flex size-11 items-center justify-center rounded-full border backdrop-blur-md transition active:scale-95 ${
        on ? 'border-accent/40 bg-bg/70 text-accent' : 'border-glass-line bg-bg/55 text-ink hover:text-accent'
      } ${className}`}
    >
      <Star size={20} filled={on} />
    </button>
  )
}

/** A barber on the home page: photo, name, rating; tap to see their page, star to favourite. */
export function BarberCard({ barber, rating }: { barber: Barber; rating?: Rating }) {
  return (
    // the star sits beside the link, not inside it, so each does one thing
    <div className="glass group relative flex min-w-0 flex-col overflow-hidden rounded-3xl transition hover:border-ink-3">
      <Link to={`/barbers/${barber.id}`} className="flex min-w-0 flex-1 flex-col">
        <div className="relative aspect-[4/5] bg-raised">
          {barber.photo_url ? (
            <img src={barber.photo_url} alt="" className="size-full object-cover" loading="lazy" />
          ) : (
            <div className="flex size-full items-center justify-center">
              <Avatar name={barber.display_name} size={72} />
            </div>
          )}
        </div>
        <div className="flex items-end justify-between gap-2 p-4">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium">{barber.display_name}</p>
            <RatingLine rating={rating} className="mt-1" />
          </div>
          <ArrowRight size={16} className="mb-0.5 shrink-0 text-ink-3 transition group-hover:translate-x-0.5 group-hover:text-ink" />
        </div>
      </Link>
      <FavouriteStar barber={barber} className="absolute top-2.5 right-2.5" />
    </div>
  )
}
