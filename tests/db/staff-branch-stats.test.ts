import { beforeEach, describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { as, createDatabase, rows, setupShop, value, walkInInChair, type Shop } from './helpers'

let db: PGlite
let shop: Shop
let north: string

beforeEach(async () => {
  db = await createDatabase()
  shop = await setupShop(db)
  await db.query("update auth.users set email = 'desk@example.com' where id = $1", [shop.desk])
  north = await value(db, "insert into public.branches (name, sort) values ('North (test)', 2) returning id as r")
})

const sell = async (chair: string) => {
  const appt = await walkInInChair(db, shop, chair)
  await as(db, shop.desk, () =>
    db.query(`select public.record_sale($1, $2, '[{"method":"cash","amount_centavos":25000}]')`, [
      appt, JSON.stringify([{ service_id: shop.haircut, barber_id: chair }]),
    ]),
  )
}

describe('staff list', () => {
  test('only the owner sees it, with emails and branches', async () => {
    const list = await as(db, shop.owner, () => rows(db, 'select * from public.staff_list()'))
    expect(list).toHaveLength(4)
    expect(list.find((s) => s.id === shop.desk)).toMatchObject({ role: 'desk', email: 'desk@example.com', branch_name: 'Main branch' })
    // a barber's branch comes from their chair
    expect(list.find((s) => s.id === shop.barberA)).toMatchObject({ role: 'barber', branch_name: 'Main branch' })
    await expect(as(db, shop.desk, () => rows(db, 'select * from public.staff_list()'))).rejects.toThrow(/Not allowed/)
    await expect(as(db, null, () => rows(db, 'select * from public.staff_list()'))).rejects.toThrow()
  })

  test('owner renames and moves staff; a barber takes their chair along', async () => {
    await as(db, shop.owner, () => db.query("select public.update_staff($1, 'Barber Alpha', $2)", [shop.barberA, north]))
    expect(await value(db, 'select branch_id as r from public.barbers where id = $1', [shop.chairA])).toBe(north)
    expect(await value(db, 'select display_name as r from public.barbers where id = $1', [shop.chairA])).toBe('Barber Alpha')
    await expect(as(db, shop.owner, () => db.query("select public.update_staff($1, 'Desk', null)", [shop.desk]))).rejects.toThrow(/Pick the branch/)
    await expect(as(db, shop.desk, () => db.query("select public.update_staff($1, 'Me', $2)", [shop.desk, north]))).rejects.toThrow(/Not allowed/)
  })
})

describe('branch stats', () => {
  test('revenue goes to the branch of the booking, owner only', async () => {
    await sell(shop.chairA)
    await sell(shop.chairB)
    const stats = await as(db, shop.owner, () => value(db, 'select public.branch_stats(30) as r'))
    const main = stats.find((b: { name: string }) => b.name === 'Main branch')
    const other = stats.find((b: { name: string }) => b.name === 'North (test)')
    expect(main).toMatchObject({ revenue_centavos: 50000, sales: 2, done: 2, barbers: 2 })
    expect(other).toMatchObject({ revenue_centavos: 0, sales: 0, barbers: 0 })
    await expect(as(db, shop.desk, () => value(db, 'select public.branch_stats(30) as r'))).rejects.toThrow(/Not allowed/)
  })
})
