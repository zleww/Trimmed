import { beforeEach, describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addCustomer, as, book, createDatabase, manila, request, rows, setupShop, value, walkInInChair, type Shop } from './helpers'

let db: PGlite
let shop: Shop

beforeEach(async () => {
  db = await createDatabase()
  shop = await setupShop(db)
})

const sellHaircut = (appt: string) =>
  as(db, shop.desk, () =>
    db.query(`select public.record_sale($1, $2, '[{"method":"cash","amount_centavos":25000}]')`, [
      appt,
      JSON.stringify([{ service_id: shop.haircut, barber_id: shop.chairA }]),
    ]),
  )

describe('products for customers', () => {
  test('anyone sees what is for sale with a stock status, never the count', async () => {
    await db.query("update public.products set category = 'Styling', size = '100 g' where id = $1", [shop.pomade])
    await db.query(
      "insert into public.products (name, price_centavos, stock_qty, category) values ('Beard Oil', 48000, 2, 'Beard care'), ('Tonic', 38000, 0, 'Hair care'), ('Old wax', 10000, 9, 'Styling')",
    )
    await db.query("update public.products set active = false where name = 'Old wax'")

    const list = await as(db, null, () => rows(db, 'select * from public.public_products()'))
    expect(list.map((p) => `${p.name}:${p.stock_status}`)).toEqual(['Beard Oil:low', 'Tonic:out', 'Pomade:in_stock'])
    expect(Object.keys(list[0])).not.toContain('stock_qty')
    expect(list.find((p) => p.name === 'Pomade')).toMatchObject({ size: '100 g', category: 'Styling', price_centavos: 35000 })
  })

  test('only the owner adds or edits products', async () => {
    await as(db, shop.owner, () => db.query("insert into public.products (name, price_centavos, category, size) values ('Clay', 45000, 'Styling', '80 g')"))
    await expect(as(db, shop.desk, () => db.query("insert into public.products (name, price_centavos) values ('Desk item', 100)"))).rejects.toThrow()
    // the desk's update finds no rows it may change
    await as(db, shop.desk, () => db.query("update public.products set price_centavos = 1 where name = 'Clay'"))
    expect(await value(db, "select price_centavos as r from public.products where name = 'Clay'")).toBe(45000)
  })
})

describe('owner overview', () => {
  test('today against the same day last week, walk-ins and completed', async () => {
    const ana = await addCustomer(db, 'Ana Cruz', '09171234567')
    // tomorrow: not today, so not counted
    await book(db, ana, shop.haircut, shop.chairB, await manila(db, 1, '10:00'))
    // one finished walk-in today, one waiting walk-in, one request (not counted)
    await sellHaircut(await walkInInChair(db, shop))
    await as(db, shop.desk, () => db.query('select public.add_walk_in($1, $2, null)', ['Ben Santos', shop.haircut]))
    await request(db, ana, shop.haircut, shop.chairA, await manila(db, 2, '10:00'))
    // a finished booking on this weekday last week
    await db.query(
      `insert into public.appointments (guest_name, service_id, branch_id, barber_id, source, status, price_centavos, starts_at, ends_at)
       values ('Old Guest', $1, $2, $3, 'desk', 'done', 25000, public.manila_at(public.manila_today() - 7, '10:00'), public.manila_at(public.manila_today() - 7, '10:30'))`,
      [shop.haircut, shop.branch, shop.chairB],
    )

    const o = await as(db, shop.owner, () => value(db, 'select public.owner_overview() as r'))
    expect(o.today).toMatchObject({ appointments: 2, last_week: 1, walk_ins: 2, completed: 1, waiting: 1 })
    expect(o.insights.average_sale_centavos).toBe(25000)
    await expect(as(db, shop.desk, () => value(db, 'select public.owner_overview() as r'))).rejects.toThrow(/Not allowed/)
  })

  test('calendar counts per day for the month, owner only', async () => {
    await sellHaircut(await walkInInChair(db, shop))
    const days = await as(db, shop.owner, () => rows(db, 'select day::text, total, done, walk_ins from public.appointment_calendar(public.manila_today())'))
    const today = await value(db, 'select public.manila_today()::text as r')
    expect(days.length).toBeGreaterThanOrEqual(28)
    expect(days.find((d) => d.day === today)).toMatchObject({ total: 1, done: 1, walk_ins: 1 })
    await expect(as(db, shop.desk, () => rows(db, 'select * from public.appointment_calendar(public.manila_today())'))).rejects.toThrow(/Not allowed/)
  })
})

describe('CSV exports', () => {
  test('sales and appointments for a range, owner only', async () => {
    await sellHaircut(await walkInInChair(db, shop, shop.chairA, 'Walk In Cara'))
    const sales = await as(db, shop.owner, () => rows(db, 'select * from public.export_sales(public.manila_today(), public.manila_today())'))
    expect(sales).toHaveLength(1)
    expect(sales[0]).toMatchObject({ items: 'Haircut', barbers: 'Barber A', paid_with: 'cash', total_centavos: 25000, voided: false })

    const appts = await as(db, shop.owner, () => rows(db, 'select * from public.export_appointments(public.manila_today(), public.manila_today())'))
    expect(appts[0]).toMatchObject({ customer: 'Walk In Cara', service: 'Haircut', status: 'done', source: 'walk_in' })

    for (const fn of ['export_sales', 'export_appointments']) {
      await expect(as(db, shop.desk, () => rows(db, `select * from public.${fn}(public.manila_today(), public.manila_today())`))).rejects.toThrow(/Not allowed/)
    }
    await expect(as(db, shop.owner, () => rows(db, "select * from public.export_sales('2025-01-01', '2026-12-31')"))).rejects.toThrow(/up to a year/)
  })
})
