import { beforeEach, describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addCustomer, addLogin, as, book, createDatabase, manila, rows, setupShop, value, type Shop } from './helpers'

let db: PGlite
let shop: Shop
let alice: string
let bob: string

beforeEach(async () => {
  db = await createDatabase()
  shop = await setupShop(db)
  alice = await addCustomer(db, 'Alice Cruz', '09171234567')
  bob = await addCustomer(db, 'Bob Reyes', '09181234567')
})

async function slots(barber: string | null, days = 1, service = shop.haircut): Promise<string[]> {
  const found = await as(db, null, () =>
    rows(db, 'select starts_at::text as t from public.get_free_slots($1, $2, public.manila_today() + $3::int)', [service, barber, days]),
  )
  return found.map((r) => r.t)
}

describe('profile', () => {
  test('needs consent and a PH mobile, and cleans the number', async () => {
    const login = await addLogin(db)
    await expect(as(db, login, () => db.query("select public.save_my_profile('Carl Lim', '09191234567', false)"))).rejects.toThrow(/privacy notice/)
    await expect(as(db, login, () => db.query("select public.save_my_profile('Carl Lim', '12345', true)"))).rejects.toThrow(/09/)
    await as(db, login, () => db.query("select public.save_my_profile('Carl Lim', '+63 919 123 4567', true)"))
    expect(await value(db, 'select mobile as r from public.customers where auth_user_id = $1', [login])).toBe('09191234567')
  })

  test('must exist before booking', async () => {
    const login = await addLogin(db)
    await expect(book(db, login, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))).rejects.toThrow(/profile/)
  })
})

describe('booking', () => {
  test('a customer books a free slot and gets a code', async () => {
    const result = await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    expect(result.code).toMatch(/^[0-9A-F]{8}$/)
    expect(result.barber).toBe('Barber A')
    expect(result.price_centavos).toBe(25000)
  })

  test('the same barber and time cannot be booked twice', async () => {
    const time = await manila(db, 1, '10:00')
    await book(db, alice, shop.haircut, shop.chairA, time)
    await expect(book(db, bob, shop.haircut, shop.chairA, time)).rejects.toThrow(/no longer free/)
    // an overlapping start (10:15 inside 10:00-10:30) is refused too
    await expect(book(db, bob, shop.haircut, shop.chairA, await manila(db, 1, '10:15'))).rejects.toThrow(/no longer free/)
  })

  test('the database itself refuses an overlap, even without the functions', async () => {
    const customer = await value(db, 'select id as r from public.customers limit 1')
    const insert = (start: string) =>
      db.query(
        `insert into public.appointments (customer_id, service_id, barber_id, starts_at, ends_at, source, price_centavos)
         values ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '30 minutes', 'online', 25000)`,
        [customer, shop.haircut, shop.chairA, start],
      )
    await insert(await manila(db, 1, '10:00'))
    await expect(insert(await manila(db, 1, '10:20'))).rejects.toThrow(/appointments_no_overlap/)
    // back to back is fine: 10:30 starts when 10:00-10:30 ends
    await insert(await manila(db, 1, '10:30'))
  })

  test('"any barber" gets the free one', async () => {
    const time = await manila(db, 1, '10:00')
    await book(db, alice, shop.haircut, shop.chairA, time)
    const result = await book(db, bob, shop.haircut, null, time)
    expect(result.barber).toBe('Barber B')
  })

  test('a taken time disappears from the slot list', async () => {
    const time = await manila(db, 1, '10:00')
    expect(await slots(shop.chairA)).toContain(time)
    await book(db, alice, shop.haircut, shop.chairA, time)
    expect(await slots(shop.chairA)).not.toContain(time)
    // still offered for "any barber" because Barber B is free
    expect(await slots(null)).toContain(time)
  })

  test('the last slot ends at closing time', async () => {
    const list = await slots(shop.chairA)
    expect(list.at(0)).toBe(await manila(db, 1, '09:00'))
    expect(list.at(-1)).toBe(await manila(db, 1, '19:30'))
    await expect(book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '19:45'))).rejects.toThrow(/no longer free/)
  })

  test('breaks, time off and closures are respected', async () => {
    const dow = await value(db, 'select extract(dow from public.manila_today() + 1)::int as r')
    await db.query("insert into public.barber_breaks (barber_id, weekday, starts_at, ends_at) values ($1, $2, '12:00', '13:00')", [shop.chairA, dow])
    expect(await slots(shop.chairA)).not.toContain(await manila(db, 1, '12:00'))
    expect(await slots(shop.chairA)).not.toContain(await manila(db, 1, '11:45')) // would run into the break

    await db.query('insert into public.barber_time_off (barber_id, starts_at, ends_at) values ($1, $2, $3)', [
      shop.chairB, await manila(db, 1, '00:00'), await manila(db, 2, '00:00'),
    ])
    expect(await slots(shop.chairB)).toEqual([])

    await db.query("insert into public.shop_closures (closed_on, reason) values (public.manila_today() + 1, 'Holiday')")
    expect(await slots(null)).toEqual([])
  })

  test('no bookings in the past, too soon, or too far ahead', async () => {
    expect(await slots(null, -1)).toEqual([])
    expect(await slots(null, 15)).toEqual([])
    // today: nothing earlier than the 60-minute notice
    const today = await slots(null, 0)
    const soonest = await value(db, "select (now() + interval '60 minutes') as r")
    expect(today.every((t) => new Date(t) >= soonest)).toBe(true)
  })

  test('one account cannot fill the day', async () => {
    await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '11:00'))
    await expect(book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '12:00'))).rejects.toThrow(/upcoming bookings/)
  })

  test('the price comes from the services table', async () => {
    const result = await book(db, alice, shop.shave, shop.chairA, await manila(db, 1, '10:00'))
    expect(result.price_centavos).toBe(15000)
  })
})

