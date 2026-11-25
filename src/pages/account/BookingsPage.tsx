import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Ban, Move } from '../../components/icons'
import { BookingInspo } from '../../components/Inspo'
import { Button, ButtonLink, Dialog, Glass, Notice, Skeleton, StatusBadge } from '../../components/ui'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { formatTime } from '../../lib/dates'
import { errorMessage, peso } from '../../lib/format'
import type { Booking } from '../../lib/types'
import { useLoad } from '../../lib/useLoad'

const ACTIVE = ['requested', 'booked', 'checked_in', 'in_chair']

export function BookingsPage() {
  const { profile } = useAuth()
  const timeFormat = profile?.time_format ?? '12h'
  const bookings = useLoad(() => api.myBookings(), [])
  const rules = useLoad(() => api.bookingRules(), [])
  const [cancelling, setCancelling] = useState<Booking | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null)

  // the time when the page opened, so the list doesn't shift while you read it
  const [now] = useState(() => Date.now())
  // waiting, confirmed and in progress, plus any declined ones still ahead, so the customer sees the answer
  const upcoming = (bookings.data ?? [])
    .filter((b) => (ACTIVE.includes(b.status) || b.status === 'declined') && new Date(b.ends_at).getTime() > now)
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
  const past = (bookings.data ?? []).filter((b) => !upcoming.includes(b))

  // matches the database rule, so we don't offer a button that would be refused
  const cutoff = (rules.data?.cancel_cutoff_minutes ?? 120) * 60000
  // a waiting request can change any time before it starts; a confirmed one only before the cut-off
  const changeable = (b: Booking) =>
    (b.status === 'requested' && new Date(b.starts_at).getTime() > now) ||
    (b.status === 'booked' && new Date(b.starts_at).getTime() - now >= cutoff)

  // short day and time, for the lines about waiting changes
  const when = (iso: string) =>
    `${new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso))}, ${formatTime(iso, timeFormat)}`

  async function keep(b: Booking) {
    setBusy(true)
    setMessage(null)
    try {
      await api.keepBooking(b.id)
      setMessage({ tone: 'good', text: 'Cancel request taken back. Your booking stays as it is.' })
      bookings.reload()
    } catch (reason) {
      setMessage({ tone: 'bad', text: errorMessage(reason) })
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    if (!cancelling) return
    setBusy(true)
    try {
      await api.cancelBooking(cancelling.id)
      setMessage({
        tone: 'good',
        text:
          cancelling.status === 'requested'
            ? 'Request cancelled.'
            : 'Cancel request sent. Your booking stays until the shop answers, and you can take it back until then.',
      })
      bookings.reload()
    } catch (reason) {
      setMessage({ tone: 'bad', text: errorMessage(reason) })
    } finally {
      setBusy(false)
      setCancelling(null)
    }
  }

  if (bookings.loading && !bookings.data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-36" />
        <Skeleton className="h-24" />
      </div>
    )
  }
  if (bookings.error) return <Notice tone="bad">{bookings.error}</Notice>

  return (
    <div className="space-y-10">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}

      <section>
        <h2 className="text-[18px] font-semibold tracking-tight">Upcoming</h2>
        {upcoming.length === 0 ? (
          <Glass className="mt-4 flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[16px] font-medium">No upcoming bookings</p>
              <p className="mt-1 text-[14px] text-ink-2">Pick a time that suits you.</p>
            </div>
            <ButtonLink to="/book">
              Book a seat
              <ArrowRight size={18} />
            </ButtonLink>
          </Glass>
        ) : (
          <ul className="mt-4 space-y-3">
            {upcoming.map((b) => (
              <li key={b.id}>
                <BookingCard booking={b} timeFormat={timeFormat}>
                  {b.status === 'requested' && (
                    <p className="mt-4 text-[13px] leading-relaxed text-ink-2">
                      {b.replaces_starts_at
                        ? `A new time for your booking on ${when(b.replaces_starts_at)}. That booking stays as it is until the shop confirms this one.`
                        : 'Your time is held. The shop will confirm it soon.'}
                    </p>
                  )}
                  {b.status === 'booked' && b.moving_to && !b.cancel_requested && (
                    <p className="mt-4 rounded-2xl bg-warn-bg px-4 py-3 text-[13px] leading-relaxed text-warn">
                      You asked to move this to {when(b.moving_to)}. It stays as it is until the shop confirms the new time.
                    </p>
                  )}
                  {b.status === 'booked' && b.cancel_answer && !b.cancel_requested && (
                    <p className="mt-4 text-[13px] leading-relaxed text-ink-2">
                      <span className="font-medium text-ink">The shop kept this booking.</span> "{b.cancel_answer}"
                    </p>
                  )}
                  {b.status === 'declined' ? (
                    <div className="mt-4 space-y-3 border-t border-glass-line pt-4">
                      <p className="text-[14px] leading-relaxed text-ink-2">
                        <span className="font-medium text-ink">The shop couldn't take this one.</span>
                        {b.reason && ` "${b.reason}"`}
                      </p>
                      <ButtonLink to={`/book?branch=${b.branch_id ?? ''}&service=${b.service_id}`} variant="secondary">
                        Pick another time
                      </ButtonLink>
                    </div>
                  ) : (
                    <BookingInspo
                      bookingId={b.id}
                      editable={(b.status === 'booked' || b.status === 'requested') && new Date(b.starts_at).getTime() > now}
                    />
                  )}
                  {b.status === 'booked' && b.cancel_requested ? (
                    <div className="mt-5 flex flex-col gap-3 border-t border-glass-line pt-4 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-[13px] leading-relaxed text-warn">You asked to cancel. Your booking stands until the shop answers.</p>
                      <Button variant="ghost" className="shrink-0" loading={busy} onClick={() => keep(b)}>
                        Keep my booking
                      </Button>
                    </div>
                  ) : b.status === 'declined' ? null : changeable(b) ? (
                    <div className="mt-5 flex gap-2 border-t border-glass-line pt-4">
                      <Link
                        to={`/book?move=${b.id}&branch=${b.branch_id ?? ''}&service=${b.service_id}&barber=${b.barber_id ?? 'any'}`}
                        className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[14px] font-medium text-ink hover:bg-[var(--glass)]"
                      >
                        <Move size={16} />
                        Move
                      </Link>
                      <button
                        type="button"
                        onClick={() => setCancelling(b)}
                        className="inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[14px] font-medium text-bad hover:bg-bad-bg"
                      >
                        <Ban size={16} />
                        {b.status === 'booked' ? 'Ask to cancel' : 'Cancel'}
                      </button>
                    </div>
                  ) : b.status === 'booked' ? (
                    <p className="mt-4 border-t border-glass-line pt-4 text-[13px] text-ink-2">
                      Too close to change online. Please call the shop if you can't make it.
                    </p>
                  ) : null}
                </BookingCard>
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 && (
        <section>
          <h2 className="text-[18px] font-semibold tracking-tight">Past</h2>
          <ul className="mt-4 space-y-3">
            {past.map((b) => (
              <li key={b.id}>
                <BookingCard booking={b} timeFormat={timeFormat} muted>
                  {b.status === 'requested' && <p className="mt-3 text-[13px] text-ink-3">The shop didn't confirm this one in time.</p>}
                  {b.status === 'declined' && b.reason && <p className="mt-3 text-[13px] text-ink-3">Declined: "{b.reason}"</p>}
                </BookingCard>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog
        open={cancelling !== null}
        title={cancelling?.status === 'requested' ? 'Cancel this request?' : 'Ask the shop to cancel?'}
        onClose={() => setCancelling(null)}
      >
        <p className="text-[15px] text-ink-2">
          {cancelling &&
            `${cancelling.service}, ${new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(cancelling.starts_at))} at ${formatTime(cancelling.starts_at, timeFormat)}.`}
        </p>
        {cancelling?.status === 'booked' && (
          <p className="mt-3 text-[14px] leading-relaxed text-ink-2">
            The shop already planned around this booking, so it checks before cancelling. Your booking stands until they answer.
            {cancelling.moving_to && ' Your request for a new time will be dropped.'}
          </p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => setCancelling(null)}>
            Keep it
          </Button>
          <Button variant="danger" loading={busy} onClick={cancel}>
            {cancelling?.status === 'booked' ? 'Send cancel request' : 'Cancel request'}
          </Button>
        </div>
      </Dialog>
    </div>
  )
}

function BookingCard({
  booking,
  timeFormat,
  muted,
  children,
}: {
  booking: Booking
  timeFormat: '12h' | '24h'
  muted?: boolean
  children?: React.ReactNode
}) {
  const start = new Date(booking.starts_at)
  const day = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', day: 'numeric' }).format(start)
  const month = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', month: 'short' }).format(start)
  const weekday = new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', weekday: 'long' }).format(start)
  return (
    <Glass className={`p-5 ${muted ? 'opacity-80' : ''}`}>
      <div className="flex gap-4">
        {/* date block, like a calendar page */}
        <div className="flex w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-raised py-2">
          <span className="text-[12px] text-ink-2 uppercase">{month}</span>
          <span className="num text-[22px] leading-tight font-semibold">{day}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="text-[16px] font-medium">{booking.service}</p>
            <StatusBadge status={booking.status} />
          </div>
          <p className="num mt-1 text-[14px] text-ink-2">
            {weekday}, {formatTime(booking.starts_at, timeFormat)} · {booking.barber ?? 'Any barber'}
            {booking.branch && <span className="block">{booking.branch}</span>}
          </p>
          <p className="num mt-1 text-[14px] text-ink-2">
            {peso(booking.price_centavos)} · Code <span className="font-medium tracking-wider text-ink">{booking.code}</span>
          </p>
        </div>
      </div>
      {children}
    </Glass>
  )
}

