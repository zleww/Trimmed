import { beforeEach, describe, expect, test } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { addCustomer, addLogin, as, book, createDatabase, manila, rows, setupShop, value, type Shop } from './helpers'

let db: PGlite
let shop: Shop
let alice: string
let bob: string

beforeEach(async () => {
  db = await createDatabase()
  shop = await setupShop(db)
  alice = await addCustomer(db, 'Alice Cruz', '09171234567')
  bob = await addCustomer(db, 'Bob Reyes', '09181234567')
  await as(db, alice, () => db.query("select public.save_my_profile('alice', 'Alice Cruz', '09171234567', true)"))
})

/** Alice gets a finished cut at the main branch. */
async function aliceVisited() {
  const appt = await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
  await db.query("update public.appointments set status = 'done' where id = $1", [appt.id])
}

const review = (login: string | null, rating: number, comment: string | null, branch = shop.branch) =>
  as(db, login, () => value(db, 'select public.review_branch($1, $2, $3) as r', [branch, rating, comment]))

describe('branch description', () => {
  test('visitors read the description with the branch; bad lengths are refused', async () => {
    await db.query("update public.branches set description = 'A quiet shop by the plaza.' where id = $1", [shop.branch])
    const [row] = await as(db, null, () => rows(db, 'select name, description from public.branches'))
    expect(row?.description).toBe('A quiet shop by the plaza.')
    await expect(db.query("update public.branches set description = 'short' where id = $1", [shop.branch])).rejects.toThrow()
  })
})

describe('branch reviews', () => {
  test('only a customer who finished a visit there can review, once, and edit it', async () => {
    await expect(review(alice, 5, 'Great')).rejects.toThrow(/after a visit/)
    await aliceVisited()

    let result = await review(alice, 4, '  Clean and friendly  ')
    expect(result.can_review).toBe(true)
    expect(result.reviews).toHaveLength(1)
    expect(result.reviews[0]).toMatchObject({ rating: 4, comment: 'Clean and friendly', username: 'alice', mine: true })

    result = await review(alice, 5, null)
    expect(result.reviews).toHaveLength(1)
    expect(result.reviews[0]).toMatchObject({ rating: 5, comment: null })

    // Bob never came: he can read but not write
    const forBob = await as(db, bob, () => value(db, 'select public.branch_reviews($1) as r', [shop.branch]))
    expect(forBob.can_review).toBe(false)
    expect(forBob.reviews[0].mine).toBe(false)
    await expect(review(bob, 1, 'Never went')).rejects.toThrow(/after a visit/)
  })

  test('a booking that is only requested or booked does not count as a visit', async () => {
    await book(db, alice, shop.haircut, shop.chairA, await manila(db, 1, '10:00'))
    await expect(review(alice, 5, null)).rejects.toThrow(/after a visit/)
  })

  test('signed-out visitors see stars and usernames, never names or numbers, and cannot write', async () => {
    await aliceVisited()
    await review(alice, 4, 'Nice')
    const ratings = await as(db, null, () => rows(db, 'select * from public.branch_ratings()'))
    expect(ratings).toEqual([{ branch_id: shop.branch, average: '4.0', reviews: 1 }])
    const data = await as(db, null, () => value(db, 'select public.branch_reviews($1) as r', [shop.branch]))
    expect(data.can_review).toBe(false)
    expect(JSON.stringify(data)).not.toMatch(/Alice Cruz|0917/)
    await expect(review(null, 5, 'x')).rejects.toThrow(/permission denied/)
    await expect(as(db, null, () => rows(db, 'select * from public.branch_reviews'))).rejects.toThrow(/permission denied/)
  })

  test('ratings are 1 to 5 and comments at most 500 characters', async () => {
    await aliceVisited()
    await expect(review(alice, 0, null)).rejects.toThrow(/1 to 5/)
    await expect(review(alice, 6, null)).rejects.toThrow(/1 to 5/)
    await expect(review(alice, 5, 'x'.repeat(501))).rejects.toThrow(/500/)
  })

  test('the owner can hide a review with a reason; the desk cannot', async () => {
    await aliceVisited()
    const { reviews } = await review(alice, 1, 'Rude words')
    await expect(as(db, shop.desk, () => db.query('select public.hide_branch_review($1, $2)', [reviews[0].id, 'Abuse']))).rejects.toThrow(/Not allowed/)
    await as(db, shop.owner, () => db.query('select public.hide_branch_review($1, $2)', [reviews[0].id, 'Abusive language']), 'aal2')
    const after = await as(db, null, () => value(db, 'select public.branch_reviews($1) as r', [shop.branch]))
    expect(after.reviews).toHaveLength(0)
    const [rating] = await as(db, null, () => rows(db, 'select * from public.branch_ratings()'))
    expect(rating?.reviews).toBe(0)
  })

  test('removing your review, and deleting your data, take it away', async () => {
    await aliceVisited()
    await review(alice, 5, 'Good')
    const removed = await as(db, alice, () => value(db, 'select public.remove_my_branch_review($1) as r', [shop.branch]))
    expect(removed.reviews).toHaveLength(0)

    await review(alice, 5, 'Back again')
    await as(db, alice, () => db.query('select public.delete_my_data()'))
    expect(await value(db, 'select count(*)::int as r from public.branch_reviews')).toBe(0)
  })
})