describe('cancel and reschedule', () => {
  test('a customer asks to cancel; the seat opens once the desk agrees', async () => {
    const time = await manila(db, 1, '10:00')
    const booking = await book(db, alice, shop.haircut, shop.chairA, time)
    await as(db, alice, () => db.query('select public.cancel_my_booking($1)', [booking.id]))
    // still held while the shop decides
    expect(await slots(shop.chairA)).not.toContain(time)
    await as(db, shop.desk, () => db.query('select public.approve_cancel($1)', [booking.id]))
    expect(await slots(shop.chairA)).toContain(time)
  })

  test('cannot cancel someone else\'s booking', async () => {
    const booking = await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    await expect(as(db, bob, () => db.query('select public.cancel_my_booking($1)', [booking.id]))).rejects.toThrow(/not found/)
  })

  test('cannot cancel online inside the cut-off', async () => {
    await db.query('update public.settings set cancel_cutoff_minutes = 2880') // 2 days
    const booking = await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    await expect(as(db, alice, () => db.query('select public.cancel_my_booking($1)', [booking.id]))).rejects.toThrow(/too close/)
  })

  test('reschedule moves the booking; a failed move changes nothing', async () => {
    const booking = await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    await book(db, bob, shop.haircut, shop.chairA, await manila(db, 1, '14:00'))

    await expect(
      as(db, alice, async () => db.query('select public.reschedule_my_booking($1, $2, $3)', [booking.id, shop.chairA, await manila(db, 1, '14:00')])),
    ).rejects.toThrow(/no longer free/)
    expect(await value(db, 'select status as r from public.appointments where id = $1', [booking.id])).toBe('booked')

    const moved = await as(db, alice, async () =>
      value(db, 'select public.reschedule_my_booking($1, $2, $3) as r', [booking.id, shop.chairA, await manila(db, 1, '15:00')]),
    )
    expect(moved.starts_at).toBeTruthy()
    // the confirmed booking stands until the desk confirms the new time
    expect(await value(db, 'select status as r from public.appointments where id = $1', [booking.id])).toBe('booked')
    await as(db, shop.desk, () => db.query('select public.confirm_booking($1)', [moved.id]))
    expect(await value(db, 'select status as r from public.appointments where id = $1', [booking.id])).toBe('cancelled')
  })
})

describe('delete my data', () => {
  test('wipes name and number and cancels upcoming bookings', async () => {
    const booking = await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    await as(db, alice, () => db.query('select public.delete_my_data()'))
    const customer = (await rows(db, 'select c.* from public.customers c join public.appointments a on a.customer_id = c.id where a.id = $1', [booking.id]))[0]
    expect(customer.full_name).toBe('Deleted customer')
    expect(customer.mobile).toBeNull()
    expect(customer.auth_user_id).toBeNull()
    expect(await value(db, 'select status as r from public.appointments where id = $1', [booking.id])).toBe('cancelled')
    // the login can no longer book as that customer
    await expect(book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '11:00'))).rejects.toThrow(/profile/)
  })
})

