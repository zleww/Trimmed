# Trimmed

A booking and shop system for a barbershop. Work in progress.

- **Booking app** for customers: pick a service, a barber and a free time, all from a phone.
- **Shop app** for the owner, the front desk and the barbers: today's queue, walk-ins, sales, end-of-day cash count, stock, expenses and reports.

Both run on one Supabase backend. The database itself enforces who can see what, so the rules hold even if someone skips the app and calls the database directly.

## Stack

Supabase (Postgres, Auth, row-level security), with React, TypeScript, Vite and Tailwind CSS coming for the screens. Tests use Vitest and PGlite, which runs the real migration files in an in-memory Postgres.

## Run the tests

```
npm install
npm test
```

## Structure

```
supabase/migrations/   database schema, functions and access rules
tests/db/              database tests (PGlite)
docs/plan.md           plan, data model and open questions
```

## Status

- [x] Plan and data model
- [x] Database: setup, bookings, sales (58 tests)
- [ ] Payroll (waiting on the owner's pay rules)
- [ ] Booking app screens
- [ ] Shop app screens
