# Trimmed

A booking and shop system for a barbershop. Work in progress.

- **Booking app** for customers: pick a service, a barber and a free time, all from a phone.
- **Shop app** for the owner, the front desk and the barbers: today's queue, walk-ins, sales, end-of-day cash count, stock, expenses and reports.

Both run on one Supabase backend. The database itself enforces who can see what, so the rules hold even if someone skips the app and calls the database directly.

## Stack

React, TypeScript, Vite and Tailwind CSS on the front end. Supabase (Postgres, Auth, Storage, row-level security) on the back end. Tests use Vitest and PGlite, which runs the real migration files in an in-memory Postgres.

## Run it

```
npm install
npm run dev     # with no .env.local, the screens run on sample data (development only)
npm test        # database tests
npm run build   # type check and production build
```

To connect a Supabase project, copy `.env.example` to `.env.local` and fill in the URL and publishable key. A production build without them refuses to start.

## Structure

```
src/pages/             booking site: home, booking steps, sign in, account
src/components/        layout and shared UI (glass cards, buttons, fields)
src/lib/               data layer (Supabase or sample data), dates, money, theme
supabase/migrations/   database schema, functions and access rules
tests/db/              database tests (PGlite)
docs/plan.md           plan, data model, design and open questions
```

## Status

- [x] Plan and data model
- [x] Database: setup, bookings, sales, profiles (66 tests)
- [x] Booking site: home, booking steps, sign in, my bookings, profile, settings
- [ ] Connect the live Supabase project
- [ ] Shop app screens (desk, barbers, owner)
- [ ] Payroll (on hold)
