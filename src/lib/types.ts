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
  /** public handle shown on reviews; older profiles may have none */
  username: string | null
  /** the name the shop calls you */
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

/** What the sign-up form collected, kept on the login until the profile is made. */
export type SignupDetails = { username: string; full_name: string; mobile: string }

export type Session = { userId: string; email: string; pending: SignupDetails | null }

export type Rating = { average: number | null; reviews: number }

export type Review = {
  id: string
  rating: number
  comment: string | null
  created_at: string
  edited: boolean
  username: string | null
  mine: boolean
}

export type BarberReviews = { reviews: Review[]; can_review: boolean }

/** A photo or short video the customer added to a booking for the barber. */
export type Inspo = { id: string; kind: 'image' | 'video'; url: string | null }

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
  signUp(email: string, password: string, details: SignupDetails): Promise<{ needsConfirm: boolean }>
  /** True when nobody else has this username (and it has the right shape). */
  usernameAvailable(username: string): Promise<boolean>
  sendPasswordReset(email: string): Promise<void>
  /** Calls back when someone opens the "set a new password" link from their email. */
  onPasswordRecovery(listener: () => void): () => void
  updatePassword(password: string): Promise<void>
  /** Forget the sign-up details once the profile exists. */
  clearPending(): Promise<void>
  signOut(): Promise<void>

  // profile
  myProfile(): Promise<Profile | null>
  saveProfile(username: string, fullName: string, mobile: string, consent: boolean): Promise<Profile>
  setFavourite(barberId: string | null): Promise<Profile>
  saveSettings(settings: Settings): Promise<Profile>
  uploadAvatar(file: Blob): Promise<Profile>
  removeAvatar(): Promise<Profile>
  deleteMyData(): Promise<void>

  // bookings
  book(serviceId: string, barberId: string | null, startsAt: string): Promise<Booking>
  myBookings(): Promise<Booking[]>
  cancelBooking(id: string): Promise<Booking>
  rescheduleBooking(id: string, barberId: string | null, startsAt: string): Promise<Booking>

  // reviews
  barberRatings(): Promise<Record<string, Rating>>
  barberReviews(barberId: string): Promise<BarberReviews>
  reviewBarber(barberId: string, rating: number, comment: string): Promise<BarberReviews>
  removeMyReview(barberId: string): Promise<BarberReviews>

  // inspo on a booking
  listInspo(bookingId: string): Promise<Inspo[]>
  addInspo(bookingId: string, file: Blob, kind: Inspo['kind']): Promise<Inspo>
  removeInspo(id: string): Promise<void>
}