describe('contact form', () => {
  const send = (login: string | null, email: string | null, mobile: string | null, note: string, branch: string | null = null, consent = true) =>
    as(db, login, () => db.query('select public.send_contact_message($1, $2, $3, $4, $5)', [email, mobile, note, branch, consent]))

  test('a signed-out visitor can send a message, cleaned up on the way in', async () => {
    await send(null, '  Kiel@Example.com ', '+63 917 555 0000', '  Do you take walk-ins on Sunday?  ', shop.branch)
    const [msg] = await rows(db, 'select * from public.contact_messages')
    expect(msg).toMatchObject({ email: 'kiel@example.com', mobile: '09175550000', note: 'Do you take walk-ins on Sunday?', branch_id: shop.branch, sent_by: null })
    expect(msg?.consented_at).toBeTruthy()
  })

  test('needs consent, a way to reply, a real note and valid details', async () => {
    await expect(send(null, 'a@b.co', null, 'Hello there', null, false)).rejects.toThrow(/agree/)
    await expect(send(null, null, null, 'Hello there')).rejects.toThrow(/email or a mobile/)
    await expect(send(null, 'not-an-email', null, 'Hello there')).rejects.toThrow(/valid email/)
    await expect(send(null, null, '12345', 'Hello there')).rejects.toThrow(/09171234567/)
    await expect(send(null, 'a@b.co', null, 'hi')).rejects.toThrow(/at least 5/)
    await expect(send(null, 'a@b.co', null, 'x'.repeat(1001))).rejects.toThrow(/1000/)
    await db.query('update public.branches set active = false where id = $1', [shop.branch])
    await expect(send(null, 'a@b.co', null, 'Hello there', shop.branch)).rejects.toThrow(/not available/)
  })

  test('the same email or number can send 3 an hour, then has to wait', async () => {
    for (let i = 0; i < 3; i++) await send(null, 'spam@example.com', null, `Message number ${i}`)
    await expect(send(null, 'SPAM@example.com', null, 'One more')).rejects.toThrow(/wait an hour/)
    await send(null, null, '09170000000', 'Different sender')
  })

  test('nobody reads messages from the site except the owner and the desk', async () => {
    await send(null, 'a@b.co', null, 'For the main branch', shop.branch)
    await expect(as(db, null, () => rows(db, 'select * from public.contact_messages'))).rejects.toThrow(/permission denied/)
    await expect(as(db, alice, () => rows(db, 'select * from public.contact_messages'))).rejects.toThrow(/permission denied/)
    await expect(as(db, alice, () => value(db, 'select public.contact_messages() as r'))).rejects.toThrow(/Not allowed/)
    await expect(as(db, shop.barberA, () => value(db, 'select public.contact_messages() as r'))).rejects.toThrow(/Not allowed/)

    const forOwner = await as(db, shop.owner, () => value(db, 'select public.contact_messages() as r'), 'aal2')
    expect(forOwner).toHaveLength(1)
    expect(forOwner[0]).toMatchObject({ email: 'a@b.co', branch: 'Main branch', read: false })
    const forDesk = await as(db, shop.desk, () => value(db, 'select public.contact_messages() as r'))
    expect(forDesk).toHaveLength(1)
  })

  test("the desk sees its own branch's messages and general ones, not another branch's", async () => {
    const other = await value(db, "insert into public.branches (name, sort) values ('Branch Two', 2) returning id as r")
    await send(null, 'one@b.co', null, 'For the main branch', shop.branch)
    await send(null, 'two@b.co', null, 'For branch two', other)
    await send(null, 'any@b.co', null, 'No branch picked')
    const forDesk = await as(db, shop.desk, () => value(db, 'select public.contact_messages() as r'))
    expect(forDesk.map((m: { email: string }) => m.email).sort()).toEqual(['any@b.co', 'one@b.co'])

    const two = await value(db, "select id as r from public.contact_messages where email = 'two@b.co'")
    await expect(as(db, shop.desk, () => db.query('select public.mark_contact_message($1, true)', [two]))).rejects.toThrow(/not found/)
    const one = await value(db, "select id as r from public.contact_messages where email = 'one@b.co'")
    await as(db, shop.desk, () => db.query('select public.mark_contact_message($1, true)', [one]))
    expect(await value(db, 'select read_by as r from public.contact_messages where id = $1', [one])).toBe(shop.desk)
  })

  test('a signed-in customer sending a message is remembered as the sender', async () => {
    const login = await addLogin(db)
    await send(login, 'me@b.co', null, 'Signed-in question')
    expect(await value(db, 'select sent_by as r from public.contact_messages')).toBe(login)
  })
})
