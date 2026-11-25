import { beforeEach, describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addCustomer, addLogin, as, book, createDatabase, manila, rows, setupShop, value, type Row, type Shop } from './helpers'

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

/** Pretend the shop finished this booking (the shop app will do this for real). */
async function markDone(appointmentId: string) {
  await db.query("update public.appointments set status = 'done' where id = $1", [appointmentId])
}

describe('usernames', () => {
  test('a new customer saves a username with their profile, stored in lowercase', async () => {
    const login = await addLogin(db)
    await as(db, login, () => db.query("select public.save_my_profile(' Kiel_D ', 'Kiel Dee', '09191234567', true)"))
    const profile = await as(db, login, () => value(db, 'select public.my_profile() as r'))
    expect(profile.username).toBe('kiel_d')
    expect(profile.full_name).toBe('Kiel Dee')
  })

  test('taken, reserved and badly shaped usernames are refused', async () => {
    await as(db, alice, () => db.query("select public.save_my_profile('alice', 'Alice Cruz', '09171234567', true)"))
    const login = await addLogin(db)
    await expect(as(db, login, () => db.query("select public.save_my_profile('ALICE', 'Other', '09191234567', true)"))).rejects.toThrow(/taken/)
    await expect(as(db, login, () => db.query("select public.save_my_profile('admin', 'Other', '09191234567', true)"))).rejects.toThrow(/taken/)
    await expect(as(db, login, () => db.query("select public.save_my_profile('a b', 'Other', '09191234567', true)"))).rejects.toThrow(/Pick a username/)
  })

  test('signed-out visitors can check a username and learn nothing else', async () => {
    await as(db, alice, () => db.query("select public.save_my_profile('alice', 'Alice Cruz', '09171234567', true)"))
    expect(await as(db, null, () => value(db, "select public.username_available('alice') as r"))).toBe(false)
    expect(await as(db, null, () => value(db, "select public.username_available('fresh.name') as r"))).toBe(true)
    // keeping your own username when you save again is fine
    expect(await as(db, alice, () => value(db, "select public.username_available('alice') as r"))).toBe(true)
  })
})

describe('favourite barber', () => {
  test('the star sets and clears one favourite', async () => {
    let profile = await as(db, alice, () => value(db, 'select public.set_favourite_barber($1) as r', [shop.chairA]))
    expect(profile.preferred_barber).toBe(shop.chairA)
    profile = await as(db, alice, () => value(db, 'select public.set_favourite_barber(null) as r'))
    expect(profile.preferred_barber).toBeNull()
  })

  test('signed-out visitors cannot set one', async () => {
    await expect(as(db, null, () => db.query('select public.set_favourite_barber($1)', [shop.chairA]))).rejects.toThrow(/permission denied/)
  })
})

describe('reviews', () => {
  beforeEach(async () => {
    await as(db, alice, () => db.query("select public.save_my_profile('alice', 'Alice Cruz', '09171234567', true)"))
  })

  test('only after a finished cut with that barber', async () => {
    await expect(
      as(db, alice, () => db.query("select public.review_barber($1, 5, 'Great')", [shop.chairA])),
    ).rejects.toThrow(/after your cut/)
    const seen = await as(db, alice, () => value(db, 'select public.barber_reviews($1) as r', [shop.chairA]))
    expect(seen.can_review).toBe(false)

    const booking = await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    await markDone(booking.id)
    expect((await as(db, alice, () => value(db, 'select public.barber_reviews($1) as r', [shop.chairA]))).can_review).toBe(true)
    // a cut with barber A doesn't let you review barber B
    await expect(as(db, alice, () => db.query('select public.review_barber($1, 1, null)', [shop.chairB]))).rejects.toThrow(/after your cut/)
  })

  test('one review per person, which they can change; the average updates', async () => {
    await markDone((await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))).id)
    await markDone((await book(db, bob, shop.haircut, shop.chairA, await manila(db, 1, '11:00'))).id)

    await as(db, alice, () => db.query("select public.review_barber($1, 5, ' Clean fade ')", [shop.chairA]))
    await as(db, alice, () => db.query("select public.review_barber($1, 4, 'Clean fade, a bit late')", [shop.chairA]))
    await as(db, bob, () => db.query('select public.review_barber($1, 2, null)', [shop.chairA]))

    const ratings = await as(db, null, () => rows(db, 'select * from public.barber_ratings() where barber_id = $1', [shop.chairA]))
    expect(Number(ratings[0]!.average)).toBe(3)
    expect(ratings[0]!.reviews).toBe(2)

    await expect(as(db, alice, () => db.query('select public.review_barber($1, 6, null)', [shop.chairA]))).rejects.toThrow(/1 to 5/)
  })

  test('the public sees the username and stars, never the real name', async () => {
    await markDone((await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))).id)
    await as(db, alice, () => db.query("select public.review_barber($1, 5, 'Sharp')", [shop.chairA]))

    const page = await as(db, null, () => value(db, 'select public.barber_reviews($1) as r', [shop.chairA]))
    expect(page.reviews).toHaveLength(1)
    expect(page.reviews[0].username).toBe('alice')
    expect(page.reviews[0].comment).toBe('Sharp')
    expect(page.reviews[0].mine).toBe(false)
    expect(JSON.stringify(page)).not.toMatch(/Alice Cruz|0917/)
    // the author sees it marked as theirs
    expect((await as(db, alice, () => value(db, 'select public.barber_reviews($1) as r', [shop.chairA]))).reviews[0].mine).toBe(true)
  })

  test('nobody reads or writes the review table directly', async () => {
    await expect(as(db, null, () => db.query('select * from public.barber_reviews'))).rejects.toThrow(/permission denied/)
    await expect(as(db, alice, () => db.query('select * from public.barber_reviews'))).rejects.toThrow(/permission denied/)
  })

  test('the owner can hide a review with a reason; the desk cannot', async () => {
    await markDone((await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))).id)
    await as(db, alice, () => db.query("select public.review_barber($1, 1, 'rude words')", [shop.chairA]))
    const id = await value(db, 'select id as r from public.barber_reviews')

    await expect(as(db, shop.desk, () => db.query("select public.hide_review($1, 'spam')", [id]))).rejects.toThrow(/Not allowed/)
    await as(db, shop.owner, () => db.query("select public.hide_review($1, 'Offensive language')", [id]), 'aal1')
    const page = await as(db, null, () => value(db, 'select public.barber_reviews($1) as r', [shop.chairA]))
    expect(page.reviews).toEqual([])
    const ratings = await as(db, null, () => rows(db, 'select * from public.barber_ratings() where barber_id = $1', [shop.chairA]))
    expect(ratings[0]!.reviews).toBe(0)
  })

  test('removing your review, and deleting your data, takes it away', async () => {
    await markDone((await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))).id)
    await as(db, alice, () => db.query("select public.review_barber($1, 5, 'Sharp')", [shop.chairA]))
    await as(db, alice, () => db.query('select public.remove_my_review($1)', [shop.chairA]))
    expect(await value(db, 'select count(*)::int as r from public.barber_reviews')).toBe(0)

    await as(db, alice, () => db.query("select public.review_barber($1, 5, 'Sharp')", [shop.chairA]))
    await as(db, alice, () => db.query('select public.delete_my_data()'))
    expect(await value(db, 'select count(*)::int as r from public.barber_reviews')).toBe(0)
    expect(await value(db, "select count(*)::int as r from public.customers where username = 'alice'")).toBe(0)
  })
})

