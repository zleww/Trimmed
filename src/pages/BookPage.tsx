import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ArrowRight, Calendar, Check, ChevronLeft, Clock, ImagePlus, Info, MapPin, Scissors, User, Users } from '../components/icons'
import { InspoDraft } from '../components/Inspo'
import { Avatar, Button, ButtonLink, Glass, Notice, Skeleton } from '../components/ui'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { addDays, formatClock, formatDay, formatDayLong, formatTime, manilaDateOf, manilaToday, relativeDay, weekdayOf } from '../lib/dates'
import { duration, errorMessage, peso } from '../lib/format'
import type { Barber, Booking, Branch, OpeningHours, Service } from '../lib/types'
import type { ReadyInspo } from '../lib/inspo'
import { PHOTOS, SERVICE_PHOTOS, type Photo } from '../content/photos'
import { gsap, MOTION, useGSAP } from '../lib/gsap'
import { useLoad } from '../lib/useLoad'

// The booking is built step by step and kept in sessionStorage, so it
// survives a trip to the sign-in page and back (that return link carries ?resume=1).
// A plain /book always starts fresh at the first step.
type Draft = { branchId?: string; serviceId?: string; barberId?: string; date?: string; slot?: string; moveId?: string }
const DRAFT_KEY = 'trimmed-draft'
const ANY = 'any'

function loadDraft(): Draft {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') as Draft
  } catch {
    return {}
  }
}
function saveDraft(draft: Draft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // storage blocked: the booking still works, it just won't survive a reload
  }
}

type StepKey = 'branch' | 'service' | 'barber' | 'time' | 'review'

const STEP_INFO: Record<StepKey, { title: string; short: string }> = {
  branch: { title: 'Choose a location', short: 'Location' },
  service: { title: 'Choose a service', short: 'Service' },
  barber: { title: 'Choose a barber', short: 'Barber' },
  time: { title: 'Pick a time', short: 'Time' },
  review: { title: 'Check and send', short: 'Send' },
}

