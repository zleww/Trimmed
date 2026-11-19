import { beforeEach, describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addCustomer, as, createDatabase, rows, setupShop, value, type Shop } from './helpers'

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

describe('settings', () => {
  test('a customer saves their own settings; promo consent is stamped', async () => {
    const profile = await as(db, alice, () =>
      value(db, "select public.save_my_settings('light', '24h', $1, true) as r", [shop.chairB]),
    )
    expect(profile.theme).toBe('light')
    expect(profile.time_format).toBe('24h')
    expect(profile.preferred_barber).toBe(shop.chairB)
    expect(profile.promo_opt_in).toBe(true)
    expect(await value(db, 'select promo_opt_in_at is not null as r from public.customers where auth_user_id = $1', [alice])).toBe(true)

    await as(db, alice, () => db.query("select public.save_my_settings('light', '24h', null, false)"))
    expect(await value(db, 'select promo_opt_in_at as r from public.customers where auth_user_id = $1', [alice])).toBeNull()
  })

  test('promos are off until the customer turns them on', async () => {
    const profile = await as(db, alice, () => value(db, 'select public.my_profile() as r'))
    expect(profile.promo_opt_in).toBe(false)
    expect(profile.theme).toBe('dark')
  })

  test('bad values are refused', async () => {
    await expect(as(db, alice, () => db.query("select public.save_my_settings('neon', '12h', null, false)"))).rejects.toThrow(/Unknown setting/)
  })
})

describe('profile photo', () => {
  test('a customer can only point their photo at their own folder', async () => {
    await as(db, alice, () => db.query('select public.set_my_avatar($1)', [`${alice}/avatar.webp`]))
    await expect(as(db, alice, () => db.query('select public.set_my_avatar($1)', [`${bob}/avatar.webp`]))).rejects.toThrow(/Not allowed/)
  })

  test('files: your own folder only', async () => {
    await as(db, alice, () => db.query("insert into storage.objects (bucket_id, name) values ('avatars', $1)", [`${alice}/avatar.webp`]))
    await expect(
      as(db, alice, () => db.query("insert into storage.objects (bucket_id, name) values ('avatars', $1)", [`${bob}/avatar.webp`])),
    ).rejects.toThrow(/row-level security/)
    expect(await as(db, bob, () => rows(db, "select * from storage.objects where bucket_id = 'avatars'"))).toEqual([])
    expect((await as(db, alice, () => rows(db, "select * from storage.objects where bucket_id = 'avatars'"))).length).toBe(1)
  })

  test('only the owner uploads barber photos', async () => {
    await expect(
      as(db, alice, () => db.query("insert into storage.objects (bucket_id, name) values ('barber-photos', 'a.webp')")),
    ).rejects.toThrow(/row-level security/)
    await expect(
      as(db, shop.desk, () => db.query("insert into storage.objects (bucket_id, name) values ('barber-photos', 'a.webp')")),
    ).rejects.toThrow(/row-level security/)
    await as(db, shop.owner, () => db.query("insert into storage.objects (bucket_id, name) values ('barber-photos', 'a.webp')"))
  })

  test('deleting your data clears the photo and the promo choice', async () => {
    await as(db, alice, () => db.query('select public.set_my_avatar($1)', [`${alice}/avatar.webp`]))
    await as(db, alice, () => db.query("select public.save_my_settings('dark', '12h', null, true)"))
    await as(db, alice, () => db.query('select public.delete_my_data()'))
    const row = (await rows(db, "select * from public.customers where full_name = 'Deleted customer'"))[0]
    expect(row.avatar_path).toBeNull()
    expect(row.promo_opt_in).toBe(false)
  })
})

describe('public shop hours', () => {
  test('anyone can read opening hours', async () => {
    const hours = await as(db, null, () => rows(db, 'select * from public.public_shop_hours()'))
    expect(hours.length).toBe(7)
  })
})
