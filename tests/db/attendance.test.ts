import { beforeEach, describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { as, createDatabase, rows, setupShop, value, type Shop } from './helpers'

let db: PGlite
let shop: Shop

beforeEach(async () => {
  db = await createDatabase()
  shop = await setupShop(db)
})

const attendance = (who: string) =>
  as(db, who, async () => rows(db, 'select * from public.attendance(public.manila_today(), public.manila_today())'))

describe('clocking in and out', () => {
  test('barber and desk clock in and out; the shift is logged at their branch', async () => {
    for (const who of [shop.barberA, shop.desk]) {
      await as(db, who, () => db.query('select public.clock_in()'))
      const open = await as(db, who, () => value(db, 'select public.my_shifts_today() as r'))
      expect(open).toHaveLength(1)
      expect(open[0].clock_out).toBeNull()
      // a second clock-in while on shift is refused
      await expect(as(db, who, () => db.query('select public.clock_in()'))).rejects.toThrow(/already clocked in/)
      await db.query("update public.shifts set clock_in = clock_in - interval '1 hour' where staff_id = $1", [who])
      await as(db, who, () => db.query('select public.clock_out()'))
      await expect(as(db, who, () => db.query('select public.clock_out()'))).rejects.toThrow(/not clocked in/)
    }
    const list = await attendance(shop.owner)
    expect(list).toHaveLength(2)
    expect(list.every((s) => s.branch_id === shop.branch && s.minutes >= 59)).toBe(true)
  })

  test('the owner and customers do not clock in', async () => {
    await expect(as(db, shop.owner, () => db.query('select public.clock_in()'))).rejects.toThrow(/Not allowed/)
    await expect(as(db, null, () => db.query('select public.clock_in()'))).rejects.toThrow()
    expect(await as(db, shop.owner, () => value(db, 'select public.my_shifts_today() as r'))).toBeNull()
  })

  test('only the owner sees attendance, and staff cannot read the table', async () => {
    await as(db, shop.barberA, () => db.query('select public.clock_in()'))
    for (const who of [shop.desk, shop.barberA]) {
      await expect(attendance(who)).rejects.toThrow(/Not allowed/)
      await expect(as(db, who, () => rows(db, 'select * from public.shifts'))).rejects.toThrow()
    }
  })
})

describe('fixing a shift', () => {
  test('owner fixes a forgotten clock-out with a reason', async () => {
    await as(db, shop.barberA, () => db.query('select public.clock_in()'))
    await db.query("update public.shifts set clock_in = now() - interval '9 hours'")
    const [shift] = await attendance(shop.owner)
    const out = await value(db, "select (now() - interval '1 hour')::text as r")

    await expect(as(db, shop.owner, () => db.query('select public.fix_shift($1, $2, $3, $4)', [shift.id, shift.clock_in, out, 'x']))).rejects.toThrow(/reason/)
    await expect(as(db, shop.desk, () => db.query('select public.fix_shift($1, $2, $3, $4)', [shift.id, shift.clock_in, out, 'Forgot']))).rejects.toThrow(/Not allowed/)

    await as(db, shop.owner, () => db.query('select public.fix_shift($1, $2, $3, $4)', [shift.id, shift.clock_in, out, 'Forgot to clock out']))
    const [fixed] = await attendance(shop.owner)
    expect(fixed.minutes).toBe(480)
    expect(fixed.fix_reason).toBe('Forgot to clock out')
    // the change is in the audit log
    expect(await value(db, "select count(*)::int as r from public.audit_log where table_name = 'shifts' and action = 'update' and new ->> 'fix_reason' = 'Forgot to clock out' and actor = $1", [shop.owner])).toBe(1)
  })

  test('a fix cannot overlap another shift or go backwards', async () => {
    await as(db, shop.barberA, () => db.query('select public.clock_in()'))
    await db.query("update public.shifts set clock_in = now() - interval '5 hours', clock_out = now() - interval '4 hours'")
    await as(db, shop.barberA, () => db.query('select public.clock_in()'))
    const [later, earlier] = await attendance(shop.owner)
    await expect(
      as(db, shop.owner, () => db.query("select public.fix_shift($1, now() - interval '4 hours 30 minutes', null, 'Moved')", [later.id])),
    ).rejects.toThrow(/overlaps/)
    await expect(
      as(db, shop.owner, () => db.query("select public.fix_shift($1, $2, now() - interval '6 hours', 'Wrong')", [earlier.id, earlier.clock_in])),
    ).rejects.toThrow(/after clock-in/)
  })
})
