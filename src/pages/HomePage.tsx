import { Link } from 'react-router'
import { BarberCard } from '../components/Barbers'
import { ArrowRight, Calendar, CheckCircle, ChevronRight, Clock, Scissors, Users } from '../components/icons'
import { ButtonLink, Eyebrow, Glass, Skeleton } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { addDays, formatClock, formatTime, manilaToday, relativeDay, WEEKDAYS, weekdayOf } from '../lib/dates'
import { duration, peso } from '../lib/format'
import { useLoad } from '../lib/useLoad'

export function HomePage() {
  const { profile } = useAuth()
  const timeFormat = profile?.time_format ?? '12h'
  const services = useLoad(() => api.listServices(), [])
  const barbers = useLoad(() => api.listBarbers(), [])
  const hours = useLoad(() => api.openingHours(), [])
  const ratings = useLoad(() => api.barberRatings(), [])

  return (
    <>
      <Hero
        timeFormat={timeFormat}
        firstServiceId={services.data?.[0]?.id}
        notSetUp={services.data?.length === 0}
        menuLoading={services.data === undefined && !services.error}
      />

      {/* services */}
      <section id="services" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24">
        <SectionHead eyebrow="Services" title="What we do" text="Prices are fixed and shown up front. You pay at the shop after your cut." />
        <div className="mt-10 grid grid-cols-1 gap-3 md:grid-cols-2">
          {services.loading && !services.data
            ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-24" />)
            : services.data?.map((service) => (
                <Link
                  key={service.id}
                  to={`/book?service=${service.id}`}
                  className="glass group flex min-w-0 items-center gap-4 rounded-3xl p-5 transition hover:border-ink-3"
                >
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-raised text-ink-2">
                    <Scissors size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[16px] font-medium">{service.name}</span>
                      <span className="num shrink-0 text-[16px] font-semibold">{peso(service.price_centavos)}</span>
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-[14px] text-ink-2">
                      <Clock size={14} className="shrink-0" />
                      <span className="shrink-0">{duration(service.duration_minutes)}</span>
                      {service.description && <span className="truncate">· {service.description}</span>}
                    </span>
                  </span>
                  <ChevronRight size={18} className="shrink-0 text-ink-3 transition group-hover:translate-x-0.5 group-hover:text-ink" />
                </Link>
              ))}
          {services.error && <p className="text-bad">{services.error}</p>}
          {services.data?.length === 0 && <EmptyNote text="Services and prices will be posted soon." />}
        </div>
      </section>

      {/* barbers */}
      <section id="barbers" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24">
        <SectionHead eyebrow="Barbers" title="Pick who cuts your hair" text="See their reviews, star your favourite, or take the first one free." />
        <div className="mt-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {barbers.loading && !barbers.data
            ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="aspect-[4/5]" />)
            : barbers.data?.map((barber) => <BarberCard key={barber.id} barber={barber} rating={ratings.data?.[barber.id]} />)}
          {barbers.data?.length === 0 && <EmptyNote text="Our barbers will be listed here soon." />}
        </div>
      </section>

      {/* how it works */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <SectionHead eyebrow="How it works" title="Booked in under a minute" />
        <ol className="mt-10 grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            { Icon: Scissors, title: 'Pick a service', text: 'See the price and how long it takes before you choose.' },
            { Icon: Users, title: 'Choose a barber', text: 'Pick someone you know, or any barber for the earliest time.' },
            { Icon: Calendar, title: 'Take a free time', text: 'Only real open times are shown. Your seat is held for you.' },
          ].map(({ Icon, title, text }, index) => (
            <li key={title}>
              <Glass className="h-full p-6">
                <div className="flex items-center justify-between">
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-raised text-ink">
                    <Icon size={20} />
                  </span>
                  <span className="num text-[13px] text-ink-3">0{index + 1}</span>
                </div>
                <h3 className="mt-6 text-[17px] font-medium">{title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">{text}</p>
              </Glass>
            </li>
          ))}
        </ol>
      </section>

      {/* hours */}
      <section id="visit" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 sm:py-24">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-start">
          <SectionHead
            eyebrow="Visit"
            title="Opening hours"
            text="All times are Philippine time. Booking ahead saves you the wait."
          />
          {/* TODO: shop address and map, once the owner approves showing them */}
          <Glass className="p-2">
            <ul>
              {(hours.data ?? []).length === 0 && !hours.loading && (
                <li className="px-4 py-3 text-ink-2">Hours will be posted soon.</li>
              )}
              {[1, 2, 3, 4, 5, 6, 0].map((weekday) => {
                const day = hours.data?.find((h) => h.weekday === weekday)
                const isToday = weekdayOf(manilaToday()) === weekday
                // nothing set yet: the note above says so, don't list 7 closed days
                if (!hours.data || hours.data.length === 0) return null
                return (
                  <li
                    key={weekday}
                    className={`flex items-center justify-between rounded-2xl px-4 py-3 text-[15px] ${isToday ? 'bg-raised' : ''}`}
                  >
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
          </Glass>
        </div>
      </section>

      {/* closing call to book */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <Glass className="flex flex-col items-start gap-6 p-8 sm:flex-row sm:items-center sm:justify-between sm:p-10">
          <div>
            <h2 className="text-[26px] font-semibold tracking-tight sm:text-[30px]">Ready for a fresh cut?</h2>
            <p className="mt-2 text-[16px] text-ink-2">Pick a time that suits you. It takes a minute.</p>
          </div>
          <ButtonLink to="/book" className="w-full sm:w-auto">
            Book a seat
            <ArrowRight size={18} />
          </ButtonLink>
        </Glass>
      </section>
    </>
  )
}

// shown when the shop hasn't added anything yet, instead of a blank gap
function EmptyNote({ text }: { text: string }) {
  return (
    <Glass className="col-span-full p-6 text-center">
      <p className="text-[15px] text-ink-2">{text}</p>
    </Glass>
  )
}

function SectionHead({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div className="max-w-xl">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-3 text-[30px] leading-tight font-semibold tracking-tight sm:text-[38px]">{title}</h2>
      {text && <p className="mt-3 text-[16px] leading-relaxed text-ink-2">{text}</p>}
    </div>
  )
}

/** Top of the page: the promise, one primary button, and the real next free time. */
function Hero({
  timeFormat,
  firstServiceId,
  notSetUp,
  menuLoading,
}: {
  timeFormat: '12h' | '24h'
  firstServiceId?: string
  notSetUp: boolean
  menuLoading: boolean
}) {
  // the earliest free time today or tomorrow, for any barber
  const next = useLoad(async () => {
    if (!firstServiceId) return null
    for (const date of [manilaToday(), addDays(manilaToday(), 1)]) {
      const slots = await api.freeSlots(firstServiceId, null, date)
      if (slots.length > 0) return { date, time: slots[0]!, count: slots.length }
    }
    return null
  }, [firstServiceId])

  return (
    <section className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 pt-14 pb-10 sm:px-6 sm:pt-20 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-16 lg:pt-28 lg:pb-20">
      <div className="rise">
        <Eyebrow>Online booking</Eyebrow>
        <h1 className="mt-4 text-[44px] leading-[1.02] font-semibold tracking-[-0.03em] sm:text-[60px] lg:text-[72px]">
          A sharp cut,
          <br />
          <span className="text-ink-2">on your time.</span>
        </h1>
        <p className="mt-6 max-w-md text-[17px] leading-relaxed text-ink-2">
          Pick a service, a barber and a free time. No calls, no waiting in line.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <ButtonLink to="/book" className="h-12 px-7 text-[16px]">
            Book a seat
            <ArrowRight size={18} />
          </ButtonLink>
          <ButtonLink to="/#services" variant="ghost" className="h-12">
            See services and prices
          </ButtonLink>
        </div>
      </div>

      <Glass className="rise relative overflow-hidden p-6 sm:p-8 [animation-delay:120ms]">
        {/* a soft green light in the corner, like the reference cards */}
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full bg-[var(--glow)] blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-2 text-[14px] text-ink-2">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-good opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex size-2.5 rounded-full bg-good" />
            </span>
            Next free seat
          </div>
          {/* still waiting on the menu or the times: don't say "no seats" yet */}
          {menuLoading || (next.loading && !next.data) ? (
            <Skeleton className="mt-4 h-14 w-48" />
          ) : next.data ? (
            <>
              <p className="num mt-3 text-[44px] leading-none font-semibold tracking-tight sm:text-[52px]">
                {formatTime(next.data.time, timeFormat)}
              </p>
              <p className="mt-2 text-[16px] text-ink-2">{relativeDay(next.data.date)}, any barber</p>
            </>
          ) : (
            <p className="mt-3 text-[18px] text-ink-2">
              {notSetUp ? 'Online booking opens soon.' : 'No free seats today or tomorrow. Try a later day.'}
            </p>
          )}

          <ul className="mt-8 space-y-3 border-t border-glass-line pt-6 text-[15px] text-ink-2">
            {['Only real open times are shown', 'Cancel or move it from your account', 'Pay at the shop after your cut'].map((line) => (
              <li key={line} className="flex items-center gap-3">
                <CheckCircle size={18} className="shrink-0 text-good" />
                {line}
              </li>
            ))}
          </ul>
        </div>
      </Glass>
    </section>
  )
}
