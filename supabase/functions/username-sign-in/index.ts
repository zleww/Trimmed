// Sign in with a username instead of an email.
//
// Supabase Auth only knows emails. Turning a username into an email needs the
// secret key (usernames are public, emails are not), so it happens here, on
// Supabase's servers, and the email never goes back to the browser. Only the
// sign-in tokens do, exactly as a normal email sign-in would give them.
//
// Deploy: Supabase dashboard > Edge Functions > Deploy a new function > Via Editor,
// name it "username-sign-in", paste this file, deploy. Then open its Details and
// turn OFF "Verify JWT with legacy secret": people calling it aren't signed in yet.

import { createClient } from 'jsr:@supabase/supabase-js@2'

// Sites allowed to call this function. Add your own domain if it changes.
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://trimmed-ten.vercel.app,http://localhost:5175,http://localhost:5176')
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

/** The public key, for the sign-in itself (the same call the browser makes for an email). */
function publishableKey(): string {
  const keys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>
    if (parsed.default) return parsed.default
  }
  return Deno.env.get('SUPABASE_ANON_KEY') ?? ''
}

// the same answer for "no such username" and "wrong password", so nobody can test which usernames exist
const WRONG = 'Wrong username or password.'

Deno.serve(async (request) => {
  const headers = { ...corsHeaders(request.headers.get('Origin')), 'Content-Type': 'application/json' }
  if (request.method === 'OPTIONS') return new Response('ok', { headers })
  const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers })

  try {
    if (request.method !== 'POST') return reply(405, { error: 'Use POST.' })

    const body = (await request.json().catch(() => ({}))) as { username?: unknown; password?: unknown }
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!/^[a-z0-9._]{3,20}$/.test(username) || password.length === 0 || password.length > 72) {
      return reply(400, { error: WRONG })
    }

    // the visitor's address, only for the wrong-tries limit
    const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null
    const url = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(url, secretKey(), { auth: { persistSession: false, autoRefreshToken: false } })

    const found = await admin.rpc('login_email', { p_username: username, p_ip: ip })
    if (found.error) {
      // the database raises this one itself when there were too many wrong tries
      if (/Too many tries/.test(found.error.message)) return reply(429, { error: found.error.message })
      console.error('login_email failed', found.error.message)
      return reply(500, { error: 'Sign-in is not working right now. Try your email instead.' })
    }
    const email = found.data as string | null
    if (!email) {
      await admin.rpc('note_login_failure', { p_username: username, p_ip: ip })
      return reply(401, { error: WRONG })
    }

    const auth = createClient(url, publishableKey(), { auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await auth.auth.signInWithPassword({ email, password })
    if (error || !data.session) {
      if (error?.code === 'email_not_confirmed') {
        return reply(403, { error: 'Confirm your email first: open the link we sent when you signed up.' })
      }
      await admin.rpc('note_login_failure', { p_username: username, p_ip: ip })
      return reply(401, { error: WRONG })
    }

    await admin.rpc('clear_login_failures', { p_username: username })
    // only the tokens go back; the browser stores them the same way as an email sign-in
    return reply(200, { access_token: data.session.access_token, refresh_token: data.session.refresh_token })
  } catch (error) {
    console.error('username-sign-in crashed', error instanceof Error ? error.message : error)
    return reply(500, { error: 'Sign-in is not working right now. Try your email instead.' })
  }
})
