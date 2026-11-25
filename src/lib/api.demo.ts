import { manilaDateOf, manilaToday, manilaWallClock, addDays } from './dates'
import type { Api, Barber, BarberReviews, Booking, Branch, BookingRequest, BookingRules, Inspo, OpeningHours, Profile, Review, Service, Session, StaffRole } from './types'

// Sample data for working on the screens without a database.
// Development only: api.ts never loads this file in a production build.
// Names and prices here are made up and must never appear on the live site.

const services: Service[] = [
  { id: 's1', name: 'Classic cut', description: 'Scissor and clipper cut, styled.', duration_minutes: 30, price_centavos: 25000 },
  { id: 's2', name: 'Skin fade', description: 'Fade down to the skin, sharp line-up.', duration_minutes: 45, price_centavos: 35000 },
  { id: 's3', name: 'Beard trim', description: 'Shape, line and hot towel.', duration_minutes: 20, price_centavos: 15000 },
  { id: 's4', name: 'Cut and beard', description: 'Any cut plus a full beard trim.', duration_minutes: 60, price_centavos: 45000 },
  { id: 's5', name: 'Kids cut', description: 'For 12 and under.', duration_minutes: 30, price_centavos: 20000 },
]

// two made-up branches, so the location step can be tried
const branches: Branch[] = [
  { id: 'br1', name: 'Sample Branch One', address: '123 Sample Street, Sample City', phone: '0917 000 0001' },
  { id: 'br2', name: 'Sample Branch Two', address: '45 Example Avenue, Sample City', phone: null },
]

const barbers: Barber[] = [
  { id: 'b1', branch_id: 'br1', display_name: 'Sample Barber 1', bio: 'Fades and tapers.', photo_url: null },
  { id: 'b2', branch_id: 'br1', display_name: 'Sample Barber 2', bio: 'Classic cuts and beards.', photo_url: null },
  { id: 'b3', branch_id: 'br2', display_name: 'Sample Barber 3', bio: 'Textured crops.', photo_url: null },
]

// Branch One: 9 to 8 (Sunday 10 to 5). Branch Two: 11 to 9, closed Mondays.
const hours: OpeningHours[] = [
  ...[0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
    branch_id: 'br1',
    weekday,
    opens_at: weekday === 0 ? '10:00:00' : '09:00:00',
    closes_at: weekday === 0 ? '17:00:00' : '20:00:00',
  })),
  ...[0, 2, 3, 4, 5, 6].map((weekday) => ({ branch_id: 'br2', weekday, opens_at: '11:00:00', closes_at: '21:00:00' })),
]

const rules: BookingRules = { slot_step_minutes: 15, booking_days_ahead: 14, min_notice_minutes: 60, cancel_cutoff_minutes: 120 }

let session: Session | null = null
let profile: Profile | null = null
const bookings: Booking[] = []
const takenUsernames = new Set(['admin', 'owner', 'staff', 'desk', 'barber', 'trimmed', 'sample.fan'])
const inspo = new Map<string, Inspo & { bookingId: string }>()

// made-up reviews so the barber page has something to show
const reviews: (Review & { barberId: string })[] = [
  { id: 'r1', barberId: 'b1', rating: 5, comment: 'Clean skin fade, took his time on the line-up.', created_at: '2026-11-02T06:00:00Z', edited: false, username: 'sample.fan', mine: false },
  { id: 'r2', barberId: 'b1', rating: 4, comment: 'Good cut. Slightly late start.', created_at: '2026-10-21T09:30:00Z', edited: false, username: 'jm_sample', mine: false },
  { id: 'r3', barberId: 'b2', rating: 5, comment: null, created_at: '2026-11-10T03:00:00Z', edited: false, username: 'cutclient', mine: false },
]

function reviewsFor(barberId: string): BarberReviews {
  return {
    reviews: reviews
      .filter((r) => r.barberId === barberId)
      .map(({ barberId: _barber, ...r }) => ({ ...r, mine: r.username !== null && r.username === profile?.username }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    // in the sample data, a finished cut with every barber is pretended once you have a profile
    can_review: Boolean(profile),
  }
}
const listeners = new Set<(s: Session | null) => void>()

const wait = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms))
const setSession = (next: Session | null) => {
  session = next
  listeners.forEach((listener) => listener(next))
}

