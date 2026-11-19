import type { AuthError, PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import type { Api, Barber, Booking, Profile, Session } from './types'

// Turns database and sign-in errors into plain sentences.
// Our own database functions already raise plain messages (code P0001), so
// those are shown as they are. Anything else gets a general message, never the
// raw database text.
function friendly(error: PostgrestError | AuthError | Error): Error {
  const code = 'code' in error ? error.code : undefined
  const message = error.message ?? ''
  if (code === 'P0001') return new Error(message)
  if (code === '42501') return new Error("You don't have access to that.")
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
    return new Error('Wrong email or password.')
  }
  if (code === 'email_not_confirmed') return new Error('Confirm your email first. Check your inbox for the link.')
  if (code === 'user_already_exists') return new Error('There is already an account with that email. Sign in instead.')
  if (code === 'weak_password') return new Error('Pick a stronger password: at least 10 characters with letters and numbers.')
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') {
    return new Error('Too many tries. Wait a few minutes and try again.')
  }
  if (/fetch|network/i.test(message)) return new Error("Can't reach the server. Check your connection.")
  return new Error('Something went wrong. Please try again.')
}

function check<T>(result: { data: T; error: PostgrestError | null }): T {
  if (result.error) throw friendly(result.error)
  return result.data
}

const AVATARS = 'avatars'
const BARBER_PHOTOS = 'barber-photos'

export function createSupabaseApi(db: SupabaseClient): Api {
  const toSession = (user: { id: string; email?: string } | null | undefined): Session | null =>
    user ? { userId: user.id, email: user.email ?? '' } : null

  // The photo bucket is private, so the app gets a link that works for an hour.
  async function withAvatarUrl(raw: Omit<Profile, 'avatar_url'> | null): Promise<Profile | null> {
    if (!raw) return null
    let avatar_url: string | null = null
    if (raw.avatar_path) {
      const { data } = await db.storage.from(AVATARS).createSignedUrl(raw.avatar_path, 3600)
      avatar_url = data?.signedUrl ?? null
    }
    return { ...raw, avatar_url }
  }

  async function profileOrFail(raw: Omit<Profile, 'avatar_url'>): Promise<Profile> {
    const profile = await withAvatarUrl(raw)
    if (!profile) throw new Error('Something went wrong. Please try again.')
    return profile
  }

  return {
    async listServices() {
      const rows = check(
        await db
          .from('services')
          .select('id, name, description, duration_minutes, price_centavos')
          .eq('active', true)
          .order('sort')
          .order('name'),
      )
      return rows ?? []
    },

    async listBarbers() {
      const rows = check(
        await db.from('barbers').select('id, display_name, bio, photo_path').eq('active', true).order('sort'),
      ) as (Omit<Barber, 'photo_url'> & { photo_path: string | null })[]
      return rows.map(({ photo_path, ...barber }) => ({
        ...barber,
        photo_url: photo_path ? db.storage.from(BARBER_PHOTOS).getPublicUrl(photo_path).data.publicUrl : null,
      }))
    },

    async openingHours() {
      return check(await db.rpc('public_shop_hours'))
    },

    async bookingRules() {
      const rows = check(await db.rpc('booking_rules'))
      return rows[0]
    },

    async freeSlots(serviceId, barberId, date) {
      const rows = check(await db.rpc('get_free_slots', { p_service: serviceId, p_barber: barberId, p_date: date })) as {
        starts_at: string
      }[]
      return rows.map((row) => row.starts_at)
    },

    async getSession() {
      const { data } = await db.auth.getSession()
      return toSession(data.session?.user)
    },

    onSessionChange(listener) {
      const { data } = db.auth.onAuthStateChange((_event, session) => listener(toSession(session?.user)))
      return () => data.subscription.unsubscribe()
    },

    async signIn(email, password) {
      const { data, error } = await db.auth.signInWithPassword({ email, password })
      if (error) throw friendly(error)
      const session = toSession(data.user)
      if (!session) throw new Error('Something went wrong. Please try again.')
      return session
    },

    async signUp(email, password) {
      const { data, error } = await db.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/welcome` },
      })
      if (error) throw friendly(error)
      return { needsConfirm: !data.session }
    },

    async sendPasswordReset(email) {
      const { error } = await db.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/account/settings`,
      })
      if (error) throw friendly(error)
    },

    async signOut() {
      await db.auth.signOut()
    },

    async myProfile() {
      return withAvatarUrl(check(await db.rpc('my_profile')))
    },

    async saveProfile(fullName, mobile, consent) {
      check(await db.rpc('save_my_profile', { p_full_name: fullName, p_mobile: mobile, p_consent: consent }))
      return profileOrFail(check(await db.rpc('my_profile')))
    },

    async saveSettings(settings) {
      return profileOrFail(
        check(
          await db.rpc('save_my_settings', {
            p_theme: settings.theme,
            p_time_format: settings.time_format,
            p_preferred_barber: settings.preferred_barber,
            p_promo_opt_in: settings.promo_opt_in,
          }),
        ),
      )
    },

    async uploadAvatar(file) {
      const { data } = await db.auth.getUser()
      if (!data.user) throw new Error('Sign in first.')
      // a new file name each time, so an old cached photo never shows
      const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp'
      const path = `${data.user.id}/avatar-${Date.now()}.${type === 'image/jpeg' ? 'jpg' : 'webp'}`
      const upload = await db.storage.from(AVATARS).upload(path, file, { contentType: type, upsert: false })
      if (upload.error) throw new Error("Couldn't upload the photo. Use a JPG, PNG or WebP under 2 MB.")
      const before = check(await db.rpc('my_profile')) as Profile | null
      const after = check(await db.rpc('set_my_avatar', { p_path: path }))
      if (before?.avatar_path) await db.storage.from(AVATARS).remove([before.avatar_path])
      return profileOrFail(after)
    },

    async removeAvatar() {
      const before = check(await db.rpc('my_profile')) as Profile | null
      const after = check(await db.rpc('set_my_avatar', { p_path: null }))
      if (before?.avatar_path) await db.storage.from(AVATARS).remove([before.avatar_path])
      return profileOrFail(after)
    },

    async deleteMyData() {
      const before = check(await db.rpc('my_profile')) as Profile | null
      if (before?.avatar_path) await db.storage.from(AVATARS).remove([before.avatar_path])
      check(await db.rpc('delete_my_data'))
      await db.auth.signOut()
    },

    async book(serviceId, barberId, startsAt) {
      return check(
        await db.rpc('book_appointment', { p_service: serviceId, p_barber: barberId, p_starts_at: startsAt }),
      ) as Booking
    },

    async myBookings() {
      return check(await db.rpc('my_bookings')) as Booking[]
    },

    async cancelBooking(id) {
      return check(await db.rpc('cancel_my_booking', { p_id: id })) as Booking
    },

    async rescheduleBooking(id, barberId, startsAt) {
      return check(
        await db.rpc('reschedule_my_booking', { p_id: id, p_barber: barberId, p_starts_at: startsAt }),
      ) as Booking
    },
  }
}
