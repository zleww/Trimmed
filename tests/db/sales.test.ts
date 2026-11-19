import { beforeEach, describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { as, createDatabase, rows, setupShop, value, walkInInChair, type Shop } from './helpers'

let db: PGlite
let shop: Shop

beforeEach(async () => {
  db = await createDatabase()
  shop = await setupShop(db)
})

type Item = Record<string, unknown>
type Pay = { method: string; amount_centavos: number; reference?: string }

function sell(
  who: string,
  appointment: string | null,
  items: Item[],
  payments: Pay[],
  tips: Item[] = [],
  discount = 0,
  reason: string | null = null,
) {
  return as(db, who, () =>
    value(db, 'select public.record_sale($1, $2, $3, $4, $5, $6) as r', [
      appointment, JSON.stringify(items), JSON.stringify(payments), JSON.stringify(tips), discount, reason,
    ]),
  )
}

const cash = (amount: number): Pay => ({ method: 'cash', amount_centavos: amount })

describe('prices', () => {
  test('the app cannot set a price: extra fields are ignored', async () => {
    const appt = await walkInInChair(db, shop)
    const sale = await sell(shop.desk, appt, [{ service_id: shop.haircut, barber_id: shop.chairA, price_centavos: 1, unit_price_centavos: 1 }], [cash(25000)])
    expect(sale.total_centavos).toBe(25000)
    // paying the tampered price is refused
    const appt2 = await walkInInChair(db, shop, shop.chairB)
    await expect(sell(shop.desk, appt2, [{ service_id: shop.haircut, barber_id: shop.chairB, price_centavos: 1 }], [cash(1)])).rejects.toThrow(/must add up to ₱250.00/)
  })

  test('payments must cover the total plus tips', async () => {
    const appt = await walkInInChair(db, shop)
    const items = [{ service_id: shop.haircut, barber_id: shop.chairA }]
    const tips = [{ barber_id: shop.chairA, amount_centavos: 5000 }]
    await expect(sell(shop.desk, appt, items, [cash(25000)], tips)).rejects.toThrow(/must add up to ₱300.00/)
    const sale = await sell(shop.desk, appt, items, [cash(20000), { method: 'gcash', amount_centavos: 10000, reference: 'gc 1234 5678' }], tips)
    expect(sale.tips_centavos).toBe(5000)
    expect(await value(db, "select reference as r from public.payments where method = 'gcash'")).toBe('GC12345678')
  })

  test('a failed sale leaves nothing behind', async () => {
    const appt = await walkInInChair(db, shop)
    await expect(sell(shop.desk, appt, [{ service_id: shop.haircut, barber_id: shop.chairA }, { product_id: shop.pomade, qty: 1 }], [cash(1)])).rejects.toThrow()
    expect(await value(db, 'select count(*)::int as r from public.sales')).toBe(0)
    expect(await value(db, 'select stock_qty as r from public.products where id = $1', [shop.pomade])).toBe(5)
  })
})

describe('discounts', () => {
  test('only the owner, and only with a reason', async () => {
    const items = [{ service_id: shop.haircut, barber_id: shop.chairA }]
    const appt = await walkInInChair(db, shop)
    await expect(sell(shop.desk, appt, items, [cash(20000)], [], 5000, 'Regular')).rejects.toThrow(/Only the owner/)
    await expect(sell(shop.owner, appt, items, [cash(20000)], [], 5000, '')).rejects.toThrow(/reason/)
    const sale = await sell(shop.owner, appt, items, [cash(20000)], [], 5000, 'Regular customer')
    expect(sale.total_centavos).toBe(20000)
  })
})

describe('e-wallet references', () => {
  test('GCash needs a reference, and it can only be used once', async () => {
    const items = [{ service_id: shop.shave, barber_id: shop.chairA }]
    await expect(sell(shop.desk, null, items, [{ method: 'gcash', amount_centavos: 15000 }])).rejects.toThrow(/reference number/)
    await sell(shop.desk, null, items, [{ method: 'gcash', amount_centavos: 15000, reference: 'REF000111' }])
    await expect(sell(shop.desk, null, items, [{ method: 'gcash', amount_centavos: 15000, reference: 'ref000111' }])).rejects.toThrow(/already used/)
    // the same number on Maya is a different receipt
    await sell(shop.desk, null, items, [{ method: 'maya', amount_centavos: 15000, reference: 'REF000111' }])
  })

  test('a voided sale frees its reference', async () => {
    const items = [{ service_id: shop.shave, barber_id: shop.chairA }]
    const sale = await sell(shop.desk, null, items, [{ method: 'gcash', amount_centavos: 15000, reference: 'REF000222' }])
    await as(db, shop.owner, () => db.query("select public.void_sale($1, 'Wrong customer')", [sale.sale_id]))
    await sell(shop.desk, null, items, [{ method: 'gcash', amount_centavos: 15000, reference: 'REF000222' }])
  })
})

describe('stock', () => {
  test('selling takes stock, voiding puts it back, and you cannot sell what you do not have', async () => {
    const sale = await sell(shop.desk, null, [{ product_id: shop.pomade, qty: 2 }], [cash(70000)])
    expect(await value(db, 'select stock_qty as r from public.products where id = $1', [shop.pomade])).toBe(3)
    await expect(sell(shop.desk, null, [{ product_id: shop.pomade, qty: 4 }], [cash(140000)])).rejects.toThrow(/only 3 left/)

    await as(db, shop.owner, () => db.query("select public.void_sale($1, 'Returned')", [sale.sale_id]))
    expect(await value(db, 'select stock_qty as r from public.products where id = $1', [shop.pomade])).toBe(5)
    const moves = await rows(db, 'select reason, change from public.stock_movements order by created_at')
    expect(moves.map((m) => `${m.reason}:${m.change}`)).toEqual(['sale:-2', 'void:2'])
  })

  test('stock in and count adjustments are owner only', async () => {
    await expect(as(db, shop.desk, () => db.query('select public.stock_in($1, 10)', [shop.pomade]))).rejects.toThrow(/Not allowed/)
    await as(db, shop.owner, () => db.query('select public.stock_in($1, 10)', [shop.pomade]))
    await as(db, shop.owner, () => db.query("select public.adjust_stock($1, 14, 'One broken jar')", [shop.pomade]))
    expect(await value(db, 'select stock_qty as r from public.products where id = $1', [shop.pomade])).toBe(14)
  })

  test('nobody edits stock numbers directly, not even the owner', async () => {
    await expect(as(db, shop.owner, () => db.query('update public.products set stock_qty = 99'))).rejects.toThrow(/permission denied/)
  })
})

describe('appointments and sales', () => {
  test('a sale finishes the appointment, and it cannot be sold twice', async () => {
    const appt = await walkInInChair(db, shop)
    const items = [{ service_id: shop.haircut, barber_id: shop.chairA }]
    await sell(shop.desk, appt, items, [cash(25000)])
    expect(await value(db, 'select status as r from public.appointments where id = $1', [appt])).toBe('done')
    await expect(sell(shop.desk, appt, items, [cash(25000)])).rejects.toThrow(/already has a sale/)
  })

  test('a barber can ring up their own customer but not another barber\'s', async () => {
    const mine = await walkInInChair(db, shop, shop.chairA)
    const theirs = await walkInInChair(db, shop, shop.chairB)
    await expect(sell(shop.barberA, theirs, [{ service_id: shop.haircut, barber_id: shop.chairB }], [cash(25000)])).rejects.toThrow(/Not allowed/)
    await sell(shop.barberA, mine, [{ service_id: shop.haircut, barber_id: shop.chairA }], [cash(25000)])
  })

  test('voiding is owner only and needs a reason', async () => {
    const sale = await sell(shop.desk, null, [{ service_id: shop.shave, barber_id: shop.chairA }], [cash(15000)])
    await expect(as(db, shop.desk, () => db.query("select public.void_sale($1, 'oops')", [sale.sale_id]))).rejects.toThrow(/Not allowed/)
    await expect(as(db, shop.owner, () => db.query("select public.void_sale($1, '')", [sale.sale_id]))).rejects.toThrow(/reason/)
    await as(db, shop.owner, () => db.query("select public.void_sale($1, 'Typed twice')", [sale.sale_id]))
    const row = (await rows(db, 'select * from public.sales where id = $1', [sale.sale_id]))[0]
    expect(row.voided_at).toBeTruthy()
    // still there, never deleted, and in the audit log
    expect(await value(db, "select count(*)::int as r from public.audit_log where table_name = 'sales' and row_id = $1", [sale.sale_id])).toBeGreaterThanOrEqual(2)
  })
})

describe('closing the day', () => {
  test('the desk counts blind; the owner sees the difference', async () => {
    await sell(shop.desk, null, [{ service_id: shop.haircut, barber_id: shop.chairA }], [cash(25000)])
    await sell(shop.desk, null, [{ service_id: shop.shave, barber_id: shop.chairB }], [{ method: 'gcash', amount_centavos: 15000, reference: 'REF999000' }])

    const result = await as(db, shop.desk, () => value(db, 'select public.close_day(24000, 15000, 0) as r'))
    expect(result).toEqual({ closed: true })

    const close = (await rows(db, 'select * from public.day_closes'))[0]
    expect(close.expected_cash_centavos).toBe(25000)
    expect(close.counted_cash_centavos).toBe(24000)
    expect(close.expected_gcash_centavos).toBe(15000)
    expect(await as(db, shop.desk, () => rows(db, 'select * from public.day_closes'))).toEqual([])
    expect((await as(db, shop.owner, () => rows(db, 'select * from public.day_closes'))).length).toBe(1)
  })

  test('once closed, no second close and no more sales today', async () => {
    await as(db, shop.desk, () => db.query('select public.close_day(0, 0, 0)'))
    await expect(as(db, shop.owner, () => db.query('select public.close_day(0, 0, 0)'))).rejects.toThrow(/already closed/)
    await expect(sell(shop.desk, null, [{ service_id: shop.shave, barber_id: shop.chairA }], [cash(15000)])).rejects.toThrow(/already closed/)
  })

  test('barbers cannot close the day', async () => {
    await expect(as(db, shop.barberA, () => db.query('select public.close_day(0, 0, 0)'))).rejects.toThrow(/Not allowed/)
  })
})

describe('Manila time', () => {
  test('11:30 PM and 12:30 AM Manila land on the right business day', async () => {
    const sale = await sell(shop.desk, null, [{ service_id: shop.shave, barber_id: shop.chairA }], [cash(15000)])
    await db.query("update public.sales set sold_at = '2026-11-19 23:30:00+08' where id = $1", [sale.sale_id])
    expect(await value(db, 'select business_date::text as r from public.sales where id = $1', [sale.sale_id])).toBe('2026-11-19')
    // 00:30 Manila is still the 19th in UTC (16:30), but it is the 20th in the shop
    await db.query("update public.sales set sold_at = '2026-11-20 00:30:00+08' where id = $1", [sale.sale_id])
    expect(await value(db, 'select business_date::text as r from public.sales where id = $1', [sale.sale_id])).toBe('2026-11-20')
  })
})

describe('expenses', () => {
  test('owner only, no future dates, voided not deleted', async () => {
    await expect(as(db, shop.desk, () => db.query("select public.add_expense('Rent', 100, public.manila_today())"))).rejects.toThrow(/Not allowed/)
    await expect(as(db, shop.owner, () => db.query("select public.add_expense('Rent', 100, public.manila_today() + 1)"))).rejects.toThrow(/future/)
    const id = await as(db, shop.owner, () => value(db, "select public.add_expense('Blades', 120000, public.manila_today()) as r"))
    await as(db, shop.owner, () => db.query("select public.void_expense($1, 'Typed the wrong amount')", [id]))
    expect(await value(db, 'select void_reason as r from public.expenses where id = $1', [id])).toBe('Typed the wrong amount')
  })
})
