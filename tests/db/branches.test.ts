import { beforeEach, describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addCustomer, addLogin, as, createDatabase, manila, request, rows, setupShop, value, type Shop } from './helpers'

let db: PGlite
let shop: Shop
let north: string // a second branch, open 12 PM to 8 PM
let chairC: string // its only barber
let deskNorth: string
let alice: string

beforeEach(async () => {
  db = await createDatabase()
  shop = await setupShop(db)
  north = await value(db, "insert into public.branches (name, address, sort) values ('North (test)', '1 Sample St, Test City', 2) returning id as r")
  chairC = await value(db, "insert into public.barbers (display_name, sort, branch_id) values ('Barber C', 3, $1) returning id as r", [north])
  await db.query("insert into public.shop_hours (branch_id, weekday, opens_at, closes_at) select $1, d, '12:00', '20:00' from generate_series(0, 6) d", [north])
  await db.query("insert into public.barber_hours (barber_id, weekday, starts_at, ends_at) select $1, d, '12:00', '20:00' from generate_series(0, 6) d", [chairC])
  deskNorth = await addLogin(db)
  await db.query("insert into public.staff (id, full_name, role, branch_id) values ($1, 'Desk North', 'desk', $2)", [deskNorth, north])
  alice = await addCustomer(db, 'Alice Cruz', '09171234567')
})

const slots = (branch: string | null, barber: string | null) =>
  as(db, null, () =>
    rows(db, 'select starts_at::text as t from public.get_free_slots($1, $2, $3, public.manila_today() + 1)', [shop.haircut, branch, barber]),
  )

describe('branches for visitors', () => {
  test('anyone sees the open branches, not closed ones', async () => {
    await db.query("insert into public.branches (name, active) values ('Old branch', false)")
    const list = await as(db, null, () => rows(db, 'select name from public.branches order by sort, name'))
    expect(list.map((r) => r.name)).toEqual(['Main branch', 'North (test)'])
  })

  test('opening hours come per branch', async () => {
    const hours = await as(db, null, () => rows(db, 'select * from public.public_shop_hours() where weekday = 1'))
    expect(hours).toHaveLength(2)
    const northMonday = hours.find((h) => h.branch_id === north)!
    expect(northMonday.opens_at).toBe('12:00:00')
  })

  test("free times follow the branch's own hours and barbers", async () => {
    const northTimes = await slots(north, null)
    const mainTimes = await slots(shop.branch, null)
    expect(northTimes.length).toBeGreaterThan(0)
    // North opens at noon; Main at 9
    expect(northTimes[0]!.t).toBe(await manila(db, 1, '12:00'))
    expect(mainTimes[0]!.t).toBe(await manila(db, 1, '09:00'))
    // a Main barber asked for at North: nothing
    expect(await slots(north, shop.chairA)).toEqual([])
  })

  test('a closed day can close one branch, or all of them', async () => {
    await db.query('insert into public.shop_closures (branch_id, closed_on, reason) values ($1, public.manila_today() + 1, $2)', [north, 'Repairs'])
    expect(await slots(north, null)).toEqual([])
    expect((await slots(shop.branch, null)).length).toBeGreaterThan(0)

    await db.query("insert into public.shop_closures (branch_id, closed_on, reason) values (null, public.manila_today() + 1, 'Holiday')")
    expect(await slots(shop.branch, null)).toEqual([])
  })
})

