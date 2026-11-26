import { beforeEach, describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { as, createDatabase, setupShop, value, walkInInChair, type Shop } from './helpers'

let db: PGlite
let shop: Shop

beforeEach(async () => {
  db = await createDatabase()
  shop = await setupShop(db)
})

async function sellHaircut(chair: string) {
  const appt = await walkInInChair(db, shop, chair)
  return as(db, shop.desk, () =>
    value(db, `select public.record_sale($1, $2, '[{"method":"cash","amount_centavos":25000}]') as r`, [
      appt, JSON.stringify([{ service_id: shop.haircut, barber_id: chair }]),
    ]),
  )
}

const dashboard = (who: string, days = 30) => as(db, who, () => value(db, 'select public.owner_dashboard($1) as r', [days]))

describe('owner dashboard', () => {
  test('only the owner can open it', async () => {
    await expect(dashboard(shop.desk)).rejects.toThrow(/Not allowed/)
    await expect(dashboard(shop.barberA)).rejects.toThrow(/Not allowed/)
    await expect(as(db, null, () => value(db, 'select public.owner_dashboard(30) as r'))).rejects.toThrow()
  })

  test('only 7, 30 or 90 days', async () => {
    await expect(dashboard(shop.owner, 400)).rejects.toThrow(/7, 30 or 90/)
  })

  test('adds up today, the period, barbers and services; voided sales do not count', async () => {
    await sellHaircut(shop.chairA)
    await sellHaircut(shop.chairA)
    const voided = await sellHaircut(shop.chairB)
    await as(db, shop.owner, () => db.query("select public.void_sale($1, 'Wrong chair')", [voided.sale_id]))
    await as(db, shop.owner, () => db.query("select public.add_expense('Rent', 100000, public.manila_today())"))

    const d = await dashboard(shop.owner, 7)
    expect(d.today).toEqual({ revenue_centavos: 50000, sales: 2 })
    expect(d.period.revenue_centavos).toBe(50000)
    expect(d.period.expenses_centavos).toBe(100000)
    expect(d.daily).toHaveLength(7)
    expect(d.daily.at(-1).revenue_centavos).toBe(50000)
    expect(d.barbers[0]).toEqual({ name: 'Barber A', services: 2, revenue_centavos: 50000 })
    expect(d.barbers[1]).toEqual({ name: 'Barber B', services: 0, revenue_centavos: 0 })
    expect(d.services).toEqual([{ name: 'Haircut', count: 2 }])
    expect(d.recent).toHaveLength(2)
    expect(d.recent[0]).toMatchObject({ items: 'Haircut', barber: 'Barber A', paid_by: 'cash' })
  })
})
