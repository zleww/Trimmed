import { manilaDateOf, manilaToday, manilaWallClock, addDays } from './dates'
import type { Api, Barber, Booking, BookingRules, OpeningHours, Profile, Service, Session } from './types'

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

const barbers: Barber[] = [
  { id: 'b1', display_name: 'Sample Barber 1', bio: 'Fades and tapers.', photo_url: null },
  { id: 'b2', display_name: 'Sample Barber 2', bio: 'Classic cuts and beards.', photo_url: null },
  { id: 'b3', display_name: 'Sample Barber 3', bio: 'Textured crops.', photo_url: null },
]

const hours: OpeningHours[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  opens_at: weekday === 0 ? '10:00:00' : '09:00:00',
  closes_at: weekday === 0 ? '17:00:00' : '20:00:00',
}))

const rules: BookingRules = { slot_step_minutes: 15, booking_days_ahead: 14, min_notice_minutes: 60, cancel_cutoff_minutes: 120 }

let session: Session | null = null
let profile: Profile | null = null
const bookings: Booking[] = []
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
      ['booked', 'checked_in', 'in_chair', 'done'].includes(b.status) &&
      new Date(b.starts_at) < end &&
      new Date(b.ends_at) > start,
  )
}

// a few made-up busy times so the slot grid doesn't look empty
function sampleBusy(barberId: string, start: Date): boolean {
  const n = start.getTime() / 900000 + barberId.charCodeAt(1)
  return n % 7 === 0 || n % 11 === 0
}

function slotsFor(serviceId: string, barberId: string | null, date: string): string[] {
  const service = services.find((s) => s.id === serviceId)
  const day = hours.find((h) => h.weekday === new Date(`${date}T00:00:00+08:00`).getUTCDay())
  if (!service || !day || date < manilaToday() || date > addDays(manilaToday(), rules.booking_days_ahead)) return []
  const open = manilaWallClock(date, day.opens_at).getTime()
  const close = manilaWallClock(date, day.closes_at).getTime()
  const earliest = Date.now() + rules.min_notice_minutes * 60000
  const out: string[] = []
  for (let t = open; t + service.duration_minutes * 60000 <= close; t += rules.slot_step_minutes * 60000) {
    const start = new Date(t)
    const end = new Date(t + service.duration_minutes * 60000)
    if (t < earliest) continue
    const candidates = barberId ? [barberId] : barbers.map((b) => b.id)
    if (candidates.some((id) => isFree(id, start, end) && !sampleBusy(id, start))) out.push(start.toISOString())
  }
  return out
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
  async freeSlots(serviceId, barberId, date) {
    await wait(300)
    return slotsFor(serviceId, barberId, date)
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
    setSession({ userId: '00000000-0000-4000-8000-000000000001', email })
    return session!
  },
  async signUp(email) {
    await wait()
    setSession({ userId: '00000000-0000-4000-8000-000000000001', email })
    return { needsConfirm: false }
  },
  async sendPasswordReset() {
    await wait()
  },
  async signOut() {
    setSession(null)
  },

  async myProfile() {
    return session ? profile : null
  },
  async saveProfile(fullName, mobile, consent) {
    await wait()
    const digits = mobile.replace(/\D/g, '').replace(/^63/, '0')
    if (!/^09\d{9}$/.test(digits)) throw new Error('Enter an 11-digit mobile number that starts with 09')
    if (!profile && !consent) throw new Error('Please agree to the privacy notice first')
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
      full_name: fullName.trim(),
      mobile: digits,
    }
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
    profile = null
    setSession(null)
  },

  async book(serviceId, barberId, startsAt) {
    await wait(400)
    needProfile()
    const service = services.find((s) => s.id === serviceId)!
    const date = manilaDateOf(startsAt)
    if (!slotsFor(serviceId, barberId, date).includes(startsAt)) throw new Error('That time is no longer free. Please pick another.')
    const start = new Date(startsAt)
    const end = new Date(start.getTime() + service.duration_minutes * 60000)
    const chosen = barberId ?? barbers.find((b) => isFree(b.id, start, end) && !sampleBusy(b.id, start))!.id
    const booking = {
      id: crypto.randomUUID(),
      code: Math.random().toString(16).slice(2, 10).toUpperCase(),
      starts_at: startsAt,
      ends_at: end.toISOString(),
      status: 'booked' as const,
      service_id: service.id,
      service: service.name,
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
      return await demoApi.book(old.service_id, barberId, startsAt)
    } catch (error) {
      old.status = 'booked'
      throw error
    }
  },
}