describe('queue', () => {
  test('desk books a phone customer for later today without the online notice', async () => {
    // open all day, and online needs a full day's notice, so online gets nothing today
    await db.exec(`
      update public.shop_hours set opens_at = '00:00', closes_at = '23:59';
      update public.barber_hours set starts_at = '00:00', ends_at = '23:59';
      update public.settings set min_notice_minutes = 1440;
    `)
    const desk = await as(db, shop.desk, () =>
      rows(db, 'select starts_at::text as t from public.desk_free_slots($1, null, $2, public.manila_today())', [shop.shave, shop.chairA]),
    )
    expect(await slots(shop.chairA, 0, shop.shave)).toEqual([])
    // the desk still sees the rest of today (empty only in the last minutes before midnight)
    if (desk.length > 0) {
      const result = await as(db, shop.desk, () =>
        value(db, "select public.desk_book('Dan Cruz', $1, $2, $3) as r", [shop.shave, shop.chairA, desk[0].t]),
      )
      expect(result.code).toBeTruthy()
    }
  })

  test('walk-in: waits, then a barber takes them and their time starts now', async () => {
    const walkIn = await as(db, shop.desk, () => value(db, "select public.add_walk_in('Eve Tan', $1, null) as r", [shop.haircut]))
    expect(walkIn.barber).toBeNull()

    // barber B can take a waiting walk-in with no barber
    await as(db, shop.barberB, () => db.query('select public.start_service($1, null)', [walkIn.id]))
    const row = (await rows(db, 'select * from public.appointments where id = $1', [walkIn.id]))[0]
    expect(row.status).toBe('in_chair')
    expect(row.barber_id).toBe(shop.chairB)
    expect(row.starts_at).toBeTruthy()
  })

  test('a walk-in cannot be put in a chair that has a booking coming up', async () => {
    // a booking 10 minutes from now for barber A, put in directly
    await db.query(
      `insert into public.appointments (guest_name, service_id, barber_id, starts_at, ends_at, source, price_centavos)
       values ('Booked Guy', $1, $2, now() + interval '10 minutes', now() + interval '40 minutes', 'desk', 25000)`,
      [shop.haircut, shop.chairA],
    )
    const walkIn = await as(db, shop.desk, () => value(db, "select public.add_walk_in('Eve Tan', $1, null) as r", [shop.haircut]))
    await expect(as(db, shop.desk, () => db.query('select public.start_service($1, $2)', [walkIn.id, shop.chairA]))).rejects.toThrow(/booking coming up/)
    await as(db, shop.desk, () => db.query('select public.start_service($1, $2)', [walkIn.id, shop.chairB]))
  })

  test('a barber cannot start someone on another barber\'s chair', async () => {
    const walkIn = await as(db, shop.desk, () => value(db, "select public.add_walk_in('Eve Tan', $1, $2) as r", [shop.haircut, shop.chairA]))
    await expect(as(db, shop.barberB, () => db.query('select public.start_service($1, null)', [walkIn.id]))).rejects.toThrow(/Not allowed/)
  })

  test('check-in works only on the day; no-show only after the time', async () => {
    const tomorrow = await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    await expect(as(db, shop.desk, () => db.query('select public.check_in($1)', [tomorrow.id]))).rejects.toThrow(/another day/)
    await expect(as(db, shop.desk, () => db.query('select public.mark_no_show($1)', [tomorrow.id]))).rejects.toThrow(/not their time/)
  })

  test('a waiting walk-in who leaves can be cancelled', async () => {
    const walkIn = await as(db, shop.desk, () => value(db, "select public.add_walk_in('Eve Tan', $1, null) as r", [shop.haircut]))
    await as(db, shop.desk, () => db.query("select public.cancel_appointment($1, 'Left before their turn')", [walkIn.id]))
    expect(await value(db, 'select status as r from public.appointments where id = $1', [walkIn.id])).toBe('cancelled')
  })
})
