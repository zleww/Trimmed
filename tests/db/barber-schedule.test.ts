import { beforeEach, describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addCustomer, as, book, createDatabase, manila, request, rows, setupShop, type Shop } from './helpers'

let db: PGlite
let shop: Shop

beforeEach(async () => {
  db = await createDatabase()
  shop = await setupShop(db)
})

const schedule = (who: string, days = 14) => as(db, who, () => rows(db, 'select * from public.barber_schedule($1)', [days]))

describe('barber schedule', () => {
  test('a barber sees their own coming bookings and requests, with inspo counts, no phone numbers', async () => {
    const ana = await addCustomer(db, 'Ana Cruz', '09171234567')
    const confirmed = await book(db, ana, shop.haircut, shop.chairA, await manila(db, 2, '10:00'))
    await request(db, ana, shop.haircut, shop.chairA, await manila(db, 3, '10:00'))
    // someone else's chair is not shown
    const ben = await addCustomer(db, 'Ben Reyes', '09181234567')
    await book(db, ben, shop.haircut, shop.chairB, await manila(db, 2, '11:00'))
    await db.query("insert into public.booking_inspo (appointment_id, path, kind) values ($1, 'x/1.webp', 'image')", [confirmed.id])

    const list = await schedule(shop.barberA)
    expect(list.map((r) => r.status)).toEqual(['booked', 'requested'])
    expect(list[0]).toMatchObject({ customer_name: 'Ana Cruz', inspo: 1, code: confirmed.code })
    expect(Object.keys(list[0])).not.toContain('customer_mobile')

    // and the barber may open that inspo
    const inspo = await as(db, shop.barberA, () => rows(db, 'select public.booking_inspo($1) as r', [confirmed.id]))
    expect(inspo[0].r).toHaveLength(1)
  })

  test('the range limits how far ahead', async () => {
    const ana = await addCustomer(db, 'Ana Cruz', '09171234567')
    await book(db, ana, shop.haircut, shop.chairA, await manila(db, 5, '10:00'))
    expect(await schedule(shop.barberA, 3)).toHaveLength(0)
    expect(await schedule(shop.barberA, 7)).toHaveLength(1)
  })

  test('only barbers can call it', async () => {
    for (const who of [shop.owner, shop.desk]) {
      await expect(schedule(who)).rejects.toThrow(/Not allowed/)
    }
    await expect(as(db, null, () => rows(db, 'select * from public.barber_schedule(14)'))).rejects.toThrow()
  })
})