export function BookPage() {
  const { session, profile } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const timeFormat = profile?.time_format ?? '12h'

  // start from the link (?branch=, ?service=, ?barber=, ?move=), the saved draft when coming back from
  // signing in (?resume=1), or else a clean start
  const [draft, setDraft] = useState<Draft>(() => {
    const fromLink: Draft = {
      branchId: params.get('branch') ?? undefined,
      serviceId: params.get('service') ?? undefined,
      barberId: params.get('barber') ?? undefined,
      moveId: params.get('move') ?? undefined,
    }
    if (fromLink.branchId || fromLink.serviceId || fromLink.barberId || fromLink.moveId) return fromLink
    return params.get('resume') ? loadDraft() : {}
  })
  const [stepKey, setStepKey] = useState<StepKey>(() =>
    draft.slot ? 'review' : draft.serviceId && draft.barberId ? 'time' : draft.serviceId ? 'barber' : draft.branchId ? 'service' : 'branch',
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Booking | null>(null)
  // inspo photos/videos wait here until the booking exists (files can't be saved in the draft)
  const [inspo, setInspo] = useState<ReadyInspo[]>([])
  const [inspoFailed, setInspoFailed] = useState(0)
  const stepBox = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add(MOTION.ok, () => {
        gsap.from(stepBox.current, { opacity: 0, y: 18, duration: 0.6 })
        gsap.from('[data-pick]', { opacity: 0, y: 14, duration: 0.6, stagger: 0.04, delay: 0.05 })
      })
      return () => mm.revert()
    },
    { dependencies: [stepKey], scope: stepBox }, // replays whenever the step changes
  )

  const branches = useLoad(() => api.listBranches(), [])
  const services = useLoad(() => api.listServices(), [])
  const barbers = useLoad(() => api.listBarbers(), [])
  const rules = useLoad(() => api.bookingRules(), [])
  const hours = useLoad(() => api.openingHours(), [])

  // one branch: no need to ask. Moving a booking: it stays at its branch.
  const askBranch = (branches.data?.length ?? 0) > 1 && !draft.moveId
  const flow: StepKey[] = askBranch ? ['branch', 'service', 'barber', 'time', 'review'] : ['service', 'barber', 'time', 'review']
  const shownKey: StepKey = flow.includes(stepKey) ? stepKey : 'service'
  const step = flow.indexOf(shownKey)

  useEffect(() => {
    saveDraft(draft)
  }, [draft])

  // each step starts at the top of the page (braces: newer browsers return a Promise from scrollTo)
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [shownKey])

  // work out the branch when it isn't chosen: the only one there is, or the chosen barber's
  useEffect(() => {
    if (draft.branchId || !branches.data || !barbers.data) return
    const fromBarber = barbers.data.find((b) => b.id === draft.barberId)?.branch_id
    const only = branches.data.length === 1 ? branches.data[0]!.id : undefined
    const found = fromBarber ?? only
    // oxlint-disable-next-line react/set-state-in-effect -- filling in what the links and data already say
    if (found) setDraft((d) => ({ ...d, branchId: found }))
  }, [draft.branchId, draft.barberId, branches.data, barbers.data])

  // a signed-in customer's favourite barber is picked for them (and their branch), unless the link chose otherwise
  useEffect(() => {
    const favourite = barbers.data?.find((b) => b.id === profile?.preferred_barber)
    if (!favourite || draft.barberId || draft.moveId) return
    if (draft.branchId && draft.branchId !== favourite.branch_id) return
    // oxlint-disable-next-line react/set-state-in-effect -- a one-time head start from the profile
    setDraft((d) => ({ ...d, barberId: favourite.id, branchId: favourite.branch_id }))
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.preferred_barber, barbers.data])

  const branch = branches.data?.find((b) => b.id === draft.branchId)
  const service = services.data?.find((s) => s.id === draft.serviceId)
  const barber = barbers.data?.find((b) => b.id === draft.barberId)
  const barberChoice = draft.barberId === ANY ? null : (draft.barberId ?? null)
  const branchBarbers = barbers.data?.filter((b) => b.branch_id === draft.branchId)
  const branchHours = hours.data?.filter((h) => h.branch_id === draft.branchId)

  const ready: Record<StepKey, boolean> = {
    branch: Boolean(branch),
    service: Boolean(service),
    barber: Boolean(draft.barberId),
    time: Boolean(draft.slot),
    review: true,
  }
  const canContinue = ready[shownKey]

  function update(change: Partial<Draft>) {
    setError(null)
    setDraft((d) => {
      const next = { ...d, ...change }
      // another branch has other barbers
      if ('branchId' in change && change.branchId !== d.branchId) next.barberId = undefined
      // a different branch, service or barber changes which times are free
      if ('branchId' in change || 'serviceId' in change || 'barberId' in change || 'date' in change) next.slot = undefined
      return next
    })
  }

  // after picking on one step, go to the next step that still needs an answer
  function goOn(from: StepKey, answered: Partial<Record<StepKey, boolean>> = {}) {
    const after = flow.slice(flow.indexOf(from) + 1)
    // the barber and the time are always shown, even when the favourite barber is filled in for you
    const has = { ...ready, ...answered, barber: false, time: false }
    setStepKey(after.find((k) => !has[k]) ?? 'review')
  }

  async function confirm() {
    if (!service || !draft.slot || !draft.branchId) return
    // not signed in yet: keep the draft and come back here after
    if (!session) {
      navigate(`/signin?next=${encodeURIComponent('/book?resume=1')}`)
      return
    }
    if (!profile) {
      navigate(`/welcome?next=${encodeURIComponent('/book?resume=1')}`)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const booking = draft.moveId
        ? await api.rescheduleBooking(draft.moveId, barberChoice, draft.slot)
        : await api.book(service.id, draft.branchId, barberChoice, draft.slot)
      // the booking is safe now; a failed upload only means "add it again from My bookings"
      let failed = 0
      for (const item of draft.moveId ? [] : inspo) {
        try {
          await api.addInspo(booking.id, item.blob, item.kind)
        } catch {
          failed++
        }
        URL.revokeObjectURL(item.preview)
      }
      setInspo([])
      setInspoFailed(failed)
      setDone(booking)
      setDraft({})
      sessionStorage.removeItem(DRAFT_KEY)
    } catch (reason) {
      const message = errorMessage(reason)
      setError(message)
      // someone took the time a moment ago: go back and show fresh times
      if (/no longer free/i.test(message)) {
        setDraft((d) => ({ ...d, slot: undefined }))
        setStepKey('time')
      }
    } finally {
      setSubmitting(false)
    }
  }

  function next() {
    if (shownKey !== 'review') setStepKey(flow[step + 1]!)
    else void confirm()
  }

  if (done) return <Booked booking={done} timeFormat={timeFormat} moved={Boolean(draft.moveId || params.get('move'))} inspoFailed={inspoFailed} />

  const primaryLabel =
    shownKey !== 'review' ? 'Continue' : !session ? 'Sign in to continue' : draft.moveId ? 'Request new time' : 'Send request'

  return (
    <div className="relative mx-auto max-w-6xl px-4 pt-6 pb-16 sm:px-6 lg:pt-10 lg:pb-20">
      {/* a soft amber light behind the page, like the home page */}
      <div aria-hidden="true" className="pointer-events-none absolute -top-24 right-0 -z-10 size-[34rem] rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--accent)_10%,transparent),transparent)] blur-2xl" />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-12">
        <div className="min-w-0">
          <StepHeader
            steps={flow.map((k) => STEP_INFO[k])}
            step={step}
            onBack={step > 0 ? () => setStepKey(flow[step - 1]!) : undefined}
            onJump={(i) => setStepKey(flow[i]!)}
            canJumpTo={(i) => i < step}
            moving={Boolean(draft.moveId)}
          />

          {error && (
            <div className="mt-6">
              <Notice tone="bad">{error}</Notice>
            </div>
          )}

          <div ref={stepBox} className="mt-8" key={shownKey}>
            {shownKey === 'branch' && (
              <BranchStep
                branches={branches.data}
                barbers={barbers.data}
                hours={hours.data}
                selected={draft.branchId}
                onPick={(id) => {
                  update({ branchId: id })
                  goOn('branch', { branch: true, barber: false })
                }}
              />
            )}
            {shownKey === 'service' && (
              <ServiceStep
                photos={SERVICE_PHOTOS}
                services={services.data}
                loading={services.loading}
                selected={draft.serviceId}
                locked={Boolean(draft.moveId)}
                onPick={(id) => {
                  update({ serviceId: id })
                  goOn('service', { service: true })
                }}
              />
            )}
            {shownKey === 'barber' && (
              <BarberStep
                barbers={branchBarbers}
                selected={draft.barberId}
                onPick={(id) => {
                  update({ barberId: id })
                  setStepKey('time')
                }}
              />
            )}
            {shownKey === 'time' && service && draft.branchId && (
              <TimeStep
                serviceId={service.id}
                branchId={draft.branchId}
                barberId={barberChoice}
                daysAhead={rules.data?.booking_days_ahead ?? 14}
                openDays={branchHours?.map((h) => h.weekday)}
                date={draft.date ?? manilaToday()}
                datePicked={draft.date !== undefined}
                slot={draft.slot}
                timeFormat={timeFormat}
                onDate={(date) => update({ date })}
                onSlot={(slot) => setDraft((d) => ({ ...d, slot, date: manilaDateOf(slot) }))}
              />
            )}
            {shownKey === 'review' && service && draft.slot && (
              <ReviewStep
                branch={branch}
                showBranch={askBranch}
                service={service}
                barber={barber}
                slot={draft.slot}
                timeFormat={timeFormat}
                cutoffMinutes={rules.data?.cancel_cutoff_minutes}
                signedIn={Boolean(session)}
                moving={Boolean(draft.moveId)}
                inspo={inspo}
                onInspo={setInspo}
              />
            )}
          </div>
        </div>

        {/* desktop: summary on the side, holding the one primary button */}
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <Summary
              photo={service ? SERVICE_PHOTOS[Math.max(0, services.data?.indexOf(service) ?? 0) % SERVICE_PHOTOS.length] : PHOTOS.chairSilver}
              branch={askBranch ? branch : undefined}
              service={service}
              barber={barber}
              anyBarber={draft.barberId === ANY}
              slot={draft.slot}
              timeFormat={timeFormat}
            />
            <Button className="mt-4 h-12 w-full text-[16px]" disabled={!canContinue} loading={submitting} onClick={next}>
              {primaryLabel}
              {!submitting && <ArrowRight size={18} />}
            </Button>
          </div>
        </aside>
      </div>

      {/* phone: a bar at the bottom with the short summary and the same button */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-glass-line bg-bg/85 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div className="min-w-0 flex-1 text-[14px]">
            {service ? (
              <>
                <p className="truncate font-medium">{service.name}</p>
                <p className="num truncate text-ink-2">
                  {peso(service.price_centavos)}
                  {draft.slot && ` · ${relativeDay(manilaDateOf(draft.slot))}, ${formatTime(draft.slot, timeFormat)}`}
                </p>
              </>
            ) : branch && askBranch ? (
              <>
                <p className="truncate font-medium">{branch.name}</p>
                <p className="truncate text-ink-2">Now pick a service</p>
              </>
            ) : (
              <p className="text-ink-2">{askBranch ? 'Pick a location to start' : 'Pick a service to start'}</p>
            )}
          </div>
          <Button className="h-12 shrink-0 px-6" disabled={!canContinue} loading={submitting} onClick={next}>
            {primaryLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}

// branches have no photos in the database yet: they take these in turn (same order as the home page)
const BRANCH_PHOTOS: Photo[] = [PHOTOS.chairBrick, PHOTOS.salonDim, PHOTOS.clientChair]

/** The locations: photo, name, address, how many barbers, and today's hours. */
function BranchStep({
  branches,
  barbers,
  hours,
  selected,
  onPick,
}: {
  branches?: Branch[]
  barbers?: Barber[]
  hours?: OpeningHours[]
  selected?: string
  onPick: (id: string) => void
}) {
  if (!branches) {
    return (
      <div className="grid grid-cols-1 gap-3">
        {Array.from({ length: 2 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    )
  }
  const today = weekdayOf(manilaToday())
  return (
    <div role="radiogroup" aria-label="Location" className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {branches.map((b) => {
        const count = barbers?.filter((x) => x.branch_id === b.id).length ?? 0
        const open = hours?.find((h) => h.branch_id === b.id && h.weekday === today)
        return (
          <Choice key={b.id} selected={b.id === selected} onClick={() => onPick(b.id)} className="overflow-hidden p-2">
            <span className="relative block h-32 overflow-hidden rounded-[1.1rem]">
              <img src={BRANCH_PHOTOS[branches.indexOf(b) % BRANCH_PHOTOS.length]!.src} alt="" loading="lazy" decoding="async" className="photo-warm size-full object-cover" />
              <span className="absolute inset-0 bg-gradient-to-t from-bg/70 to-transparent" />
              <span className="num absolute bottom-2 left-3 font-display text-[34px] leading-none text-ink/90">{String(branches.indexOf(b) + 1).padStart(2, '0')}</span>
            </span>
            <span className="flex min-w-0 items-start gap-3 p-3 pr-10">
              <MapPin size={18} className="mt-1 shrink-0 text-accent-ink" />
              <span className="min-w-0">
              <span className="block font-display text-[21px] leading-tight">{b.name}</span>
              {b.address && <span className="mt-0.5 block text-[14px] leading-snug text-ink-2">{b.address}</span>}
              <span className="num mt-2 block text-[13px] text-ink-3">
                {count} barber{count === 1 ? '' : 's'} · {open ? `Today ${formatClock(open.opens_at, '12h')} – ${formatClock(open.closes_at, '12h')}` : 'Closed today'}
              </span>
              </span>
            </span>
          </Choice>
        )
      })}
    </div>
  )
}

function StepHeader({
  steps,
  step,
  onBack,
  onJump,
  canJumpTo,
  moving,
}: {
  steps: { title: string; short: string }[]
  step: number
  onBack?: () => void
  onJump: (step: number) => void
  canJumpTo: (step: number) => boolean
  moving: boolean
}) {
  return (
    <div>
      <div className="flex min-h-11 items-center gap-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="-ml-2 inline-flex min-h-11 cursor-pointer items-center gap-1 rounded-full pr-3 pl-2 text-[15px] text-ink-2 hover:text-ink"
          >
            <ChevronLeft size={18} />
            Back
          </button>
        ) : (
          <span className="label flex items-center gap-3">
            <span aria-hidden="true" className="h-px w-8 bg-accent" />
            {moving ? 'Move your booking' : 'New booking'}
          </span>
        )}
      </div>

      <ol className="mt-5 flex gap-2" aria-label="Booking steps">
        {steps.map((s, i) => {
          const state = i < step ? 'done' : i === step ? 'current' : 'todo'
          return (
            <li key={s.short} className="flex-1">
              <button
                type="button"
                disabled={!canJumpTo(i)}
                onClick={() => onJump(i)}
                aria-current={state === 'current' ? 'step' : undefined}
                aria-label={`${s.short}${state === 'done' ? ', done' : state === 'current' ? ', current step' : ''}`}
                className="group w-full cursor-pointer text-left disabled:cursor-default"
              >
                <span className="relative block h-px bg-line">
                  <span
                    className={
                      'absolute inset-y-0 left-0 transition-all duration-500 ' +
                      (state === 'todo' ? 'w-0' : state === 'current' ? 'w-full bg-accent' : 'w-full bg-ink-2 group-hover:bg-ink')
                    }
                  />
                </span>
                <span className={`mt-2.5 flex items-baseline gap-1.5 text-[12px] ${state === 'todo' ? 'text-ink-3' : state === 'current' ? 'text-accent-ink' : 'text-ink-2'}`}>
                  <span className="num">{String(i + 1).padStart(2, '0')}</span>
                  <span className="hidden sm:inline">{s.short}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ol>

      <h1 className="mt-8 text-[clamp(2.1rem,8vw,3.25rem)] leading-[1.02] font-medium tracking-[-0.03em]">{steps[step]!.title}</h1>
      <p className="mt-2 text-[14px] text-ink-3">
        Step {step + 1} of {steps.length}
      </p>
    </div>
  )
}

/** A card you tap to pick. Acts as a radio button for screen readers. */
function Choice({
  selected,
  onClick,
  disabled,
  children,
  className = '',
  tickAt = 'top',
}: {
  selected: boolean
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
  className?: string
  tickAt?: 'top' | 'bottom' // bottom on service cards, so the price can sit in the top corner
}) {
  return (
    <button
      data-pick
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onClick}
      className={
        'glass relative w-full cursor-pointer rounded-[1.5rem] text-left transition duration-300 disabled:cursor-default disabled:opacity-50 ' +
        (selected ? 'border-ink ring-1 ring-ink' : 'hover:-translate-y-0.5 hover:border-ink-3') +
        ` ${className}`
      }
    >
      {children}
      {selected && (
        <span className={`absolute right-4 flex size-6 ${tickAt === 'top' ? 'top-4' : 'bottom-4'} items-center justify-center rounded-full bg-ink text-bg`}>
          <Check size={14} strokeWidth={2.5} />
        </span>
      )}
    </button>
  )
}

function ServiceStep({
  photos,
  services,
  loading,
  selected,
  locked,
  onPick,
}: {
  photos: Photo[]
  services?: Service[]
  loading: boolean
  selected?: string
  locked: boolean
  onPick: (id: string) => void
}) {
  if (loading && !services) {
    return (
      <div className="grid grid-cols-1 gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    )
  }
  return (
    <div role="radiogroup" aria-label="Service" className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {locked && (
        <div className="md:col-span-2">
          <Notice>Moving a booking keeps the same service. To change it, cancel and book again.</Notice>
        </div>
      )}
      {services?.map((s, i) => {
        const photo = photos[i % photos.length]!
        return (
          <Choice
            key={s.id}
            selected={s.id === selected}
            disabled={locked && s.id !== selected}
            onClick={() => onPick(s.id)}
            className="flex gap-4 p-2.5 pr-4"
            tickAt="bottom"
          >
            <img src={photo.src} alt="" loading="lazy" decoding="async" className="photo-warm size-24 shrink-0 rounded-[1.1rem] object-cover sm:size-28" />
            <span className="flex min-w-0 flex-1 flex-col py-1.5">
              <span className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 font-display text-[20px] leading-tight">{s.name}</span>
                <span className="num shrink-0 font-display text-[19px] text-accent-ink">{peso(s.price_centavos)}</span>
              </span>
              {s.description && <span className="mt-1 line-clamp-2 block pr-6 text-[14px] leading-snug text-ink-2">{s.description}</span>}
              <span className="mt-auto flex items-center gap-2 pt-2 text-[13px] text-ink-3">
                <Clock size={14} />
                {duration(s.duration_minutes)}
              </span>
            </span>
          </Choice>
        )
      })}
    </div>
  )
}

function BarberStep({ barbers, selected, onPick }: { barbers?: Barber[]; selected?: string; onPick: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Barber" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <Choice selected={selected === ANY} onClick={() => onPick(ANY)} className="col-span-2 flex items-center gap-4 p-5 sm:col-span-3">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-raised text-ink">
          <Users size={24} />
        </span>
        <span>
          <span className="block text-[16px] font-medium">Any barber</span>
          <span className="mt-0.5 block text-[14px] text-ink-2">The most open times. We'll pick who's free.</span>
        </span>
      </Choice>
      {!barbers
        ? Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-44" />)
        : barbers.map((b) => (
            <Choice key={b.id} selected={b.id === selected} onClick={() => onPick(b.id)} className="flex flex-col items-center p-5 text-center">
              {b.photo_url ? (
                <img src={b.photo_url} alt="" className="size-20 rounded-full object-cover ring-1 ring-accent/50 ring-offset-4 ring-offset-[var(--card)]" />
              ) : (
                <span className="rounded-full ring-1 ring-accent/50 ring-offset-4 ring-offset-[var(--card)]">
                  <Avatar name={b.display_name} size={80} />
                </span>
              )}
              <span className="mt-4 block w-full truncate font-display text-[18px]">{b.display_name}</span>
              {b.bio && <span className="mt-0.5 block w-full truncate text-[13px] text-ink-2">{b.bio}</span>}
            </Choice>
          ))}
    </div>
  )
}

function TimeStep({
  serviceId,
  branchId,
  barberId,
  daysAhead,
  openDays,
  date,
  datePicked,
  slot,
  timeFormat,
  onDate,
  onSlot,
}: {
  serviceId: string
  branchId: string
  barberId: string | null
  daysAhead: number
  openDays?: number[]
  date: string
  datePicked: boolean
  slot?: string
  timeFormat: '12h' | '24h'
  onDate: (date: string) => void
  onSlot: (slot: string) => void
}) {
  const days = useMemo(() => Array.from({ length: daysAhead + 1 }, (_, i) => addDays(manilaToday(), i)), [daysAhead])
  const slots = useLoad(() => api.freeSlots(serviceId, branchId, barberId, date), [serviceId, branchId, barberId, date])

  // in the evening today is usually full or closed: if the customer hasn't picked a day, start on tomorrow
  const todayIsEmpty = !datePicked && date === manilaToday() && !slots.loading && slots.data?.length === 0
  useEffect(() => {
    if (todayIsEmpty) onDate(addDays(manilaToday(), 1))
  }, [todayIsEmpty, onDate])

  // morning / afternoon / evening, by the Manila hour
  const groups = useMemo(() => {
    const hourOf = (iso: string) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', hour12: false }).format(new Date(iso)))
    const out = [
      { label: 'Morning', items: [] as string[] },
      { label: 'Afternoon', items: [] as string[] },
      { label: 'Evening', items: [] as string[] },
    ]
    for (const s of slots.data ?? []) {
      const h = hourOf(s)
      out[h < 12 ? 0 : h < 17 ? 1 : 2]!.items.push(s)
    }
    return out.filter((g) => g.items.length > 0)
  }, [slots.data])

  return (
    <div>
      <h2 className="sr-only">Day</h2>
      {/* days scroll sideways on a phone */}
      <div role="radiogroup" aria-label="Day" className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:px-0">
        {days.map((d) => {
          const closed = openDays ? !openDays.includes(weekdayOf(d)) : false
          const selected = d === date
          const [weekday, rest] = formatDay(d).split(', ')
          return (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${formatDayLong(d)}${closed ? ', closed' : ''}`}
              disabled={closed}
              onClick={() => onDate(d)}
              className={
                'flex min-h-16 w-[68px] shrink-0 snap-start flex-col items-center justify-center rounded-2xl border text-center transition disabled:opacity-40 ' +
                (selected ? 'border-transparent bg-ink text-bg' : 'glass hover:border-ink-3')
              }
            >
              <span className={`text-[12px] ${selected ? '' : 'text-ink-2'}`}>{d === manilaToday() ? 'Today' : weekday}</span>
              <span className="num mt-0.5 text-[15px] font-semibold">{rest?.replace(/^\w+ /, '')}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-8">
        <h2 className="text-[15px] font-medium text-ink-2">{formatDayLong(date)}</h2>
        {slots.loading && !slots.data ? (
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
            {Array.from({ length: 10 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : slots.error ? (
          <div className="mt-4">
            <Notice tone="bad">{slots.error}</Notice>
          </div>
        ) : groups.length === 0 ? (
          <Glass className="mt-4 p-6 text-center">
            <p className="text-[16px] font-medium">No free times this day</p>
            <p className="mt-1 text-[14px] text-ink-2">Try another day{barberId ? ', or pick "Any barber"' : ''}.</p>
          </Glass>
        ) : (
          <div className={`space-y-6 ${slots.loading ? 'opacity-60' : ''}`} role="radiogroup" aria-label="Time">
            {groups.map((g) => (
              <div key={g.label}>
                <p className="mt-4 mb-2 text-[13px] text-ink-3">{g.label}</p>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                  {g.items.map((s) => {
                    const selected = s === slot
                    return (
                      <button
                        key={s}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => onSlot(s)}
                        className={
                          'num min-h-12 rounded-2xl border text-[15px] font-medium transition ' +
                          (selected ? 'border-transparent bg-ink text-bg' : 'glass hover:border-ink-3')
                        }
                      >
                        {formatTime(s, timeFormat)}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function hoursText(minutes: number): string {
  if (minutes % 1440 === 0) return `${minutes / 1440} day${minutes === 1440 ? '' : 's'}`
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`
  return `${minutes} minutes`
}

function ReviewStep({
  branch,
  showBranch,
  service,
  barber,
  slot,
  timeFormat,
  cutoffMinutes,
  signedIn,
  moving,
  inspo,
  onInspo,
}: {
  branch?: Branch
  showBranch: boolean
  service: Service
  barber?: Barber
  slot: string
  timeFormat: '12h' | '24h'
  cutoffMinutes?: number
  signedIn: boolean
  moving: boolean
  inspo: ReadyInspo[]
  onInspo: (items: ReadyInspo[]) => void
}) {
  return (
    <div className="space-y-4">
      <Glass className="divide-y divide-[var(--glass-line)]">
        {showBranch && branch && <Row Icon={MapPin} label="Location" value={branch.name} detail={branch.address ?? undefined} />}
        <Row Icon={Scissors} label="Service" value={service.name} detail={`${duration(service.duration_minutes)} · ${peso(service.price_centavos)}`} />
        <Row Icon={User} label="Barber" value={barber?.display_name ?? 'Any barber'} detail={barber ? undefined : "We'll pick who's free at that time"} />
        <Row
          Icon={Calendar}
          label="When"
          value={`${relativeDay(manilaDateOf(slot))}, ${formatTime(slot, timeFormat)}`}
          detail={formatDayLong(manilaDateOf(slot))}
        />
      </Glass>

      {/* a photo or short video of the cut they want, so the barber can study it first */}
      {signedIn && !moving && (
        <Glass className="p-5">
          <h2 className="flex items-center gap-2 text-[15px] font-medium">
            <ImagePlus size={18} className="text-accent" />
            Inspo for your barber <span className="font-normal text-ink-3">(optional)</span>
          </h2>
          <div className="mt-3">
            <InspoDraft items={inspo} onChange={onInspo} />
          </div>
        </Glass>
      )}

      <Glass className="p-5">
        <h2 className="flex items-center gap-2 text-[15px] font-medium">
          <Info size={18} className="text-ink-2" />
          Before you book
        </h2>
        <ul className="mt-3 space-y-2 text-[14px] leading-relaxed text-ink-2">
          <li>
            This is a request. The shop confirms it, and your time is held for you while you wait. You'll see the answer in My
            bookings.
          </li>
          <li>You pay at the shop after your service.</li>
          {moving && <li>Your current booking stays as it is until the shop confirms the new time. If they can't, nothing changes.</li>}
          <li>Before the shop confirms, you can cancel or move it any time. Once confirmed, cancelling or moving it goes to the shop to approve.</li>
          {cutoffMinutes !== undefined && cutoffMinutes > 0 && (
            <li>Changes online close {hoursText(cutoffMinutes)} before your time. After that, please call the shop.</li>
          )}
          <li>Once it's confirmed, show your booking code at the desk when you arrive.</li>
        </ul>
      </Glass>

      {!signedIn && (
        <Notice>
          You'll sign in or make an account next. It takes a minute, and your choices stay as they are. After that you can add inspo photos for your barber.
        </Notice>
      )}
    </div>
  )
}

function Row({ Icon, label, value, detail }: { Icon: typeof Clock; label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-start gap-4 p-5">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-raised text-ink-2">
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <p className="text-[13px] text-ink-3">{label}</p>
        <p className="mt-0.5 text-[16px] font-medium">{value}</p>
        {detail && <p className="num mt-0.5 text-[14px] text-ink-2">{detail}</p>}
      </div>
    </div>
  )
}

function Summary({
  photo,
  branch,
  service,
  barber,
  anyBarber,
  slot,
  timeFormat,
}: {
  photo: Photo
  branch?: Branch
  service?: Service
  barber?: Barber
  anyBarber: boolean
  slot?: string
  timeFormat: '12h' | '24h'
}) {
  const lines = [
    ...(branch ? [{ label: 'Location', value: branch.name }] : []),
    { label: 'Service', value: service?.name },
    { label: 'Barber', value: barber?.display_name ?? (anyBarber ? 'Any barber' : undefined) },
    { label: 'When', value: slot ? `${relativeDay(manilaDateOf(slot))}, ${formatTime(slot, timeFormat)}` : undefined },
  ]
  return (
    <div className="glass overflow-hidden rounded-[2rem] p-2">
      <div className="relative h-36 overflow-hidden rounded-[1.6rem]">
        <img key={photo.src} src={photo.src} alt="" decoding="async" className="photo-warm rise size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-bg/85 via-bg/20 to-transparent" />
        <h2 className="absolute bottom-3 left-4 font-display text-[24px]">Your booking</h2>
      </div>
      <div className="p-4 pt-5">
      <dl className="space-y-3">
        {lines.map((line) => (
          <div key={line.label} className="flex items-baseline justify-between gap-4 text-[15px]">
            <dt className="text-ink-3">{line.label}</dt>
            <dd className={`num truncate text-right ${line.value ? 'font-medium' : 'text-ink-3'}`}>{line.value ?? '—'}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-5 flex items-baseline justify-between border-t border-glass-line pt-5">
        <span className="text-[15px] text-ink-2">Total</span>
        <span className="num font-display text-[30px] tracking-tight">{service ? peso(service.price_centavos) : '—'}</span>
      </div>
      <p className="mt-1 text-right text-[12px] text-ink-3">Pay at the shop, after your cut</p>
      </div>
    </div>
  )
}

function Booked({ booking, timeFormat, moved, inspoFailed }: { booking: Booking; timeFormat: '12h' | '24h'; moved: boolean; inspoFailed: number }) {
  const date = manilaDateOf(booking.starts_at)
  return (
    <div className="mx-auto max-w-lg px-4 py-14 sm:py-20">
      <div className="rise text-center">
        <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-warn-bg text-warn">
          <Clock size={32} />
        </span>
        <h1 className="mt-6 text-[clamp(2.2rem,9vw,3rem)] leading-tight font-medium tracking-[-0.03em]">{moved ? 'New time requested' : 'Request sent'}</h1>
        <p className="mt-2 text-[16px] leading-relaxed text-ink-2">
          Your time on {relativeDay(date) === 'Today' ? 'today' : formatDayLong(date)} is held for you. The shop will confirm it, and
          you'll see the answer in My bookings.
          {booking.replaces_starts_at && ' Your current booking stays as it is until then.'}
        </p>
      </div>

      {inspoFailed > 0 && (
        <div className="mt-6">
          <Notice tone="warn">
            Your booking is saved, but {inspoFailed === 1 ? '1 inspo file' : `${inspoFailed} inspo files`} didn't upload. You can add
            {inspoFailed === 1 ? ' it' : ' them'} again from My bookings.
          </Notice>
        </div>
      )}

      <Glass className="rise mt-8 p-6 [animation-delay:100ms]">
        <p className="label text-center">Booking code</p>
        <p className="num mt-2 text-center font-display text-[40px] tracking-[0.14em]">{booking.code}</p>
        <div className="hairline mt-4" />
        <dl className="mt-6 space-y-3 border-t border-glass-line pt-6 text-[15px]">
          {[
            ...(booking.branch ? [['Location', booking.branch]] : []),
            ['Service', booking.service],
            ['Barber', booking.barber ?? 'Any barber'],
            ['When', `${formatTime(booking.starts_at, timeFormat)}, ${formatDay(date)}`],
            ['Pay at the shop', peso(booking.price_centavos)],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4">
              <dt className="text-ink-2">{label}</dt>
              <dd className="num text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </Glass>

      <div className="mt-6 flex flex-col gap-3">
        <ButtonLink to="/account" className="h-12">
          See my requests
        </ButtonLink>
        <Link to="/" className="py-2 text-center text-[15px] text-ink-2 hover:text-ink">
          Back to home
        </Link>
      </div>
    </div>
  )
}
