// Shapes of the data the screens use. Money is always whole centavos (25000 = P250.00).

export type Service = {
  id: string
  name: string
  description: string | null
  duration_minutes: number
  price_centavos: number
}

export type Barber = {
  id: string
  display_name: string
  bio: string | null
  photo_url: string | null
}

/** weekday: 0 = Sunday. Times are "HH:MM:SS" in Manila. */
export type OpeningHours = { weekday: number; opens_at: string; closes_at: string }

export type BookingRules = {
  slot_step_minutes: number
  booking_days_ahead: number
  min_notice_minutes: number
  cancel_cutoff_minutes: number
}

export type BookingStatus = 'booked' | 'checked_in' | 'in_chair' | 'done' | 'cancelled' | 'no_show'

export type Booking = {
  id: string
  code: string
  starts_at: string
  ends_at: string
  status: BookingStatus
  service_id: string
  service: string
  barber_id: string | null
  barber: string | null
  price_centavos: number
}

export type Theme = 'dark' | 'light' | 'system'
export type TimeFormat = '12h' | '24h'

export type Profile = {
  id: string
  full_name: string
  mobile: string
  avatar_path: string | null
  avatar_url: string | null
  preferred_barber: string | null
  theme: Theme
  time_format: TimeFormat
  promo_opt_in: boolean
  member_since: string
}

export type Settings = Pick<Profile, 'theme' | 'time_format' | 'preferred_barber' | 'promo_opt_in'>

export type Session = { userId: string; email: string }

/** Everything the booking app asks of the backend. */
export type Api = {
  // public
  listServices(): Promise<Service[]>
  listBarbers(): Promise<Barber[]>
  openingHours(): Promise<OpeningHours[]>
  bookingRules(): Promise<BookingRules>
  /** Free start times (ISO strings) for a Manila date "YYYY-MM-DD". barberId null = any barber. */
  freeSlots(serviceId: string, barberId: string | null, date: string): Promise<string[]>

  // account
  getSession(): Promise<Session | null>
  onSessionChange(listener: (session: Session | null) => void): () => void
  signIn(email: string, password: string): Promise<Session>
  /** Returns needsConfirm = true when the account must click the email link first. */
  signUp(email: string, password: string): Promise<{ needsConfirm: boolean }>
  sendPasswordReset(email: string): Promise<void>
  signOut(): Promise<void>

  // profile
  myProfile(): Promise<Profile | null>
  saveProfile(fullName: string, mobile: string, consent: boolean): Promise<Profile>
  saveSettings(settings: Settings): Promise<Profile>
  uploadAvatar(file: Blob): Promise<Profile>
  removeAvatar(): Promise<Profile>
  deleteMyData(): Promise<void>

  // bookings
  book(serviceId: string, barberId: string | null, startsAt: string): Promise<Booking>
  myBookings(): Promise<Booking[]>
  cancelBooking(id: string): Promise<Booking>
  rescheduleBooking(id: string, barberId: string | null, startsAt: string): Promise<Booking>
}
