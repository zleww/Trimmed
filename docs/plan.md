# Trimmed: plan

Trimmed is the prototype name. The real shop's name, logo and customer data stay out of this repo until the owner approves.

## 1. Summary

1. One Supabase backend serves two front ends: a booking app for customers (phone first, with an account) and a shop app for the owner, the front desk and the barbers.
2. Customers sign in, pick a service, a barber or "any barber", a date and a free slot. They can see, cancel or move their own bookings. Each booking also gets a short code for the desk.
3. The desk runs today's queue (online bookings, phone bookings and walk-ins in one list), checks people in, records sales and closes the day with a blind cash count. Barbers see their own chair and their own earnings.
4. The owner sees money, expenses, stock, payroll and reports. Nobody else sees revenue, expenses or other barbers' pay.
5. The database enforces the rules: row-level security, role-checked functions, no double booking, prices from the server, voids instead of deletes, Manila time everywhere.

## 2. Decisions

| Date | Decision |
|---|---|
| 2026-11-19 | Customers have accounts (no guest booking online). |
| 2026-11-19 | One Supabase project for both apps. Both apps need the same barbers, hours and bookings, so two backends would have to copy data back and forth. |
| 2026-11-19 | Staff roles: `owner`, `desk`, `barber`. An owner or desk person can also be linked to a barber chair. |
| 2026-11-19 | Stack: React + TypeScript + Vite + Tailwind CSS v4, Supabase, Vercel, Vitest + PGlite. |
| 2026-11-19 | Customers sign in with email and password. They get a profile (photo, name, mobile) and app settings (theme, time format, favourite barber, promos). |
| 2026-11-19 | Look: the "minimal green" palette (#051F20, #0B2B26, #163832, #235347, #8EB69B, #DAF1DE), frosted glass cards, dark by default with a light theme. |
| 2026-11-19 | Payroll on hold until the owner's pay rules are known. |
| 2026-11-25 | New look, 60-30-10: indigo black (60), bone (30), amber (10). Serif headings (Fraunces). New serif-T logo and favicon. |
| 2026-11-25 | Sign-up asks for username, display name, email, mobile and password twice. Reviews show the username, never the real name. |
| 2026-11-25 | Reviews: 1 to 5 stars and an optional comment, only after a finished cut with that barber. One per customer per barber; the owner can hide one with a reason. |
| 2026-11-25 | Inspo: up to 3 photos or videos (30 s, 25 MB max) per booking, seen only by the customer, the desk, the owner and that booking's barber. |
| 2026-11-25 | Online bookings are requests. The owner or the desk confirms or declines (with a reason the customer sees). A waiting request holds its time. Desk and walk-in bookings are confirmed straight away. |
| 2026-11-25 | The shop screens start inside this site at `/shop` (staff only), not as a separate app yet. Can be split later. |

## 3. Who can do what

| | Signed out | Customer | Barber | Desk | Owner |
|---|---|---|---|---|---|
| See services, barbers, free times | yes | yes | yes | yes | yes |
| Request a booking; cancel or move own | | yes | | | |
| Confirm or decline requests | | | | yes | yes |
| Delete own data | | yes | | | |
| Read reviews and star ratings | yes | yes | yes | yes | yes |
| Review a barber (after a cut with them), favourite one | | yes | | | |
| Hide a review | | | | | yes |
| See a booking's inspo | | own | own chair | yes | yes |
| Phone bookings and walk-ins | | | | yes | yes |
| Check in, no-show, cancel | | | | yes | yes |
| Start a service | | | own chair, or a waiting walk-in | yes | yes |
| Today's queue | | | own chair, no phone numbers | everyone | everyone |
| Record a sale | | | own customers | yes | yes |
| Discounts, voids | | | | | yes |
| Close the day | | | | yes (blind) | yes (sees the difference) |
| Own earnings | | | yes | | |
| Expenses, stock, pay, settings, audit log | | | | | yes |

## 4. Data model (built)

Money is integer centavos. Times are `timestamptz`. "Today" means Asia/Manila.

**Migration 1, setup** (`supabase/migrations/20261119000001_setup.sql`)
- `barbers` (public: name only), `barber_pay` (owner only), `staff` (logins and roles), `customers` (name, mobile, consent time).
- `services` (duration, price), `products` (price, stock).
- `shop_hours`, `shop_closures`, `barber_hours`, `barber_breaks`, `barber_time_off`, `settings`.
- `audit_log` with a trigger on every table except `customers` (so a deleted customer's name doesn't live on in the log).
- Who-am-I functions: `is_owner`, `is_front_desk`, `is_staff`, `my_barber_id`, `my_customer_id`. Two-step sign-in is checked inside them from day one.

**Migration 2, bookings** (`..._bookings.sql`)
- `appointments`: one table for online, desk and walk-in. Status: booked, checked in, in the chair, done, cancelled, no-show.
- No double booking: an exclusion constraint on barber + time range. The database refuses an overlap even if two people tap at the same second.
- `barber_is_free` is the one place that decides if a barber is free (hours, breaks, time off, closures, other bookings). The slot list and every booking action use it, so the screen and the database always agree.
- Customer: `get_free_slots`, `book_appointment`, `my_bookings`, `cancel_my_booking`, `reschedule_my_booking`, `delete_my_data`.
- Shop: `desk_free_slots`, `desk_book`, `add_walk_in`, `check_in`, `start_service`, `mark_no_show`, `cancel_appointment`, `queue_for_day`.

**Migration 3, sales** (`..._sales.sql`)
- `sales`, `sale_items`, `payments` (cash, GCash, Maya; e-wallet reference required and unique), `tips`, `stock_movements`, `expenses`, `day_closes`.
- `record_sale` (prices from the database, payments must equal total plus tips, discounts owner only), `void_sale`, `stock_in`, `adjust_stock`, `add_expense`, `void_expense`, `close_day`, `is_day_closed`, `my_earnings`.

**Migration 4, profiles** (`..._profiles.sql`)
- Customer photo (private Storage bucket `avatars`, each customer can only touch their own folder) and app settings.
- Barber photo and short bio (public bucket `barber-photos`, owner uploads).
- `public_shop_hours` for the booking site. `my_bookings` now returns one JSON list.

**Migration 5, public menu fix** (`..._public_menu_fix.sql`)
- Signed-out visitors get their own "active only" rule for services and barbers. The old rule called `is_staff()`, which visitors can't run, so their read failed. Found by checking the live project.

**Migration 6, reviews and inspo** (`20261125000006_reviews_inspo.sql`)
- `customers.username` (unique, lowercase, a few names reserved), `username_available` for the sign-up form, `save_my_profile` with a username.
- `set_favourite_barber` for the star.
- `barber_reviews` table (no direct access), `barber_ratings`, `barber_reviews`, `review_barber`, `remove_my_review`, `hide_review` (owner).
- `booking_inspo` table and private `inspo` bucket (25 MB, images and mp4/mov/webm). `add_booking_inspo`, `remove_booking_inspo`, `booking_inspo`. Moving a booking keeps its inspo. Deleting your data removes your username, reviews and inspo.

**Migration 7, booking requests** (`20261125000007_booking_requests.sql`)
- New statuses `requested` and `declined`, plus `confirmed_at` and `confirmed_by`.
- A request holds its time: the no-double-booking rule and `barber_is_free` count it.
- `book_appointment` makes a request; `desk_book` and walk-ins stay confirmed.
- A waiting request can be cancelled or moved any time before it starts; a confirmed booking keeps the cut-off.
- `booking_requests` (owner and desk: name, number, visits, missed bookings, inspo count), `confirm_booking`, `decline_booking` (reason required, shown to the customer).

**Not built yet**
- Payroll (waiting on the owner's pay rules and a check of this year's SSS, PhilHealth, Pag-IBIG and tax rates).
- Owner dashboard and report functions.
- Edge Functions: `staff-admin` (make staff logins, like Laced) and removing a customer's login after they delete their data.
- The barber's screen that shows a booking's inspo (comes with the shop app; the database side is done).
- Telling the customer when a request is answered (email or SMS). For now they see it in My bookings.
- The rest of the shop app: today's queue, walk-ins, check-in, sales, close the day, owner reports.
- Clearing old inspo files after the visit (storage is only 1 GB on the free plan).

## 5. Booking site (built)

Inspired by the structure of a local barbershop's booking site (rules, then date, barber, service, time, details), made calmer and clearer:
- **Home:** one promise and one primary button, the real next free seat, services with prices and durations, barbers, how it works, opening hours.
- **Booking in 4 steps:** service, barber (or any barber), time (days in one row, times grouped morning / afternoon / evening), check and confirm. A summary stays on the side on a laptop and in a bar at the bottom on a phone. Choices survive a trip to the sign-in page.
- **Account:** My bookings (upcoming and past, move or cancel inside the cut-off), Profile (photo the customer crops and zooms in a round frame before upload, name, mobile), Settings (theme, time format, favourite barber, promos, change password, sign out, delete my data).
- **Barber page** (`/barbers/:id`): photo, bio, star rating, reviews, a star to make them your favourite, and "Book with...".
- **Inspo**: add photos or short videos on the confirm step or later from My bookings.
- **Requests**: the last step is "Send request". My bookings shows "Waiting for the shop", "Confirmed", or "Declined" with the shop's reason.
- **Shop** (`/shop`, owner and desk only): booking requests, soonest first, with the customer's number, history and inspo; Confirm, or Decline with a reason. Checks for new requests every minute.
- **Forgot password**: the email link opens `/new-password` to type the new one (Settings > Change password opens the same page).
- **Privacy notice** page, linked from the consent line.
- Phone first: checked at 320, 375 and 390 wide for anything wider than the screen. Grids use `grid-cols-1` on phones so long text can't stretch them.
- Development runs on sample data when no keys are set (or with `npm run dev:sample`). That data is never in the production build (checked), and a production build without keys refuses to start.

## 6. Booking safety

- Signed-out visitors can call `get_free_slots` and read active services and barbers. Nothing else. A test checks this list.
- Booking needs a signed-in account with a profile (name, mobile, consent).
- One account can't fill the day: at most 2 upcoming bookings and 5 bookings an hour (owner can change both).
- Bot protection: turn on CAPTCHA for sign-up and sign-in in Supabase Auth (it supports Cloudflare Turnstile). To check against the current Supabase docs before we set it up.
- Customers see only their own bookings. Barbers never see phone numbers. Booking codes are random.
- No SMS in v1. Sign-in by email (and maybe Google). Phone sign-in by SMS code costs money per message, so we'd get a cost estimate first.

## 7. Lessons carried over from Laced

- Every migration revokes access from `public` and `anon`, then grants on purpose.
- After each SQL paste into the dashboard, check the new tables and functions really exist on the live project.
- Two-step sign-in for the owner is checked in the database (`aal2`), not just on screen.
- Edge Functions: set the name before deploying and keep the file as `index.ts`.
- `VITE_` variables are public. The secret key lives only in Edge Functions. Vercel variable changes need a redeploy.
- No demo mode in production. A build with no keys refuses to start.
- Wide tables become cards on phones from day one.

## 8. Open questions

**For Ezekiel**
1. jnk-nini's email for commits.
2. The repo `zleww/Trimmed` is public. Fine for a portfolio piece as long as no shop data goes in. Keep it public?
3. Shop app look: same palette and glass style as the booking site (as in the dashboard reference)?

**For the owner**
1. Services, prices and how long each takes. Products sold.
2. Number of barbers and chairs, opening hours, days off, holidays.
3. Barber pay: commission % on services, on products too?, base pay?, who keeps tips?, pay period?
4. Are barbers employees or commission-only? This decides whether SSS, PhilHealth, Pag-IBIG and tax are deducted.
5. Deposit for bookings, or none?
6. Cancellation cut-off (now 2 hours) and no-show policy (block after a few no-shows?).
7. Walk-ins vs bookings: who goes first when both are waiting?
8. Payment methods used (cash, GCash, Maya, others?).
9. Can barbers ring up their own customers, or only the desk? (Built: barbers can, for their own customers.)
10. Who receives stock deliveries: owner only (built) or the desk too?
11. Sales after the day is closed are blocked. OK, or should the owner be able to reopen a day?
12. Written agreement on customer data, who owns the code, and who pays hosting.

## 9. Launch checklist (before real customers)

- Privacy notice page and consent line, approved by the owner.
- Delete-my-data works end to end, including removing the login.
- CAPTCHA on, Supabase Auth rate limits checked, minimum password length set.
- Owner two-step sign-in on. Staff accounts named, no shared logins.
- Security headers on Vercel (Content Security Policy, no framing, nosniff). Plain error messages, never raw database errors.
- Every migration applied and checked on the live project.
- Data Privacy Act review (a lawyer or the school). Written agreement with the owner.
- A trial run alongside the shop's current way of booking.
- Hosting plan: Vercel's free Hobby plan is for non-commercial use only. Move to a paid plan (check the current price) before the shop uses it or anyone is paid for it.
- Supabase Auth URL Configuration: Site URL is the real domain, and the redirect list has only our own addresses.
- Inspo files: decide how long to keep them after the visit and clear old ones (privacy and the 1 GB storage limit). Mention them in the privacy notice.
