import { beforeEach, describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addCustomer, as, createDatabase, rows, setupShop, value } from './helpers'

let db: PGlite
let alice: string

beforeEach(async () => {
  db = await createDatabase()
  await setupShop(db)
  alice = await addCustomer(db, 'Alice Cruz', '09171234567')
  await as(db, alice, () => db.query("select public.save_my_profile('alice', 'Alice Cruz', '09171234567', true)"))
  await db.query("update auth.users set email = 'alice@example.com' where id = $1", [alice])
})

/** Run as the Edge Function does: with the secret key (service_role). */
async function asServer<T>(fn: () => Promise<T>): Promise<T> {
  await db.exec('set role service_role')
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
  }
}

const lookup = (username: string, ip: string | null = '1.2.3.4') =>
  asServer(() => value(db, 'select public.login_email($1, $2) as r', [username, ip]))
const fail = (username: string, ip: string | null = '1.2.3.4') =>
  asServer(() => db.query('select public.note_login_failure($1, $2)', [username, ip]))

describe('username sign-in', () => {
  test('the server finds the email for a username, any case, and nothing for strangers', async () => {
    expect(await lookup('alice')).toBe('alice@example.com')
    expect(await lookup('  ALICE ')).toBe('alice@example.com')
    expect(await lookup('nobody')).toBeNull()
    expect(await lookup('not a username!')).toBeNull()
  })

  test('nobody on the site can turn a username into an email', async () => {
    await expect(as(db, null, () => value(db, "select public.login_email('alice', null) as r"))).rejects.toThrow(/permission denied/)
    await expect(as(db, alice, () => value(db, "select public.login_email('alice', null) as r"))).rejects.toThrow(/permission denied/)
    await expect(as(db, null, () => db.query("select public.note_login_failure('alice', null)"))).rejects.toThrow(/permission denied/)
    await expect(as(db, null, () => rows(db, 'select * from public.login_failures'))).rejects.toThrow(/permission denied/)
  })

  test('5 wrong tries lock that username for 15 minutes; a good sign-in clears them', async () => {
    for (let i = 0; i < 4; i++) await fail('alice', `10.0.0.${i}`)
    expect(await lookup('alice')).toBe('alice@example.com')
    await asServer(() => db.query("select public.clear_login_failures('alice')"))
    for (let i = 0; i < 5; i++) await fail('alice', `10.0.0.${i}`)
    await expect(lookup('alice')).rejects.toThrow(/Too many tries/)

    // older than 15 minutes no longer counts
    await db.query("update public.login_failures set created_at = now() - interval '16 minutes'")
    expect(await lookup('alice')).toBe('alice@example.com')
  })

  test('20 wrong tries from one visitor lock that visitor out of every username', async () => {
    for (let i = 0; i < 20; i++) await fail(`guess${i}`, '9.9.9.9')
    await expect(lookup('alice', '9.9.9.9')).rejects.toThrow(/Too many tries/)
    expect(await lookup('alice', '8.8.8.8')).toBe('alice@example.com')
  })

  test('deleted customers cannot be found; addresses are forgotten after a day', async () => {
    await fail('alice')
    await db.query("update public.login_failures set created_at = now() - interval '2 days'")
    await fail('someone')
    expect(await value(db, 'select count(*)::int as r from public.login_failures')).toBe(1)

    await as(db, alice, () => db.query('select public.delete_my_data()'))
    expect(await lookup('alice')).toBeNull()
  })
})
