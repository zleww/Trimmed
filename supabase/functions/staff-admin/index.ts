// Staff logins, managed by the owner from the staff app's Staff page.
//
// Making a login needs Supabase's secret key, which must never reach the
// browser. This function runs on Supabase's servers, where the key is
// available, and only does anything after checking that the caller is an
// active owner.
//
// Deploy: Supabase dashboard > Edge Functions > Deploy a new function > Via Editor.
// Set the name to "staff-admin" BEFORE deploying, paste this file, turn
// "Verify JWT" on, and deploy.

import { createClient } from 'jsr:@supabase/supabase-js@2'

// Sites allowed to call this function. Add your own domain if it changes.
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://trimmed-staff.vercel.app,http://localhost:5177,http://localhost:5178')
  .split(',')
  .map((origin) => origin.trim())

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0]!,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

/** The server-only secret key: the new key system first, the legacy one as a fallback. */
function secretKey(): string {
  const keys = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>
    if (parsed.default) return parsed.default
  }
  const legacy = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!legacy) throw new Error('No secret key available')
  return legacy
}

/** The public key, used to act as the signed-in owner so the database's own rules apply. */
function publishableKey(): string {
  const keys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>
    if (parsed.default) return parsed.default
  }
  return Deno.env.get('SUPABASE_ANON_KEY') ?? ''
}

class Refusal extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function checkPassword(password: unknown): string {
  if (typeof password !== 'string' || password.length < 10) throw new Refusal('Use a password of at least 10 characters.')
  if (password.length > 72) throw new Refusal('Use a password of at most 72 characters.')
  return password
}

function checkId(id: unknown, what: string): string {
  if (typeof id !== 'string' || !uuidPattern.test(id)) throw new Refusal(`Pick the ${what}.`)
  return id
}

Deno.serve(async (request) => {
  const headers = { ...corsHeaders(request.headers.get('Origin')), 'Content-Type': 'application/json' }
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers })

  try {
    if (request.method !== 'POST') throw new Refusal('Use POST.', 405)

    const url = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(url, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } })

    // Who is calling? The browser sends the signed-in user's token.
    const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: caller, error: callerError } = await admin.auth.getUser(token)
    if (callerError || !caller.user) throw new Refusal('Sign in again.', 401)

    // Ask the database as the caller, so its own owner check decides
    // (this also covers two-step sign-in once it is turned on).
    const asCaller = createClient(url, publishableKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    })
    const { data: isOwner } = await asCaller.rpc('is_owner')
    if (isOwner !== true) throw new Refusal('Only the owner can manage staff accounts.', 403)

    const body = await request.json().catch(() => ({}))

    if (body.action === 'create') {
      const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      const role = body.role === 'barber' ? 'barber' : body.role === 'desk' ? 'desk' : null
      if (fullName.length < 2 || fullName.length > 80) throw new Refusal('Enter their full name.')
      if (!emailPattern.test(email)) throw new Refusal('Enter a valid email address.')
      if (!role) throw new Refusal('Pick front desk or barber.')
      const branchId = checkId(body.branchId, 'branch')
      const password = checkPassword(body.password)

      const { data: branch } = await admin.from('branches').select('id').eq('id', branchId).eq('active', true).maybeSingle()
      if (!branch) throw new Refusal('That branch is not open.')

      const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
      if (error || !created.user) {
        throw new Refusal(/already|registered|exists/i.test(error?.message ?? '') ? 'That email already has a login.' : "Couldn't create the login. Try again.")
      }
      const userId = created.user.id

      // these rows need columns the app may not set (the login id), so they use
      // the server key; the owner check above still applies
      let barberId: string | null = null
      try {
        if (role === 'barber') {
          const { data: chair, error: chairError } = await admin
            .from('barbers')
            .insert({ display_name: fullName, branch_id: branchId, sort: 99 })
            .select('id')
            .single()
          if (chairError || !chair) throw new Error('chair')
          barberId = chair.id
        }
        const { error: rowError } = await admin
          .from('staff')
          .insert({ id: userId, full_name: fullName, role, branch_id: role === 'desk' ? branchId : null, barber_id: barberId })
        if (rowError) throw new Error('staff')
      } catch {
        // don't leave a login (or an empty chair) behind
        if (barberId) await admin.from('barbers').update({ active: false }).eq('id', barberId)
        await admin.auth.admin.deleteUser(userId)
        throw new Refusal("Couldn't save the staff account. Try again.")
      }
      return reply(200, { id: userId })
    }

    if (body.action === 'set_password') {
      const staffId = checkId(body.staffId, 'staff member')
      const password = checkPassword(body.password)
      const { data: row } = await admin.from('staff').select('id').eq('id', staffId).maybeSingle()
      if (!row) throw new Refusal('Staff member not found.', 404)
      const { error } = await admin.auth.admin.updateUserById(staffId, { password })
      if (error) throw new Refusal("Couldn't change the password. Try again.")
      return reply(200, { ok: true })
    }

    if (body.action === 'set_active') {
      const staffId = checkId(body.staffId, 'staff member')
      const active = body.active === true
      if (staffId === caller.user.id && !active) throw new Refusal("You can't turn off your own account.")

      const { data: row, error } = await asCaller.from('staff').update({ active }).eq('id', staffId).select('barber_id').maybeSingle()
      if (error || !row) throw new Refusal("Couldn't update the account. Try again.")
      // a turned-off barber stops taking bookings too
      if (row.barber_id) await admin.from('barbers').update({ active }).eq('id', row.barber_id)
      // a ban also stops an old session from being renewed
      await admin.auth.admin.updateUserById(staffId, { ban_duration: active ? 'none' : '876000h' })
      return reply(200, { ok: true })
    }

    throw new Refusal('Unknown action.')
  } catch (error) {
    if (error instanceof Refusal) return reply(error.status, { error: error.message })
    console.error('staff-admin failed')
    return reply(500, { error: 'Something went wrong. Try again.' })
  }
})
