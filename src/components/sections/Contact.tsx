import { useRef, useState } from 'react'
import { PHOTOS } from '../../content/photos'
import { formatClock, manilaToday, WEEKDAYS, weekdayOf } from '../../lib/dates'
import { gsap, prefersReducedMotion, useGSAP } from '../../lib/gsap'
import type { Branch, OpeningHours } from '../../lib/types'
import { useReveal } from '../../lib/useReveal'
import { ArrowUpRight, MapPin, Phone, Plus } from '../icons'
import { Skeleton } from '../ui'
import { SectionHead } from './SectionHead'

// only what the system really does: no promises the shop hasn't made
const FAQ = [
  { q: 'Do I pay online?', a: 'No. You pay at the shop after your cut. The price you see when you book is the price you pay.' },
  {
    q: 'When is my booking confirmed?',
    a: 'Online bookings are requests. The front desk confirms them and you see the status change in My bookings. While it waits, the time is held for you.',
  },
  { q: 'Can I choose my barber?', a: 'Yes. Pick a barber, or choose any barber to get the earliest free time.' },
  { q: 'Can I cancel or move my booking?', a: 'Yes, from My bookings in your account, before the shop’s cut-off time.' },
  { q: 'Why do I need an account?', a: 'It keeps your bookings in one place and lets the shop reach you about them.' },
]

type Props = {
  branches?: Branch[]
  hours: OpeningHours[]
  loading: boolean
  timeFormat: '12h' | '24h'
}

/** Contact: each location with its hours, a photo of the room, and common questions. */
export function Contact({ branches, hours, loading, timeFormat }: Props) {
  const root = useRef<HTMLElement>(null)
  useReveal(root, [branches?.length])
  const many = (branches?.length ?? 0) > 1

  return (
    <section ref={root} id="contact" aria-labelledby="contact-title" className="scroll-mt-20 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <SectionHead
          id="contact-title"
          label="Contact"
          title={many ? 'Find a chair near you.' : 'Come in and sit down.'}
          text="All times are Philippine time. Booking ahead saves you the wait."
        />

        <div className="mt-12 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {loading && !branches && <Skeleton className="h-96" />}
          {branches?.length === 0 && <p className="glass rounded-3xl p-6 text-center text-ink-2">Our location will be posted soon.</p>}
          {branches?.map((branch) => (
            <BranchCard key={branch.id} branch={branch} hours={hours.filter((h) => h.branch_id === branch.id)} timeFormat={timeFormat} />
          ))}
          {/* one location: the photo fills the other half */}
          {branches?.length === 1 && (
            <figure data-reveal className="relative min-h-80 overflow-hidden rounded-[2rem] border border-glass-line">
              <img
                src={PHOTOS.chairBrick.src}
                alt={PHOTOS.chairBrick.alt}
                width={PHOTOS.chairBrick.width}
                height={PHOTOS.chairBrick.height}
                loading="lazy"
                decoding="async"
                className="photo-warm absolute inset-0 size-full object-cover"
              />
            </figure>
          )}
        </div>

        <div className="mt-24 grid grid-cols-1 gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p data-reveal className="label flex items-center gap-3">
              <span aria-hidden="true" className="h-px w-8 bg-accent" />
              Questions
            </p>
            <h3 data-reveal className="mt-5 font-display text-[clamp(1.9rem,6vw,2.75rem)] leading-[1.05] tracking-[-0.02em]">
              Good to know before you come.
            </h3>
          </div>
          <div data-reveal className="border-t border-glass-line">
            {FAQ.map((item) => (
              <FaqItem key={item.q} question={item.q} answer={item.a} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

/** One question. The answer opens with a GSAP height animation (instant for reduced motion). */
function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const id = `faq-${question.replace(/\W+/g, '-').toLowerCase()}`

  // runs whenever `open` changes; on the first run it's already closed, so nothing moves
  useGSAP(
    () => {
      const quick = prefersReducedMotion()
      if (open) gsap.fromTo(panel.current, { height: 0 }, { height: 'auto', duration: quick ? 0 : 0.55, ease: 'expo.out' })
      else gsap.to(panel.current, { height: 0, duration: quick ? 0 : 0.35, ease: 'power2.inOut' })
    },
    { dependencies: [open], scope: panel },
  )

  return (
    <div className="border-b border-glass-line">
      <h4>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={id}
          className="flex min-h-16 w-full cursor-pointer items-center justify-between gap-6 py-4 text-left text-[17px] font-medium transition-colors hover:text-accent-ink"
        >
          {question}
          <Plus size={20} className={`shrink-0 text-accent-ink transition-transform duration-300 ${open ? 'rotate-45' : ''}`} />
        </button>
      </h4>
      <div ref={panel} id={id} role="region" aria-label={question} className="h-0 overflow-hidden" inert={!open}>
        <p className="max-w-xl pb-6 text-[16px] leading-relaxed text-ink-2">{answer}</p>
      </div>
    </div>
  )
}

/** One location: name, address, directions, phone, and its week of hours. */
function BranchCard({ branch, hours, timeFormat }: { branch: Branch; hours: OpeningHours[]; timeFormat: '12h' | '24h' }) {
  const today = weekdayOf(manilaToday())
  // a plain link to a map search: no map is loaded on our page
  const directions = branch.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${branch.name}, ${branch.address}`)}`
    : null
  return (
    <div data-reveal className="glass rounded-[2rem] p-2">
      <div className="px-4 pt-4 pb-3 sm:px-5 sm:pt-5">
        <h3 className="flex items-center gap-2.5 font-display text-[24px] leading-tight">
          <MapPin size={20} className="shrink-0 text-accent-ink" />
          {branch.name}
        </h3>
        {branch.address && <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{branch.address}</p>}
        <div className="mt-3 flex flex-wrap gap-x-6">
          {directions && (
            <a
              href={directions}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 text-[14px] font-medium text-ink underline-offset-4 hover:underline"
            >
              Directions
              <ArrowUpRight size={15} />
              <span className="sr-only">(opens Google Maps)</span>
            </a>
          )}
          {branch.phone && (
            <a href={`tel:${branch.phone.replace(/\s/g, '')}`} className="num inline-flex min-h-11 items-center gap-2 text-[14px] text-ink-2 hover:text-ink">
              <Phone size={15} />
              {branch.phone}
            </a>
          )}
        </div>
      </div>
      <ul className="border-t border-glass-line pt-1">
        {hours.length === 0 && <li className="px-4 py-3 text-ink-2">Hours will be posted soon.</li>}
        {hours.length > 0 &&
          [1, 2, 3, 4, 5, 6, 0].map((weekday) => {
            const day = hours.find((h) => h.weekday === weekday)
            const isToday = today === weekday
            return (
              <li key={weekday} className={`flex items-center justify-between rounded-2xl px-4 py-2.5 text-[15px] ${isToday ? 'bg-raised' : ''}`}>
                <span className={isToday ? 'font-medium text-ink' : 'text-ink-2'}>
                  {WEEKDAYS[weekday]}
                  {isToday && <span className="ml-2 text-[13px] text-good">Today</span>}
                </span>
                <span className={`num ${isToday ? 'text-ink' : 'text-ink-2'}`}>
                  {day ? `${formatClock(day.opens_at, timeFormat)} – ${formatClock(day.closes_at, timeFormat)}` : 'Closed'}
                </span>
              </li>
            )
          })}
      </ul>
    </div>
  )
}
