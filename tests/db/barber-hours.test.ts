import { beforeEach, describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { as, createDatabase, rows, setupShop, value, type Shop } from './helpers'

let db: PGlite
let shop: Shop

beforeEach(async () => {
  db = await createDatabase()
  shop = await setupShop(db)
})

const hoursOf = (barber: string) =>
  rows(db, 'select weekday, starts_at::text, ends_at::text from public.barber_hours where barber_id = $1 order by weekday', [barber])

const slotsFor = (barber: string) =>
  as(db, null, () => rows(db, 'select * from public.get_free_slots($1, $2, $3, public.manila_today() + 1)', [shop.haircut, shop.branch, barber]))

describe('barber working hours', () => {
  test('a new barber starts with the branch opening hours and can be booked', async () => {
    // what the staff-admin function does when the owner adds a barber
    const chair = await value(db, "insert into public.barbers (display_name, branch_id) values ('New Barber', $1) returning id as r", [shop.branch])
    const hours = await hoursOf(chair)
    expect(hours).toHaveLength(7)
    expect(hours[0]).toMatchObject({ starts_at: '09:00:00', ends_at: '20:00:00' })
    expect((await slotsFor(chair)).length).toBeGreaterThan(0)
  })

  test('owner sets the week; a missing day is a day off', async () => {
    const week = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, starts_at: '10:00', ends_at: '18:00' }))
    await as(db, shop.owner, () => db.query('select public.set_barber_hours($1, $2)', [shop.chairA, JSON.stringify(week)]), 'aal2')
    const hours = await hoursOf(shop.chairA)
    expect(hours.map((h) => h.weekday)).toEqual([1, 2, 3, 4, 5])
    expect(hours[0]).toMatchObject({ starts_at: '10:00:00', ends_at: '18:00:00' })
  })

  test('bad hours are refused and nothing changes', async () => {
    const bad = [{ weekday: 1, starts_at: '18:00', ends_at: '10:00' }]
    await expect(
      as(db, shop.owner, () => db.query('select public.set_barber_hours($1, $2)', [shop.chairA, JSON.stringify(bad)]), 'aal2'),
    ).rejects.toThrow(/end after it starts/)
    const twice = [{ weekday: 1, starts_at: '09:00', ends_at: '12:00' }, { weekday: 1, starts_at: '13:00', ends_at: '18:00' }]
    await expect(
      as(db, shop.owner, () => db.query('select public.set_barber_hours($1, $2)', [shop.chairA, JSON.stringify(twice)]), 'aal2'),
    ).rejects.toThrow(/only be listed once/)
    expect(await hoursOf(shop.chairA)).toHaveLength(7)
  })

  test('only the owner can change hours', async () => {
    const week = [{ weekday: 1, starts_at: '10:00', ends_at: '18:00' }]
    for (const who of [shop.desk, shop.barberA]) {
      await expect(as(db, who, () => db.query('select public.set_barber_hours($1, $2)', [shop.chairA, JSON.stringify(week)]))).rejects.toThrow(/Not allowed/)
    }
    await expect(as(db, null, () => db.query('select public.set_barber_hours($1, $2)', [shop.chairA, JSON.stringify(week)]))).rejects.toThrow()
    expect(await hoursOf(shop.chairA)).toHaveLength(7)
  })
})