describe('inspo on bookings', () => {
  let booking: Row

  beforeEach(async () => {
    booking = await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
  })

  const add = (login: string, appointment: string, path: string, kind = 'image') =>
    as(db, login, () => value(db, 'select public.add_booking_inspo($1, $2, $3) as r', [appointment, path, kind]))

  test('a customer adds up to 3 files to their own upcoming booking, from their own folder', async () => {
    await add(alice, booking.id, `${alice}/a.webp`)
    await add(alice, booking.id, `${alice}/b.mp4`, 'video')
    await add(alice, booking.id, `${alice}/c.webp`)
    await expect(add(alice, booking.id, `${alice}/d.webp`)).rejects.toThrow(/Up to 3/)

    await expect(add(alice, booking.id, `${bob}/x.webp`)).rejects.toThrow(/Not allowed/)
    await expect(add(bob, booking.id, `${bob}/x.webp`)).rejects.toThrow(/own upcoming bookings/)
    await expect(add(alice, booking.id, `${alice}/e.exe`, 'program')).rejects.toThrow()
  })

  test('the customer, the desk and the booked barber see it; other barbers and customers do not', async () => {
    await add(alice, booking.id, `${alice}/a.webp`)
    const seenBy = async (login: string) =>
      (await as(db, login, () => value(db, 'select public.booking_inspo($1) as r', [booking.id]))).length

    expect(await seenBy(alice)).toBe(1)
    expect(await seenBy(shop.desk)).toBe(1)
    expect(await seenBy(shop.barberA)).toBe(1)
    expect(await seenBy(shop.barberB)).toBe(0)
    expect(await seenBy(bob)).toBe(0)
  })

  test('the storage rule lets the same people open the file', async () => {
    await add(alice, booking.id, `${alice}/a.webp`)
    await db.query("insert into storage.objects (bucket_id, name, owner) values ('inspo', $1, $2)", [`${alice}/a.webp`, alice])
    const files = (login: string) => as(db, login, () => rows(db, "select name from storage.objects where bucket_id = 'inspo'"))

    expect(await files(alice)).toHaveLength(1)
    expect(await files(shop.barberA)).toHaveLength(1)
    expect(await files(shop.desk)).toHaveLength(1)
    expect(await files(shop.barberB)).toHaveLength(0)
    expect(await files(bob)).toHaveLength(0)
    // nobody can upload into someone else's folder
    await expect(
      as(db, bob, () => db.query("insert into storage.objects (bucket_id, name) values ('inspo', $1)", [`${alice}/sneaky.webp`])),
    ).rejects.toThrow(/row-level security/)
  })

  test('moving the booking keeps the inspo; removing returns the file path', async () => {
    const added = await add(alice, booking.id, `${alice}/a.webp`)
    const later = await manila(db, 1, '15:00')
    const moved = await as(db, alice, () =>
      value(db, 'select public.reschedule_my_booking($1, $2, $3) as r', [booking.id, shop.chairB, later]),
    )
    expect((await as(db, alice, () => value(db, 'select public.booking_inspo($1) as r', [moved.id]))).length).toBe(1)
    // the new barber sees it now
    expect((await as(db, shop.barberB, () => value(db, 'select public.booking_inspo($1) as r', [moved.id]))).length).toBe(1)

    await expect(as(db, bob, () => db.query('select public.remove_booking_inspo($1)', [added.id]))).rejects.toThrow(/Not found/)
    expect(await as(db, alice, () => value(db, 'select public.remove_booking_inspo($1) as r', [added.id]))).toBe(`${alice}/a.webp`)
  })

  test('nobody reads the inspo table directly', async () => {
    await expect(as(db, alice, () => db.query('select * from public.booking_inspo'))).rejects.toThrow(/permission denied/)
  })
})
