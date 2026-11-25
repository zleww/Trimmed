import { beforeEach, describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addCustomer, as, createDatabase, manila, request, rows, setupShop, value, type Shop } from './helpers'

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

const status = (id: string) => value(db, 'select status as r from public.appointments where id = $1', [id])

describe('online bookings are requests', () => {
  test('a customer booking waits as "requested"', async () => {
    const asked = await request(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    expect(asked.status).toBe('requested')
    expect(await status(asked.id)).toBe('requested')
  })

  test('a waiting request holds the time: nobody else can ask for it', async () => {
    const time = await manila(db, 1, '10:00')
    await request(db, alice, shop.haircut, shop.chairA, time)
    const free = await as(db, null, () =>
      rows(db, 'select starts_at::text as t from public.get_free_slots($1, $2, public.manila_today() + 1)', [shop.haircut, shop.chairA]),
    )
    expect(free.map((r) => r.t)).not.toContain(time)
    await expect(request(db, bob, shop.haircut, shop.chairA, time)).rejects.toThrow(/no longer free/)
  })

  test('the desk books phone customers straight in, no request', async () => {
    const booked = await as(db, shop.desk, async () =>
      value(db, "select public.desk_book('Caller Name', $1, $2, $3) as r", [shop.haircut, shop.chairA, await manila(db, 1, '15:00')]),
    )
    expect(booked.status).toBe('booked')
  })

  test('waiting requests count toward the upcoming limit', async () => {
    await request(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    await request(db, alice, shop.haircut, shop.chairA, await manila(db, 2, '10:00'))
    await expect(request(db, alice, shop.haircut, shop.chairA, await manila(db, 3, '10:00'))).rejects.toThrow(/upcoming bookings/)
  })

  test('a request cannot be checked in before the shop confirms it', async () => {
    const asked = await request(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    await expect(as(db, shop.desk, () => db.query('select public.check_in($1)', [asked.id]))).rejects.toThrow(/Only a booked/)
  })
})

describe('the shop answers requests', () => {
  test('the desk and owner see waiting requests with name, number and history; barbers and customers cannot', async () => {
    await request(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    const list = await as(db, shop.desk, () => value(db, 'select public.booking_requests() as r'))
    expect(list).toHaveLength(1)
    expect(list[0].customer).toBe('Alice Cruz')
    expect(list[0].mobile).toBe('09171234567')
    expect(list[0].no_shows).toBe(0)
    expect(await as(db, shop.owner, () => value(db, 'select jsonb_array_length(public.booking_requests()) as r'))).toBe(1)

    await expect(as(db, shop.barberA, () => db.query('select public.booking_requests()'))).rejects.toThrow(/Not allowed/)
    await expect(as(db, alice, () => db.query('select public.booking_requests()'))).rejects.toThrow(/Not allowed/)
    await expect(as(db, null, () => db.query('select public.booking_requests()'))).rejects.toThrow(/permission denied/)
  })

  test('confirming makes it a booking, once', async () => {
    const asked = await request(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    const confirmed = await as(db, shop.desk, () => value(db, 'select public.confirm_booking($1) as r', [asked.id]))
    expect(confirmed.status).toBe('booked')
    expect(await value(db, 'select confirmed_by as r from public.appointments where id = $1', [asked.id])).toBe(shop.desk)
    await expect(as(db, shop.desk, () => db.query('select public.confirm_booking($1)', [asked.id]))).rejects.toThrow(/already answered/)
    // the customer sees it confirmed
    const mine = await as(db, alice, () => value(db, 'select public.my_bookings() as r'))
    expect(mine[0].status).toBe('booked')
  })

  test('declining needs a reason, frees the time, and the customer sees why', async () => {
    const time = await manila(db, 1, '10:00')
    const asked = await request(db, alice, shop.haircut, shop.chairA, time)
    await expect(as(db, shop.desk, () => db.query("select public.decline_booking($1, '')", [asked.id]))).rejects.toThrow(/short reason/)

    await as(db, shop.desk, () => db.query("select public.decline_booking($1, 'Barber A is out sick that day')", [asked.id]))
    expect(await status(asked.id)).toBe('declined')
    const mine = await as(db, alice, () => value(db, 'select public.my_bookings() as r'))
    expect(mine[0].reason).toBe('Barber A is out sick that day')
    // someone else can have the time now
    expect((await request(db, bob, shop.haircut, shop.chairA, time)).status).toBe('requested')
  })

  test('barbers and customers cannot confirm or decline', async () => {
    const asked = await request(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    await expect(as(db, shop.barberA, () => db.query('select public.confirm_booking($1)', [asked.id]))).rejects.toThrow(/Not allowed/)
    await expect(as(db, alice, () => db.query('select public.confirm_booking($1)', [asked.id]))).rejects.toThrow(/Not allowed/)
    await expect(as(db, bob, () => db.query("select public.decline_booking($1, 'nope')", [asked.id]))).rejects.toThrow(/Not allowed/)
    expect(await status(asked.id)).toBe('requested')
  })

  test('a request whose time has passed cannot be confirmed and leaves the list', async () => {
    const asked = await request(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    await db.query("update public.appointments set starts_at = now() - interval '1 hour', ends_at = now() - interval '30 minutes' where id = $1", [asked.id])
    await expect(as(db, shop.desk, () => db.query('select public.confirm_booking($1)', [asked.id]))).rejects.toThrow(/expired/)
    expect(await as(db, shop.desk, () => value(db, 'select jsonb_array_length(public.booking_requests()) as r'))).toBe(0)
  })
})

describe('customers and their requests', () => {
  test('a waiting request can be cancelled even inside the cut-off', async () => {
    // the cut-off is 2 hours; move the request to 70 minutes from now
    const asked = await request(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    await db.query("update public.appointments set starts_at = now() + interval '70 minutes', ends_at = now() + interval '100 minutes' where id = $1", [asked.id])
    const cancelled = await as(db, alice, () => value(db, 'select public.cancel_my_booking($1) as r', [asked.id]))
    expect(cancelled.status).toBe('cancelled')
  })

  test('a declined request cannot be changed again', async () => {
    const asked = await request(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    await as(db, shop.desk, () => db.query("select public.decline_booking($1, 'Fully booked')", [asked.id]))
    await expect(as(db, alice, () => db.query('select public.cancel_my_booking($1)', [asked.id]))).rejects.toThrow(/no longer be changed/)
  })

  test('inspo can be added while the request waits', async () => {
    const asked = await request(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    const added = await as(db, alice, () => value(db, 'select public.add_booking_inspo($1, $2, $3) as r', [asked.id, `${alice}/a.webp`, 'image']))
    expect(added.kind).toBe('image')
  })
})
