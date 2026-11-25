import { beforeAll, describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addCustomer, addLogin, as, book, createDatabase, manila, rows, setupShop, value, walkInInChair, type Shop } from './helpers'

let db: PGlite
let shop: Shop
let alice: string
let bob: string

beforeAll(async () => {
  db = await createDatabase()
  shop = await setupShop(db)
  alice = await addCustomer(db, 'Alice Cruz', '09171234567')
  bob = await addCustomer(db, 'Bob Reyes', '09181234567')
  await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
  await book(db, bob, shop.haircut, shop.chairB, await manila(db, 1, '10:00'))

  // one sale by the owner and one by the desk, so there is money to hide
  const a1 = await walkInInChair(db, shop, shop.chairA)
  await as(db, shop.owner, () =>
    db.query(`select public.record_sale($1, $2, '[{"method":"cash","amount_centavos":25000}]')`, [
      a1, JSON.stringify([{ service_id: shop.haircut, barber_id: shop.chairA }]),
    ]),
  )
  const a2 = await walkInInChair(db, shop, shop.chairB)
  await as(db, shop.desk, () =>
    db.query(`select public.record_sale($1, $2, '[{"method":"cash","amount_centavos":25000}]')`, [
      a2, JSON.stringify([{ service_id: shop.haircut, barber_id: shop.chairB }]),
    ]),
  )
  await as(db, shop.owner, () => db.query("select public.add_expense('Rent', 500000, public.manila_today())"))
})