function isFree(barberId: string, start: Date, end: Date): boolean {
  return !bookings.some(
    (b) =>
      b.barber_id === barberId &&
      ['requested', 'booked', 'checked_in', 'in_chair', 'done'].includes(b.status) &&
      new Date(b.starts_at) < end &&
      new Date(b.ends_at) > start,
  )
}

// a few made-up busy times so the slot grid doesn't look empty
function sampleBusy(barberId: string, start: Date): boolean {
  const n = start.getTime() / 900000 + barberId.charCodeAt(1)
  return n % 7 === 0 || n % 11 === 0
}

// is this barber's branch open for the whole of [start, end)?
function branchOpen(barberId: string, date: string, start: number, end: number): boolean {
  const branchId = barbers.find((b) => b.id === barberId)?.branch_id
  const day = hours.find((h) => h.branch_id === branchId && h.weekday === new Date(`${date}T00:00:00+08:00`).getUTCDay())
  return Boolean(day) && manilaWallClock(date, day!.opens_at).getTime() <= start && manilaWallClock(date, day!.closes_at).getTime() >= end
}

function slotsFor(serviceId: string, branchId: string | null, barberId: string | null, date: string): string[] {
  const service = services.find((s) => s.id === serviceId)
  if (!service || date < manilaToday() || date > addDays(manilaToday(), rules.booking_days_ahead)) return []
  const candidates = barbers.filter((b) => (!barberId || b.id === barberId) && (!branchId || b.branch_id === branchId)).map((b) => b.id)
  const earliest = Date.now() + rules.min_notice_minutes * 60000
  const out: string[] = []
  // every 15 minutes of the day; each barber's own branch hours decide
  for (let t = manilaWallClock(date, '06:00:00').getTime(); t < manilaWallClock(date, '23:00:00').getTime(); t += rules.slot_step_minutes * 60000) {
    const start = new Date(t)
    const end = new Date(t + service.duration_minutes * 60000)
    if (t < earliest) continue
    if (candidates.some((id) => branchOpen(id, date, t, end.getTime()) && isFree(id, start, end) && !sampleBusy(id, start))) {
      out.push(start.toISOString())
    }
  }
  return out
}

// In the sample data, signing in with an email that starts with "owner@" or "desk@"
// makes you staff, so the shop screens can be tried.
function demoRole(): StaffRole | null {
  const email = session?.email ?? ''
  return email.startsWith('owner@') ? 'owner' : email.startsWith('desk@') ? 'desk' : null
}

function needDesk() {
  const role = demoRole()
  if (role !== 'owner' && role !== 'desk') throw new Error('Not allowed')
}

function waiting(id: string): Booking {
  needDesk()
  const booking = bookings.find((b) => b.id === id)
  if (!booking) throw new Error('Request not found')
  if (booking.status !== 'requested') throw new Error('This request was already answered or cancelled')
  return booking
}

function needProfile(): Profile {
  if (!profile) throw new Error('Finish your profile first')
  return profile
}

