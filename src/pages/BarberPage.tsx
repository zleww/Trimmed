import { useState, type FormEvent } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { FavouriteStar, StarPicker, Stars } from '../components/Barbers'
import { ArrowRight, ChevronLeft, MapPin, Trash } from '../components/icons'
import { Avatar, Button, ButtonLink, Glass, Notice, Skeleton } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { errorMessage } from '../lib/format'
import { useLoad } from '../lib/useLoad'

const MAX_COMMENT = 500

// One barber: photo, short bio, star rating, reviews, and a button to book them.
export function BarberPage() {
  const { id = '' } = useParams()
  const { session, profile } = useAuth()
  const { pathname } = useLocation()
  const barbers = useLoad(() => api.listBarbers(), [])
  const branches = useLoad(() => api.listBranches(), [])
  const ratings = useLoad(() => api.barberRatings(), [])
  // reload when the person changes, so "can I review?" and "mine" are right
  const reviews = useLoad(() => api.barberReviews(id), [id, session?.userId, profile?.id])
  const data = reviews.data
  const [saved, setSaved] = useState<string | null>(null)

  // after posting, changing or removing a review: fresh list and fresh average
  function afterSave(text: string) {
    setSaved(text)
    reviews.reload()
    ratings.reload()
  }

  const barber = barbers.data?.find((b) => b.id === id)
  const rating = ratings.data?.[id]
  const branch = branches.data?.find((b) => b.id === barber?.branch_id)
  const manyBranches = (branches.data?.length ?? 0) > 1

  if (barbers.loading && !barbers.data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Skeleton className="h-96" />
      </div>
    )
  }
  if (!barber) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 text-center">
        <h1 className="font-display text-[30px]">Barber not found</h1>
        <p className="mt-2 text-ink-2">They may no longer take bookings.</p>
        <ButtonLink to="/#barbers" variant="secondary" className="mt-6">
          See all barbers
        </ButtonLink>
      </div>
    )
  }

  const mine = data?.reviews.find((r) => r.mine)

  return (
    <div className="mx-auto max-w-3xl px-4 pt-6 pb-16 sm:px-6 sm:pt-10">
      <Link to="/#barbers" className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-full pr-3 pl-2 text-[15px] text-ink-2 hover:text-ink">
        <ChevronLeft size={18} />
        All barbers
      </Link>

      <div className="mt-4 grid grid-cols-1 gap-6 sm:grid-cols-[240px_minmax(0,1fr)] sm:items-end sm:gap-8">
        <div className="glass relative overflow-hidden rounded-3xl">
          <div className="aspect-square bg-raised sm:aspect-[4/5]">
            {barber.photo_url ? (
              <img src={barber.photo_url} alt={barber.display_name} className="size-full object-cover" />
            ) : (
              <div className="flex size-full items-center justify-center">
                <Avatar name={barber.display_name} size={96} />
              </div>
            )}
          </div>
          <FavouriteStar barber={barber} className="absolute top-3 right-3" />
        </div>

        <div className="min-w-0">
          <p className="text-[13px] font-medium tracking-[0.14em] text-accent-ink uppercase">
            Barber{manyBranches && branch ? ` · ${branch.name}` : ''}
          </p>
          <h1 className="mt-2 font-display text-[38px] leading-tight tracking-tight sm:text-[46px]">{barber.display_name}</h1>
          {barber.bio && <p className="mt-3 text-[16px] leading-relaxed text-ink-2">{barber.bio}</p>}
          {manyBranches && branch?.address && (
            <p className="mt-2 flex items-start gap-1.5 text-[14px] text-ink-3">
              <MapPin size={16} className="mt-0.5 shrink-0" />
              {branch.address}
            </p>
          )}
          <div className="mt-4 flex items-center gap-2 text-[15px] text-ink-2">
            {rating && rating.average !== null && rating.reviews > 0 ? (
              <>
                <Stars value={rating.average} size={18} />
                <span className="num font-medium text-ink">{rating.average.toFixed(1)}</span>
                <span className="num">
                  from {rating.reviews} review{rating.reviews === 1 ? '' : 's'}
                </span>
              </>
            ) : (
              <span>No reviews yet</span>
            )}
          </div>
          <ButtonLink to={`/book?branch=${barber.branch_id}&barber=${barber.id}`} className="mt-6 h-12 w-full px-7 text-[16px] sm:w-auto">
            Book with {barber.display_name.split(' ')[0]}
            <ArrowRight size={18} />
          </ButtonLink>
        </div>
      </div>

      <section className="mt-14" aria-labelledby="reviews-title">
        <h2 id="reviews-title" className="font-display text-[28px] tracking-tight">
          Reviews
        </h2>

        <div className="mt-5 space-y-3">
          {saved && <Notice tone="good">{saved}</Notice>}
          {!session ? (
            <Glass className="p-5 text-[15px] text-ink-2">
              <Link to={`/signin?next=${encodeURIComponent(pathname)}`} className="font-medium text-ink underline underline-offset-4">
                Sign in
              </Link>{' '}
              to leave a review after your cut.
            </Glass>
          ) : data?.can_review ? (
            <ReviewForm
              key={mine?.id ?? 'new'}
              barberId={barber.id}
              initialRating={mine?.rating ?? 0}
              initialComment={mine?.comment ?? ''}
              editing={Boolean(mine)}
              onSaved={afterSave}
              onEdit={() => setSaved(null)}
            />
          ) : data ? (
            <Glass className="p-5 text-[15px] text-ink-2">You can rate {barber.display_name} after your cut with them.</Glass>
          ) : null}
        </div>

        <ul className="mt-6 space-y-3">
          {reviews.loading && !data && <Skeleton className="h-28" />}
          {data?.reviews.length === 0 && <p className="text-[15px] text-ink-3">No reviews yet. Be the first after your cut.</p>}
          {data?.reviews.map((review) => (
            <li key={review.id}>
              <Glass className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[15px] font-medium">
                    {review.username ? `@${review.username}` : 'A customer'}
                    {review.mine && <span className="ml-2 text-[13px] font-normal text-accent-ink">You</span>}
                  </p>
                  <Stars value={review.rating} />
                </div>
                {review.comment && <p className="mt-2 text-[15px] leading-relaxed whitespace-pre-line text-ink-2">{review.comment}</p>}
                <p className="mt-2 text-[13px] text-ink-3">
                  {new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(review.created_at))}
                  {review.edited && ' · edited'}
                </p>
              </Glass>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

function ReviewForm({
  barberId,
  initialRating,
  initialComment,
  editing,
  onSaved,
  onEdit,
}: {
  barberId: string
  initialRating: number
  initialComment: string
  editing: boolean
  onSaved: (message: string) => void
  onEdit: () => void
}) {
  const [rating, setRatingState] = useState(initialRating)
  const [comment, setCommentState] = useState(initialComment)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // any change clears the old "saved" or error message
  const setRating = (value: number) => {
    setRatingState(value)
    setError(null)
    onEdit()
  }
  const setComment = (value: string) => {
    setCommentState(value)
    setError(null)
    onEdit()
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (rating === 0) {
      setError('Tap a star to rate first.')
      return
    }
    setBusy(true)
    try {
      await api.reviewBarber(barberId, rating, comment)
      onSaved(editing ? 'Review updated.' : 'Thanks! Your review is up.')
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await api.removeMyReview(barberId)
      onSaved('Your review was removed.')
    } catch (reason) {
      setError(errorMessage(reason))
      setBusy(false)
    }
  }

  return (
    <Glass className="p-5 sm:p-6">
      <form onSubmit={save} className="space-y-4" noValidate>
        <p className="text-[16px] font-medium">{editing ? 'Your review' : 'How was your cut?'}</p>
        {error && <Notice tone="bad">{error}</Notice>}
        <StarPicker value={rating} onChange={setRating} />
        <div>
          <label htmlFor="review-comment" className="mb-1.5 block text-[14px] font-medium">
            Comment <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <textarea
            id="review-comment"
            rows={3}
            maxLength={MAX_COMMENT}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="w-full resize-y rounded-2xl border border-glass-line bg-[var(--glass)] px-4 py-3 text-[16px] text-ink outline-none placeholder:text-ink-3 focus:border-ink-2"
            placeholder="What did you like? Anything to improve?"
          />
          <p className="num mt-1 text-right text-[12px] text-ink-3">
            {comment.length}/{MAX_COMMENT}
          </p>
        </div>
        <p className="text-[13px] text-ink-3">Shown with your username, never your name or number.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {editing && (
            <Button type="button" variant="ghost" onClick={remove} disabled={busy}>
              <Trash size={18} />
              Remove
            </Button>
          )}
          {/* secondary: "Book with..." is this page's one main button */}
          <Button type="submit" variant="secondary" loading={busy}>
            {editing ? 'Update review' : 'Post review'}
          </Button>
        </div>
      </form>
    </Glass>
  )
}