describe('booking at a branch', () => {
  const ask = (branch: string | null, barber: string | null, time: string) =>
    as(db, alice, () => value(db, 'select public.book_appointment($1, $2, $3, $4) as r', [shop.haircut, branch, barber, time]))

  test('"any barber" at a branch only ever picks a barber from that branch', async () => {
    const booking = await ask(north, null, await manila(db, 1, '13:00'))
    expect(booking.barber_id).toBe(chairC)
    expect(booking.branch_id).toBe(north)
    expect(booking.branch).toBe('North (test)')
  })

  test('a barber from another branch is refused', async () => {
    await expect(ask(north, shop.chairA, await manila(db, 1, '13:00'))).rejects.toThrow(/another location/)
  })

  test('with two branches, "any barber" needs a location', async () => {
    await expect(ask(null, null, await manila(db, 1, '13:00'))).rejects.toThrow(/Pick a location/)
    // a chosen barber tells us the branch
    const booking = await ask(null, chairC, await manila(db, 1, '14:00'))
    expect(booking.branch_id).toBe(north)
  })

  test('moving a booking keeps it at the same branch', async () => {
    const booking = await ask(north, null, await manila(db, 1, '13:00'))
    await expect(
      as(db, alice, async () => db.query('select public.reschedule_my_booking($1, $2, $3)', [booking.id, shop.chairA, await manila(db, 1, '10:00')])),
    ).rejects.toThrow(/another location/)
    const moved = await as(db, alice, async () =>
      value(db, 'select public.reschedule_my_booking($1, null, $2) as r', [booking.id, await manila(db, 1, '15:00')]),
    )
    expect(moved.branch_id).toBe(north)
  })

  test('the database fills in the branch from the barber, and refuses a mismatch', async () => {
    const start = await manila(db, 1, '13:00')
    const id = await value(
      db,
      `insert into public.appointments (guest_name, service_id, barber_id, starts_at, ends_at, source, price_centavos)
       values ('X Y', $1, $2, $3::timestamptz, $3::timestamptz + interval '30 minutes', 'desk', 1) returning id as r`,
      [shop.haircut, chairC, start],
    )
    expect(await value(db, 'select branch_id as r from public.appointments where id = $1', [id])).toBe(north)
    await expect(db.query('update public.appointments set branch_id = $1 where id = $2', [shop.branch, id])).rejects.toThrow(/another location/)
  })
})

describe('the desk works one branch, the owner all', () => {
  beforeEach(async () => {
    await request(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    await request(db, alice, shop.haircut, chairC, await manila(db, 2, '13:00'))
  })

  const requestsFor = async (login: string) => (await as(db, login, () => value(db, 'select public.booking_requests() as r'))) as { branch: string; id: string }[]

  test('each desk sees only its own branch; the owner sees both', async () => {
    expect((await requestsFor(shop.desk)).map((r) => r.branch)).toEqual(['Main branch'])
    expect((await requestsFor(deskNorth)).map((r) => r.branch)).toEqual(['North (test)'])
    expect(await requestsFor(shop.owner)).toHaveLength(2)
  })

  test("a desk can't confirm another branch's request", async () => {
    const northRequest = (await requestsFor(deskNorth))[0]!
    await expect(as(db, shop.desk, () => db.query('select public.confirm_booking($1)', [northRequest.id]))).rejects.toThrow(/Not allowed/)
    await as(db, deskNorth, () => db.query('select public.confirm_booking($1)', [northRequest.id]))
    // the owner can answer any branch
    const mainRequest = (await requestsFor(shop.owner))[0]!
    await as(db, shop.owner, () => db.query('select public.confirm_booking($1)', [mainRequest.id]))
  })

  test("a desk's queue, phone bookings and walk-ins stay in its branch", async () => {
    const queue = await as(db, deskNorth, () => rows(db, 'select branch_id from public.queue_for_day(public.manila_today() + 2)'))
    expect(queue.every((r) => r.branch_id === north)).toBe(true)
    expect(queue).toHaveLength(1)

    const walkIn = await as(db, deskNorth, () => value(db, "select public.add_walk_in('Walk In', $1, null) as r", [shop.haircut]))
    expect(walkIn.branch_id).toBe(north)
    // a Main barber from the North desk: refused
    await expect(
      as(db, deskNorth, async () => db.query("select public.desk_book('Caller', $1, $2, $3)", [shop.haircut, shop.chairA, await manila(db, 1, '15:00')])),
    ).rejects.toThrow(/Not allowed|another location/)
  })

  test("a desk can't open another branch's inspo", async () => {
    const mainRequest = (await requestsFor(shop.desk))[0]!
    await as(db, alice, () => db.query('select public.add_booking_inspo($1, $2, $3)', [mainRequest.id, `${alice}/a.webp`, 'image']))
    expect(await as(db, shop.desk, () => value(db, 'select jsonb_array_length(public.booking_inspo($1)) as r', [mainRequest.id]))).toBe(1)
    expect(await as(db, deskNorth, () => value(db, 'select jsonb_array_length(public.booking_inspo($1)) as r', [mainRequest.id]))).toBe(0)
  })

  test('a desk person must belong to a branch', async () => {
    const login = await addLogin(db)
    await expect(db.query("insert into public.staff (id, full_name, role) values ($1, 'No Branch', 'desk')", [login])).rejects.toThrow(/staff_desk_needs_branch/)
  })
})
