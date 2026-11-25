import { useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { PHOTOS, type Photo } from '../../content/photos'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { gsap, MOTION, useGSAP } from '../../lib/gsap'
import type { Branch, Rating, Review } from '../../lib/types'
import { useLoad } from '../../lib/useLoad'
import { useReveal } from '../../lib/useReveal'
import { Stars } from '../Barbers'
import { ArrowRight, ArrowUpRight, MapPin, Phone } from '../icons'
import { ReviewForm } from '../ReviewForm'
import { buttonClass, Notice, Skeleton } from '../ui'
import { SectionHead } from './SectionHead'

// branches have no photos in the database yet: they take these in turn
const BRANCH_PHOTOS: Photo[] = [PHOTOS.chairBrick, PHOTOS.salonDim, PHOTOS.clientChair]

type Props = {
  branches?: Branch[]
  ratings?: Record<string, Rating>
  loading: boolean
  /** ask the page for fresh star averages after someone posts a review */
  onReviewed: () => void
}

/** Each location up close: a photo, what it's like, where it is, and what customers say after a visit. */
export function Branches({ branches, ratings, loading, onReviewed }: Props) {
  const root = useRef<HTMLElement>(null)
  useReveal(root, [branches?.length])
  const many = (branches?.length ?? 0) > 1

  return (
    <section ref={root} id="branches" aria-labelledby="branches-title" className="scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead
          id="branches-title"
          label="Branches"
          title={many ? 'One standard, every branch.' : 'Our branch.'}
          text="Where to find us, what it's like inside, and what customers say after a visit."
        />

        <div className="mt-14 space-y-6 sm:space-y-10">
          {loading && !branches && <Skeleton className="h-[32rem]" />}
          {branches?.length === 0 && <p className="glass rounded-3xl p-6 text-center text-ink-2">Our branches will be listed here soon.</p>}
          {branches?.map((branch, i) => (
            <BranchFeature
              key={branch.id}
              branch={branch}
              index={i}
              rating={ratings?.[branch.id]}
              photo={BRANCH_PHOTOS[i % BRANCH_PHOTOS.length]!}
              onReviewed={onReviewed}
            />
          ))}
        </div>
      </div>
    </section>
  )
}

function BranchFeature({
  branch,
  index,
  rating,
  photo,
  onReviewed,
}: {
  branch: Branch
  index: number
  rating?: Rating
  photo: Photo
  onReviewed: () => void
}) {
  const root = useRef<HTMLElement>(null)
  const { session, profile } = useAuth()
  const { pathname } = useLocation()
  const reviews = useLoad(() => api.branchReviews(branch.id), [branch.id, session?.userId, profile?.id])
  const [showAll, setShowAll] = useState(false)
  const [writing, setWriting] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const data = reviews.data
  const mine = data?.reviews.find((r) => r.mine)
  const flip = index % 2 === 1 // every second branch puts its photo on the right

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION.ok, () => {
        gsap.fromTo(
          '[data-branch-photo]',
          { yPercent: -6, scale: 1.08 },
          { yPercent: 6, scale: 1, ease: 'none', scrollTrigger: { trigger: root.current, start: 'top bottom', end: 'bottom top', scrub: 1 } },
        )
      })
      return () => mm.revert()
    },
    { scope: root },
  )

  const directions = branch.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${branch.name}, ${branch.address}`)}`
    : null
  const list = data?.reviews ?? []
  const shown = showAll ? list : list.slice(0, 2)

  function afterSave(message: string) {
    setSaved(message)
    setWriting(false)
    reviews.reload()
    onReviewed()
  }

  return (
    <article ref={root} data-reveal aria-labelledby={`branch-${branch.id}`} className="glass overflow-hidden rounded-[2rem] p-2 sm:rounded-[2.5rem]">
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {/* photo */}
        <div className={`relative min-h-64 overflow-hidden rounded-[1.6rem] sm:min-h-80 sm:rounded-[2.1rem] ${flip ? 'lg:order-2' : ''}`}>
          <img
            data-branch-photo
            src={photo.src}
            alt=""
            width={photo.width}
            height={photo.height}
            loading="lazy"
            decoding="async"
            className="photo-warm absolute inset-0 size-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-bg/80 via-transparent to-transparent" />
          <p className="num absolute bottom-5 left-5 font-display text-[64px] leading-none text-ink/85 sm:text-[88px]">{String(index + 1).padStart(2, '0')}</p>
          {rating && rating.reviews > 0 && rating.average !== null && (
            <p className="glass absolute top-4 right-4 flex items-center gap-2 rounded-full px-3 py-1.5 text-[14px]">
              <Stars value={rating.average} size={13} />
              <span className="num font-medium">{rating.average.toFixed(1)}</span>
            </p>
          )}
        </div>

        {/* words */}
        <div className="flex min-w-0 flex-col p-4 sm:p-7">
          <p className="label">Branch {String(index + 1).padStart(2, '0')}</p>
          <h3 id={`branch-${branch.id}`} className="mt-3 font-display text-[clamp(1.9rem,6vw,2.6rem)] leading-[1.05] tracking-[-0.02em]">
            {branch.name}
          </h3>
          <p className="mt-4 text-[16px] leading-relaxed text-ink-2">{branch.description ?? '[A few words about this branch]'}</p>

          <ul className="mt-5 space-y-2 text-[15px] text-ink-2">
            {branch.address && (
              <li className="flex gap-2.5">
                <MapPin size={17} className="mt-0.5 shrink-0 text-accent-ink" />
                {branch.address}
              </li>
            )}
            {branch.phone && (
              <li>
                <a href={`tel:${branch.phone.replace(/\s/g, '')}`} className="num inline-flex items-center gap-2.5 hover:text-ink">
                  <Phone size={17} className="shrink-0 text-accent-ink" />
                  {branch.phone}
                </a>
              </li>
            )}
          </ul>

          <div className="mt-6 flex flex-wrap gap-2">
            <Link to={`/book?branch=${branch.id}`} className={buttonClass('secondary', 'h-12 px-5 text-[15px]')}>
              Book at this branch
              <ArrowRight size={17} />
            </Link>
            {directions && (
              <a href={directions} target="_blank" rel="noopener noreferrer" className={buttonClass('ghost', 'h-12 px-4 text-[15px]')}>
                Directions
                <ArrowUpRight size={16} />
                <span className="sr-only">(opens Google Maps)</span>
              </a>
            )}
          </div>

          {/* reviews */}
          <div className="mt-8 border-t border-glass-line pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-[16px] font-medium">What customers say</h4>
              <ReviewSummary rating={rating} />
            </div>

            {saved && (
              <div className="mt-4">
                <Notice tone="good">{saved}</Notice>
              </div>
            )}

            <ul className="mt-4 space-y-3">
              {reviews.loading && !data && <Skeleton className="h-20" />}
              {data && list.length === 0 && <li className="text-[15px] text-ink-3">No reviews yet. Be the first after your visit.</li>}
              {shown.map((review) => (
                <ReviewItem key={review.id} review={review} />
              ))}
            </ul>
            {list.length > 2 && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                aria-expanded={showAll}
                className="mt-3 min-h-11 cursor-pointer text-[14px] font-medium text-ink underline-offset-4 hover:underline"
              >
                {showAll ? 'Show fewer' : `Show all ${list.length} reviews`}
              </button>
            )}

            <div className="mt-4">
              {!session ? (
                <p className="text-[14px] text-ink-3">
                  <Link to={`/signin?next=${encodeURIComponent(`${pathname}#branches`)}`} className="font-medium text-ink underline underline-offset-4">
                    Sign in
                  </Link>{' '}
                  to rate this branch after your visit.
                </p>
              ) : data?.can_review ? (
                writing ? (
                  <ReviewForm
                    key={mine?.id ?? 'new'}
                    prompt="How was your visit?"
                    initialRating={mine?.rating ?? 0}
                    initialComment={mine?.comment ?? ''}
                    editing={Boolean(mine)}
                    onSubmit={(stars, comment) => api.reviewBranch(branch.id, stars, comment)}
                    onRemove={() => api.removeMyBranchReview(branch.id)}
                    onSaved={afterSave}
                    onEdit={() => setSaved(null)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setSaved(null)
                      setWriting(true)
                    }}
                    className={buttonClass('ghost', 'h-11 px-4 text-[14px]')}
                  >
                    {mine ? 'Edit your review' : 'Rate this branch'}
                  </button>
                )
              ) : data ? (
                <p className="text-[14px] text-ink-3">You can rate this branch after a visit there.</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

function ReviewSummary({ rating }: { rating?: Rating }) {
  if (!rating || rating.reviews === 0 || rating.average === null) return <span className="text-[14px] text-ink-3">No reviews yet</span>
  return (
    <span className="flex items-center gap-2 text-[14px] text-ink-2" aria-label={`Rated ${rating.average.toFixed(1)} out of 5 from ${rating.reviews} review${rating.reviews === 1 ? '' : 's'}`}>
      <Stars value={rating.average} />
      <span aria-hidden="true">
        <span className="num font-medium text-ink">{rating.average.toFixed(1)}</span> · <span className="num">{rating.reviews}</span>{' '}
        {rating.reviews === 1 ? 'review' : 'reviews'}
      </span>
    </span>
  )
}

function ReviewItem({ review }: { review: Review }) {
  return (
    <li>
      <div className="glass rounded-2xl p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[14px] font-medium">
            {review.username ? `@${review.username}` : 'A customer'}
            {review.mine && <span className="ml-2 text-[13px] font-normal text-accent-ink">You</span>}
          </p>
          <Stars value={review.rating} size={13} />
        </div>
        {review.comment && <p className="mt-2 text-[15px] leading-relaxed whitespace-pre-line text-ink-2">{review.comment}</p>}
        <p className="mt-2 text-[12px] text-ink-3">
          {new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(review.created_at))}
          {review.edited && ' · edited'}
        </p>
      </div>
    </li>
  )
}