export const demoApi: Api = {
  async listServices() {
    await wait()
    return services
  },
  async listBranches() {
    await wait(150)
    return branches
  },
  async listBarbers() {
    await wait()
    return barbers
  },
  async openingHours() {
    return hours
  },
  async bookingRules() {
    return rules
  },
  async freeSlots(serviceId, branchId, barberId, date) {
    await wait(300)
    return slotsFor(serviceId, branchId, barberId, date)
  },

  async getSession() {
    return session
  },
  onSessionChange(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  async signIn(email) {
    await wait()
    setSession({ userId: '00000000-0000-4000-8000-000000000001', email, pending: null })
    return session!
  },
  async signUp(email, _password, details) {
    await wait()
    setSession({ userId: '00000000-0000-4000-8000-000000000001', email, pending: details })
    return { needsConfirm: false }
  },
  async usernameAvailable(username) {
    await wait(150)
    const clean = username.trim().toLowerCase()
    return (/^[a-z0-9._]{3,20}$/.test(clean) && !takenUsernames.has(clean)) || clean === profile?.username
  },
  async sendPasswordReset() {
    await wait()
  },
  onPasswordRecovery() {
    return () => {}
  },
  async updatePassword(password) {
    await wait()
    if (password.length < 10) throw new Error('Pick a stronger password: at least 10 characters with letters and numbers.')
  },
  async clearPending() {
    if (session) session = { ...session, pending: null }
  },
  async signOut() {
    setSession(null)
  },

  async myProfile() {
    return session ? profile : null
  },
  async saveProfile(username, fullName, mobile, consent) {
    await wait()
    const handle = username.trim().toLowerCase()
    if (!/^[a-z0-9._]{3,20}$/.test(handle)) throw new Error('Pick a username: 3 to 20 letters, numbers, dots or underscores')
    if (takenUsernames.has(handle) && handle !== profile?.username) throw new Error('That username is taken. Try another.')
    const digits = mobile.replace(/\D/g, '').replace(/^63/, '0')
    if (!/^09\d{9}$/.test(digits)) throw new Error('Enter an 11-digit mobile number that starts with 09')
    if (!profile && !consent) throw new Error('Please agree to the privacy notice first')
    if (profile?.username) takenUsernames.delete(profile.username)
    takenUsernames.add(handle)
    profile = {
      id: 'c1',
      avatar_path: null,
      avatar_url: null,
      preferred_barber: null,
      theme: 'dark',
      time_format: '12h',
      promo_opt_in: false,
      member_since: new Date().toISOString(),
      ...profile,
      username: handle,
      full_name: fullName.trim(),
      mobile: digits,
    }
    return profile
  },
  async setFavourite(barberId) {
    await wait(150)
    profile = { ...needProfile(), preferred_barber: barberId }
    return profile
  },
  async saveSettings(settings) {
    await wait()
    profile = { ...needProfile(), ...settings }
    return profile
  },
  async uploadAvatar(file) {
    await wait()
    profile = { ...needProfile(), avatar_path: 'demo/avatar.webp', avatar_url: URL.createObjectURL(file) }
    return profile
  },
  async removeAvatar() {
    profile = { ...needProfile(), avatar_path: null, avatar_url: null }
    return profile
  },
  async deleteMyData() {
    await wait()
    bookings.forEach((b) => {
      if (b.status === 'booked') b.status = 'cancelled'
    })
    for (let i = reviews.length - 1; i >= 0; i--) if (reviews[i]!.username === profile?.username) reviews.splice(i, 1)
    inspo.clear()
    profile = null
    setSession(null)
  },

  async book(serviceId, branchId, barberId, startsAt) {
    await wait(400)
    needProfile()
    const service = services.find((s) => s.id === serviceId)!
    const date = manilaDateOf(startsAt)
    if (barberId && barbers.find((b) => b.id === barberId)?.branch_id !== branchId) throw new Error('That barber works at another location')
    if (!slotsFor(serviceId, branchId, barberId, date).includes(startsAt)) throw new Error('That time is no longer free. Please pick another.')
    const start = new Date(startsAt)
    const end = new Date(start.getTime() + service.duration_minutes * 60000)
    const chosen =
      barberId ??
      barbers.find((b) => b.branch_id === branchId && branchOpen(b.id, date, start.getTime(), end.getTime()) && isFree(b.id, start, end) && !sampleBusy(b.id, start))!.id
    const booking: Booking = {
      id: crypto.randomUUID(),
      code: Math.random().toString(16).slice(2, 10).toUpperCase(),
      starts_at: startsAt,
      ends_at: end.toISOString(),
      status: 'requested' as const,
      service_id: service.id,
      service: service.name,
      branch_id: branchId,
      branch: branches.find((b) => b.id === branchId)?.name ?? null,
      barber: barbers.find((b) => b.id === chosen)!.display_name,
      barber_id: chosen,
      price_centavos: service.price_centavos,
    }
    bookings.push(booking)
    return booking
  },
  async myBookings() {
    await wait()
    return [...bookings].sort((a, b) => b.starts_at.localeCompare(a.starts_at))
  },
  async cancelBooking(id) {
    await wait()
    const booking = bookings.find((b) => b.id === id)
    if (!booking) throw new Error('Booking not found')
    booking.status = 'cancelled'
    return booking
  },
  async rescheduleBooking(id, barberId, startsAt) {
    const old = bookings.find((b) => b.id === id)
    if (!old) throw new Error('Booking not found')
    old.status = 'cancelled'
    try {
      const moved = await demoApi.book(old.service_id, old.branch_id ?? 'br1', barberId, startsAt)
      for (const item of inspo.values()) if (item.bookingId === id) item.bookingId = moved.id
      return moved
    } catch (error) {
      old.status = 'booked'
      throw error
    }
  },

  async barberRatings() {
    await wait(150)
    const out: Record<string, { average: number | null; reviews: number }> = {}
    for (const b of barbers) {
      const list = reviews.filter((r) => r.barberId === b.id)
      const total = list.reduce((sum, r) => sum + r.rating, 0)
      out[b.id] = { average: list.length ? Math.round((total / list.length) * 10) / 10 : null, reviews: list.length }
    }
    return out
  },
  async barberReviews(barberId) {
    await wait()
    return reviewsFor(barberId)
  },
  async reviewBarber(barberId, rating, comment) {
    await wait()
    const me = needProfile()
    const text = comment.trim() || null
    const existing = reviews.find((r) => r.barberId === barberId && r.username === me.username)
    if (existing) Object.assign(existing, { rating, comment: text, edited: true })
    else {
      reviews.push({ id: crypto.randomUUID(), barberId, rating, comment: text, created_at: new Date().toISOString(), edited: false, username: me.username, mine: true })
    }
    return reviewsFor(barberId)
  },
  async removeMyReview(barberId) {
    await wait()
    const index = reviews.findIndex((r) => r.barberId === barberId && r.username === profile?.username)
    if (index >= 0) reviews.splice(index, 1)
    return reviewsFor(barberId)
  },

  async myStaffRole() {
    return demoRole()
  },
  async bookingRequests(): Promise<BookingRequest[]> {
    await wait()
    needDesk()
    return bookings
      .filter((b) => b.status === 'requested' && new Date(b.starts_at).getTime() > Date.now())
      .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
      .map((b) => ({
        id: b.id,
        code: b.code,
        starts_at: b.starts_at,
        ends_at: b.ends_at,
        service: b.service,
        price_centavos: b.price_centavos,
        branch_id: b.branch_id ?? 'br1',
        branch: b.branch ?? 'Sample Branch One',
        barber_id: b.barber_id,
        barber: b.barber,
        customer: profile?.full_name ?? 'Sample Customer',
        username: profile?.username ?? null,
        mobile: profile?.mobile ?? '09171234567',
        requested_at: new Date().toISOString(),
        visits: 2,
        no_shows: 0,
        inspo: [...inspo.values()].filter((i) => i.bookingId === b.id).length,
      }))
  },
  async confirmBooking(id) {
    await wait()
    waiting(id).status = 'booked'
  },
  async declineBooking(id, reason) {
    await wait()
    if (reason.trim().length < 3) throw new Error('Give the customer a short reason (3 to 200 characters)')
    const booking = waiting(id)
    booking.status = 'declined'
    booking.reason = reason.trim()
  },

  async listInspo(bookingId) {
    await wait(150)
    return [...inspo.values()].filter((i) => i.bookingId === bookingId).map(({ bookingId: _booking, ...item }) => item)
  },
  async addInspo(bookingId, file, kind) {
    await wait(500)
    if ([...inspo.values()].filter((i) => i.bookingId === bookingId).length >= 3) throw new Error('Up to 3 photos or videos per booking')
    const item = { id: crypto.randomUUID(), kind, url: URL.createObjectURL(file), bookingId }
    inspo.set(item.id, item)
    return { id: item.id, kind, url: item.url }
  },
  async removeInspo(id) {
    await wait(150)
    inspo.delete(id)
  },
}
