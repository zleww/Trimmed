import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist'

// The tests run the real migration files on PGlite, a full Postgres that runs
// in memory inside Node. No Docker and no network needed.

const root = process.cwd()
const migrationsDir = join(root, 'supabase', 'migrations')

export type Row = Record<string, any>

/** A fresh database with the Supabase stand-ins and every migration applied. */
export async function createDatabase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { btree_gist } })
  await db.exec(readFileSync(join(root, 'tests', 'db', 'supabase-stub.sql'), 'utf8'))
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const name of files) {
    await db.exec(readFileSync(join(migrationsDir, name), 'utf8'))
  }
  return db
}

/** Run a query and return its rows. Outside `as()` this runs as the database owner. */
export async function rows(db: PGlite, sql: string, params: unknown[] = []): Promise<Row[]> {
  const result = await db.query<Row>(sql, params)
  return result.rows
}

/** Run a query that returns one value in a column named "r". */
export async function value(db: PGlite, sql: string, params: unknown[] = []): Promise<any> {
  const [row] = await rows(db, sql, params)
  return row?.r
}

/** A new login with no role: a stranger until it gets a staff or customer row. */
export async function addLogin(db: PGlite): Promise<string> {
  return value(db, 'insert into auth.users default values returning id as r')
}

/**
 * Run `fn` the way the app would: as a signed-in user (or signed out when
 * userId is null), with row-level security on. `aal` is the sign-in level.
 */
export async function as<T>(db: PGlite, userId: string | null, fn: () => Promise<T>, aal = 'aal1'): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ''])
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ aal })])
  await db.exec(`set role ${userId ? 'authenticated' : 'anon'}`)
  try {
    return await fn()
  } finally {
    await db.exec('reset role')
    await db.query("select set_config('request.jwt.claim.sub', '', false)")
    await db.query("select set_config('request.jwt.claims', '', false)")
  }
}

/** A Manila wall-clock time `days` from today, as text Postgres reads back as timestamptz. */
export async function manila(db: PGlite, days: number, time: string): Promise<string> {
  return value(db, "select public.manila_at(public.manila_today() + $1::int, $2::time)::text as r", [days, time])
}

export type Shop = {
  branch: string // the "Main branch" every migration run starts with
  owner: string
  desk: string
  barberA: string // login of barber A
  barberB: string
  chairA: string // barbers.id of barber A
  chairB: string
  haircut: string // 30 min, P250
  shave: string // 15 min, P150
  pomade: string // product, P350, 5 in stock
}

/**
 * A small shop: owner, one desk person, two barbers with logins, open
 * 9 AM to 8 PM every day, both barbers working those hours.
 */
export async function setupShop(db: PGlite): Promise<Shop> {
  const branch = await value(db, "select id as r from public.branches where name = 'Main branch'")
  const chairA = await value(db, "insert into public.barbers (display_name, sort, branch_id) values ('Barber A', 1, $1) returning id as r", [branch])
  const chairB = await value(db, "insert into public.barbers (display_name, sort, branch_id) values ('Barber B', 2, $1) returning id as r", [branch])

  const owner = await addLogin(db)
  const desk = await addLogin(db)
  const barberA = await addLogin(db)
  const barberB = await addLogin(db)
  await db.query("insert into public.staff (id, full_name, role) values ($1, 'Owner', 'owner')", [owner])
  await db.query("insert into public.staff (id, full_name, role, branch_id) values ($1, 'Desk', 'desk', $2)", [desk, branch])
  await db.query("insert into public.staff (id, full_name, role, barber_id) values ($1, 'Barber A', 'barber', $2)", [barberA, chairA])
  await db.query("insert into public.staff (id, full_name, role, barber_id) values ($1, 'Barber B', 'barber', $2)", [barberB, chairB])

  await db.exec(`
    insert into public.shop_hours (branch_id, weekday, opens_at, closes_at)
    select id, d, '09:00', '20:00' from public.branches, generate_series(0, 6) d;
    insert into public.barber_hours (barber_id, weekday, starts_at, ends_at)
    select b.id, d, '09:00', '20:00' from public.barbers b, generate_series(0, 6) d;
    insert into public.barber_pay (barber_id, service_commission_bp) select id, 4000 from public.barbers;
  `)

  const haircut = await value(db, "insert into public.services (name, duration_minutes, price_centavos) values ('Haircut', 30, 25000) returning id as r")
  const shave = await value(db, "insert into public.services (name, duration_minutes, price_centavos) values ('Shave', 15, 15000) returning id as r")
  const pomade = await value(db, "insert into public.products (name, price_centavos, stock_qty) values ('Pomade', 35000, 5) returning id as r")

  return { branch, owner, desk, barberA, barberB, chairA, chairB, haircut, shave, pomade }
}

/** A customer login with a finished profile. */
export async function addCustomer(db: PGlite, name: string, mobile: string): Promise<string> {
  const login = await addLogin(db)
  await as(db, login, () => db.query('select public.save_my_profile($1, $2, true)', [name, mobile]))
  return login
}

/** Ask for a booking as a customer. It waits as "requested" until the shop answers. */
export async function request(db: PGlite, login: string, service: string, barber: string | null, startsAt: string): Promise<Row> {
  return as(db, login, () => value(db, 'select public.book_appointment($1, $2, $3) as r', [service, barber, startsAt]))
}

/** Ask for a booking and have the shop confirm it right away (what most tests need). */
export async function book(db: PGlite, login: string, service: string, barber: string | null, startsAt: string): Promise<Row> {
  const asked = await request(db, login, service, barber, startsAt)
  await db.query("update public.appointments set status = 'booked', confirmed_at = now() where id = $1", [asked.id])
  return { ...asked, status: 'booked' }
}

/** A walk-in, put in a barber's chair right away (barber A unless given), ready to pay. */
export async function walkInInChair(db: PGlite, shop: Shop, chair = shop.chairA, name = 'Walk In'): Promise<string> {
  const appt = await as(db, shop.desk, () =>
    value(db, 'select public.add_walk_in($1, $2, $3) as r', [name, shop.haircut, chair]),
  )
  await as(db, shop.desk, () => db.query('select public.start_service($1, null)', [appt.id]))
  return appt.id
}
