import { beforeEach, describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addCustomer, as, book, createDatabase, manila, request, setupShop, value, type Shop } from './helpers'

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
const cancel = (login: string, id: string) => as(db, login, () => value(db, 'select public.cancel_my_booking($1) as r', [id]))
const move = (login: string, id: string, barber: string | null, at: string) =>
  as(db, login, () => value(db, 'select public.reschedule_my_booking($1, $2, $3) as r', [id, barber, at]))
const deskList = (login = shop.desk) => as(db, login, () => value(db, 'select public.booking_requests() as r'))

describe('cancelling', () => {
  test('a request the shop has not confirmed is cancelled at once', async () => {
    const asked = await request(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    const result = await cancel(alice, asked.id)
    expect(result.status).toBe('cancelled')
  })

  test('a confirmed booking becomes a cancel request the desk sees', async () => {
    const booking = await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    const result = await cancel(alice, booking.id)
    expect(result).toMatchObject({ status: 'booked', cancel_requested: true })

    const list = await deskList()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: booking.id, kind: 'cancel', customer: 'Alice Cruz' })

    // asking twice is refused politely
    await expect(cancel(alice, booking.id)).rejects.toThrow(/already asked/)
  })

  test('the desk agrees: the booking is cancelled', async () => {
    const booking = await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    await cancel(alice, booking.id)
    const result = await as(db, shop.desk, () => value(db, 'select public.approve_cancel($1) as r', [booking.id]))
    expect(result.status).toBe('cancelled')
    expect(await deskList()).toHaveLength(0)
  })

  test('the desk keeps it: the customer sees the reason, and can ask again later', async () => {
    const booking = await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    await cancel(alice, booking.id)
    await expect(as(db, shop.desk, () => db.query('select public.refuse_cancel($1, $2)', [booking.id, 'x']))).rejects.toThrow(/short reason/)
    const kept = await as(db, shop.desk, () => value(db, 'select public.refuse_cancel($1, $2) as r', [booking.id, 'Please call us to talk it over.']))
    expect(kept).toMatchObject({ status: 'booked', cancel_requested: false, cancel_answer: 'Please call us to talk it over.' })

    const mine = await as(db, alice, () => value(db, 'select public.my_bookings() as r'))
    expect(mine[0]).toMatchObject({ cancel_answer: 'Please call us to talk it over.' })

    const again = await cancel(alice, booking.id)
    expect(again).toMatchObject({ cancel_requested: true, cancel_answer: null })
  })

  test('the customer can take the cancel request back', async () => {
    const booking = await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    await cancel(alice, booking.id)
    const kept = await as(db, alice, () => value(db, 'select public.keep_my_booking($1) as r', [booking.id]))
    expect(kept).toMatchObject({ status: 'booked', cancel_requested: false })
    expect(await deskList()).toHaveLength(0)
    await expect(as(db, alice, () => db.query('select public.keep_my_booking($1)', [booking.id]))).rejects.toThrow(/no cancel request/)
    await expect(as(db, bob, () => db.query('select public.keep_my_booking($1)', [booking.id]))).rejects.toThrow(/not found/)
  })

  test('only the desk of that branch or the owner can answer, never the customer or a barber', async () => {
    const booking = await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    await cancel(alice, booking.id)
    await expect(as(db, alice, () => db.query('select public.approve_cancel($1)', [booking.id]))).rejects.toThrow(/permission denied|Not allowed/)
    await expect(as(db, shop.barberA, () => db.query('select public.approve_cancel($1)', [booking.id]))).rejects.toThrow(/Not allowed/)

    const other = await value(db, "insert into public.branches (name, sort) values ('Branch Two', 2) returning id as r")
    await db.query('update public.staff set branch_id = $1 where id = $2', [other, shop.desk])
    await expect(as(db, shop.desk, () => db.query('select public.approve_cancel($1)', [booking.id]))).rejects.toThrow(/Not allowed/)
    expect(await deskList()).toHaveLength(0)

    const result = await as(db, shop.owner, () => value(db, 'select public.approve_cancel($1) as r', [booking.id]), 'aal2')
    expect(result.status).toBe('cancelled')
  })
})

describe('moving', () => {
  test('moving a confirmed booking keeps it until the desk confirms the new time', async () => {
    const booking = await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    const later = await manila(db, 1, '15:00')
    const asked = await move(alice, booking.id, shop.chairA, later)
    expect(asked.status).toBe('requested')
    expect(asked.replaces_starts_at).toBeTruthy()
    expect(await status(booking.id)).toBe('booked')

    const mine = await as(db, alice, () => value(db, 'select public.my_bookings() as r'))
    expect(mine.find((b: { id: string }) => b.id === booking.id).moving_to).toBeTruthy()

    const list = await deskList()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: asked.id, kind: 'move' })
    expect(list[0].replaces_starts_at).toBeTruthy()

    await as(db, shop.desk, () => db.query('select public.confirm_booking($1)', [asked.id]))
    expect(await status(asked.id)).toBe('booked')
    expect(await status(booking.id)).toBe('cancelled')
  })

  test('if the desk declines the new time, the confirmed booking still stands', async () => {
    const booking = await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    const asked = await move(alice, booking.id, shop.chairA, await manila(db, 1, '15:00'))
    await as(db, shop.desk, () => db.query('select public.decline_booking($1, $2)', [asked.id, 'The barber is not available then.']))
    expect(await status(asked.id)).toBe('declined')
    expect(await status(booking.id)).toBe('booked')
  })

  test('asking for another new time replaces the earlier ask', async () => {
    const booking = await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    const first = await move(alice, booking.id, shop.chairA, await manila(db, 1, '15:00'))
    const second = await move(alice, booking.id, shop.chairA, await manila(db, 1, '16:00'))
    expect(await status(first.id)).toBe('cancelled')
    expect(await status(second.id)).toBe('requested')
    expect(await deskList()).toHaveLength(1)
  })

  test('moving the waiting new time still points at the confirmed booking', async () => {
    const booking = await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    const first = await move(alice, booking.id, shop.chairA, await manila(db, 1, '15:00'))
    const second = await move(alice, first.id, shop.chairA, await manila(db, 1, '16:00'))
    expect(second.replaces_starts_at).toBeTruthy()
    await as(db, shop.desk, () => db.query('select public.confirm_booking($1)', [second.id]))
    expect(await status(booking.id)).toBe('cancelled')
  })

  test('cancelling the waiting new time leaves the confirmed booking alone', async () => {
    const booking = await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    const asked = await move(alice, booking.id, shop.chairA, await manila(db, 1, '15:00'))
    await cancel(alice, asked.id)
    expect(await status(asked.id)).toBe('cancelled')
    expect(await status(booking.id)).toBe('booked')
  })

  test('asking to cancel drops a waiting move; moving is refused while a cancel ask waits', async () => {
    const booking = await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    const asked = await move(alice, booking.id, shop.chairA, await manila(db, 1, '15:00'))
    await cancel(alice, booking.id)
    expect(await status(asked.id)).toBe('cancelled')
    await expect(move(alice, booking.id, shop.chairA, await manila(db, 1, '16:00'))).rejects.toThrow(/Keep it first/)
  })

  test('a request the shop never confirmed moves at once, as before', async () => {
    const asked = await request(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    const moved = await move(alice, asked.id, shop.chairA, await manila(db, 1, '15:00'))
    expect(await status(asked.id)).toBe('cancelled')
    expect(moved).toMatchObject({ status: 'requested', replaces_starts_at: null })
  })
})