describe('signed-out visitors', () => {
  test('can only touch the public menu tables', async () => {
    const open = await rows(db, `
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v')
        and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('anon', c.oid, 'insert')
          or has_table_privilege('anon', c.oid, 'update') or has_table_privilege('anon', c.oid, 'delete'))
      order by 1`)
    expect(open.map((r) => r.relname)).toEqual(['barbers', 'services'])
  })

  test('can only call the public functions', async () => {
    const callable = await rows(db, `
      select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
      order by 1`)
    expect(callable.map((r) => r.proname)).toEqual([
      'barber_ratings', 'barber_reviews', 'booking_rules', 'get_free_slots', 'manila_at', 'manila_date', 'manila_today',
      'public_shop_hours', 'username_available',
    ])
  })

  test('every table has row-level security on', async () => {
    const off = await rows(db, `
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)
    expect(off).toEqual([])
  })

  // found on the live project: the rule called is_staff(), which visitors may not run
  test('can actually read active services and barbers, and nothing inactive', async () => {
    await db.query("insert into public.services (name, duration_minutes, price_centavos, active) values ('Old service', 30, 10000, false)")
    const services = await as(db, null, () => rows(db, 'select name from public.services order by name'))
    expect(services.map((r) => r.name)).toEqual(['Haircut', 'Shave'])
    const barbers = await as(db, null, () => rows(db, 'select display_name from public.barbers order by sort'))
    expect(barbers.map((r) => r.display_name)).toEqual(['Barber A', 'Barber B'])
    // signed-in customers too
    expect((await as(db, alice, () => rows(db, 'select id from public.services'))).length).toBe(2)
    // staff still see the inactive one
    expect((await as(db, shop.owner, () => rows(db, 'select id from public.services'))).length).toBe(3)
  })

  test('see free times but no names or numbers', async () => {
    const slots = await as(db, null, () =>
      rows(db, 'select * from public.get_free_slots($1, null, public.manila_today() + 1)', [shop.haircut]),
    )
    expect(slots.length).toBeGreaterThan(0)
    expect(Object.keys(slots[0])).toEqual(['starts_at'])
  })

  test('cannot book or read appointments', async () => {
    await expect(as(db, null, () => db.query('select * from public.appointments'))).rejects.toThrow(/permission denied/)
    await expect(
      as(db, null, async () => db.query('select public.book_appointment($1, null, now())', [shop.haircut])),
    ).rejects.toThrow(/permission denied/)
  })
})

describe('customers', () => {
  test('see only their own bookings', async () => {
    const seen = await as(db, alice, () => rows(db, 'select customer_id from public.appointments'))
    const mine = await as(db, alice, () => value(db, 'select public.my_customer_id() as r'))
    expect(seen.length).toBe(1)
    expect(seen.every((r) => r.customer_id === mine)).toBe(true)

    const listed = await as(db, alice, () => value(db, 'select public.my_bookings() as r'))
    expect(listed.length).toBe(1)
  })

  test('see only their own profile', async () => {
    const people = await as(db, alice, () => rows(db, 'select full_name from public.customers'))
    expect(people.map((r) => r.full_name)).toEqual(['Alice Cruz'])
  })

  test('cannot use shop functions or read money', async () => {
    await expect(as(db, alice, () => db.query('select * from public.queue_for_day(public.manila_today())'))).rejects.toThrow(/Not allowed/)
    await expect(as(db, alice, () => db.query("select public.add_walk_in('X Y', $1, null)", [shop.haircut]))).rejects.toThrow(/Not allowed/)
    expect(await as(db, alice, () => rows(db, 'select * from public.sales'))).toEqual([])
    expect(await as(db, alice, () => rows(db, 'select * from public.barber_pay'))).toEqual([])
  })

  test('cannot write to tables directly', async () => {
    // row-level security makes the update match zero rows
    const result = await as(db, alice, () => db.query('update public.services set price_centavos = 1'))
    expect(result.affectedRows).toBe(0)
    const price = await value(db, 'select price_centavos as r from public.services where id = $1', [shop.haircut])
    expect(price).toBe(25000)
    await expect(
      as(db, alice, () => db.query("insert into public.appointments (guest_name, service_id, source, price_centavos) values ('X Y', $1, 'online', 1)", [shop.haircut])),
    ).rejects.toThrow(/permission denied/)
  })

  test('a fresh sign-up has no shop powers', async () => {
    const stranger = await addLogin(db)
    expect(await as(db, stranger, () => value(db, 'select public.is_staff() as r'))).toBe(false)
    expect(await as(db, stranger, () => rows(db, 'select * from public.staff'))).toEqual([])
  })
})

describe('desk', () => {
  test('cannot see expenses, pay, day closes or the audit log', async () => {
    for (const table of ['expenses', 'barber_pay', 'day_closes', 'audit_log', 'stock_movements', 'settings']) {
      expect(await as(db, shop.desk, () => rows(db, `select * from public.${table}`))).toEqual([])
    }
  })

  test('sees only the sales they recorded today', async () => {
    const sales = await as(db, shop.desk, () => rows(db, 'select recorded_by from public.sales'))
    expect(sales.length).toBe(1)
    expect(sales[0].recorded_by).toBe(shop.desk)
  })

  test('cannot void a sale or change prices', async () => {
    const sale = await value(db, 'select id as r from public.sales limit 1')
    await expect(as(db, shop.desk, () => db.query("select public.void_sale($1, 'oops')", [sale]))).rejects.toThrow(/Not allowed/)
    await as(db, shop.desk, () => db.query('update public.services set price_centavos = 1'))
    expect(await value(db, 'select price_centavos as r from public.services where id = $1', [shop.haircut])).toBe(25000)
  })

  test('sees every customer and number in the queue', async () => {
    const queue = await as(db, shop.desk, () => rows(db, 'select * from public.queue_for_day(public.manila_today() + 1)'))
    expect(queue.length).toBe(2)
    expect(queue.every((r) => r.customer_mobile)).toBe(true)
  })
})

describe('barbers', () => {
  test('see only their own chair, with no phone numbers', async () => {
    const queue = await as(db, shop.barberA, () => rows(db, 'select * from public.queue_for_day(public.manila_today() + 1)'))
    expect(queue.length).toBe(1)
    expect(queue[0].barber_id).toBe(shop.chairA)
    expect(queue[0].customer_mobile).toBeNull()
  })

  test('cannot read the customer list', async () => {
    expect(await as(db, shop.barberA, () => rows(db, 'select * from public.customers'))).toEqual([])
  })

  test('see their own earnings only', async () => {
    const mine = await as(db, shop.barberA, () =>
      value(db, 'select public.my_earnings(public.manila_today(), public.manila_today()) as r'),
    )
    expect(mine.services_centavos).toBe(25000)
    expect(mine.services_count).toBe(1)
    await expect(
      as(db, shop.desk, () => db.query('select public.my_earnings(public.manila_today(), public.manila_today())')),
    ).rejects.toThrow(/Not allowed/)
  })
})

describe('two-step sign-in', () => {
  test('an owner with an authenticator app needs the code before any owner power', async () => {
    const owner2 = await addLogin(db)
    await db.query("insert into public.staff (id, full_name, role) values ($1, 'Second Owner', 'owner')", [owner2])
    await db.query("insert into auth.mfa_factors (user_id, status) values ($1, 'verified')", [owner2])

    expect(await as(db, owner2, () => value(db, 'select public.is_owner() as r'), 'aal1')).toBe(false)
    expect(await as(db, owner2, () => rows(db, 'select * from public.expenses'), 'aal1')).toEqual([])
    expect(await as(db, owner2, () => value(db, 'select public.is_owner() as r'), 'aal2')).toBe(true)
  })
})
