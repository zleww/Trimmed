-- Trimmed setup: time helpers, people, roles, shop setup tables, audit log.
-- Money is integer centavos. Times are timestamptz. "Today" is always Asia/Manila.
-- Every table has row-level security on and starts closed. Grants at the bottom
-- open only what each role needs.

-- needed for the no-double-booking rule (uuid "=" inside a gist index)
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Time helpers
-- ---------------------------------------------------------------------------

-- Manila calendar date of a moment. 11:30 PM in Manila is still that day.
create function public.manila_date(ts timestamptz)
returns date
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (ts at time zone 'Asia/Manila')::date
$$;

create function public.manila_today()
returns date
language sql
stable
set search_path = ''
as $$
  select public.manila_date(now())
$$;

-- A Manila date plus a wall-clock time, as a real moment. 2026-11-20 + 09:00 = 9 AM Manila.
create function public.manila_at(d date, t time)
returns timestamptz
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (d + t) at time zone 'Asia/Manila'
$$;

-- ---------------------------------------------------------------------------
-- Barbers and staff
-- ---------------------------------------------------------------------------

-- Barbers as customers see them. No pay info here (that's barber_pay, owner only).
create table public.barbers (
  id           uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 40),
  active       boolean not null default true,
  sort         integer not null default 0,
  created_at   timestamptz not null default now()
);

-- One row per shop login. The id is the Supabase Auth user id.
-- A login with no row here is a customer (or nobody) and has no shop powers.
create table public.staff (
  id         uuid primary key references auth.users (id) on delete restrict,
  full_name  text not null check (char_length(btrim(full_name)) between 2 and 80),
  role       text not null check (role in ('owner', 'desk', 'barber')),
  -- set when this person also cuts hair (an owner or desk person can be a barber too)
  barber_id  uuid unique references public.barbers (id),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint staff_barber_needs_chair check (role <> 'barber' or barber_id is not null)
);

-- How each barber is paid. Rates are in basis points: 4000 = 40.00%.
-- Final pay rules are still to be confirmed with the owner.
create table public.barber_pay (
  barber_id             uuid primary key references public.barbers (id),
  service_commission_bp integer not null default 0 check (service_commission_bp between 0 and 10000),
  product_commission_bp integer not null default 0 check (product_commission_bp between 0 and 10000),
  base_pay_centavos     integer not null default 0 check (base_pay_centavos >= 0),
  updated_at            timestamptz not null default now(),
  id                    uuid not null default gen_random_uuid() unique -- for the audit log
);

-- ---------------------------------------------------------------------------
-- Customers (people with a booking account)
-- ---------------------------------------------------------------------------

-- Only what we need: a name and a mobile number. Walk-ins don't get a row here.
create table public.customers (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  full_name    text not null check (char_length(btrim(full_name)) between 2 and 80),
  mobile       text check (mobile ~ '^09[0-9]{9}$'),
  consent_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  -- a live customer needs a number; only a deleted (anonymised) one may have none
  constraint customers_mobile_required check (deleted_at is not null or mobile is not null)
);

-- ---------------------------------------------------------------------------
-- What the shop sells
-- ---------------------------------------------------------------------------

create table public.services (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(btrim(name)) between 2 and 60),
  description      text check (char_length(description) <= 200),
  duration_minutes integer not null check (duration_minutes between 5 and 240),
  price_centavos   integer not null check (price_centavos > 0),
  active           boolean not null default true,
  sort             integer not null default 0,
  created_at       timestamptz not null default now()
);

-- stock_qty only changes through the stock and sale functions, never by hand
create table public.products (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(btrim(name)) between 2 and 60),
  price_centavos     integer not null check (price_centavos > 0),
  stock_qty          integer not null default 0 check (stock_qty >= 0),
  low_stock_at       integer not null default 3 check (low_stock_at >= 0),
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Hours, breaks, days off
-- ---------------------------------------------------------------------------
-- weekday follows Postgres: 0 = Sunday ... 6 = Saturday. No row = closed that day.

create table public.shop_hours (
  id       uuid primary key default gen_random_uuid(),
  weekday  smallint not null unique check (weekday between 0 and 6),
  opens_at time not null,
  closes_at time not null,
  constraint shop_hours_order check (closes_at > opens_at)
);

create table public.shop_closures (
  id        uuid primary key default gen_random_uuid(),
  closed_on date not null unique,
  reason    text not null check (char_length(btrim(reason)) between 2 and 80)
);

create table public.barber_hours (
  id        uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers (id),
  weekday   smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at   time not null,
  unique (barber_id, weekday),
  constraint barber_hours_order check (ends_at > starts_at)
);

-- repeating breaks, like lunch every Monday 12:00-13:00
create table public.barber_breaks (
  id        uuid primary key default gen_random_uuid(),
  barber_id uuid not null references public.barbers (id),
  weekday   smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at   time not null,
  constraint barber_breaks_order check (ends_at > starts_at)
);

-- one-off time off: a day off, a half day, sick leave
create table public.barber_time_off (
  id         uuid primary key default gen_random_uuid(),
  barber_id  uuid not null references public.barbers (id),
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  reason     text check (char_length(reason) <= 80),
  created_at timestamptz not null default now(),
  constraint barber_time_off_order check (ends_at > starts_at)
);

create index barber_time_off_idx on public.barber_time_off (barber_id, starts_at);

-- ---------------------------------------------------------------------------
-- Shop settings (one row)
-- ---------------------------------------------------------------------------

create table public.settings (
  id                        uuid primary key default gen_random_uuid(),
  singleton                 boolean not null default true unique check (singleton),
  slot_step_minutes         integer not null default 15 check (slot_step_minutes in (5, 10, 15, 20, 30, 60)),
  booking_days_ahead        integer not null default 14 check (booking_days_ahead between 1 and 90),
  min_notice_minutes        integer not null default 60 check (min_notice_minutes between 0 and 1440),
  cancel_cutoff_minutes     integer not null default 120 check (cancel_cutoff_minutes between 0 and 2880),
  max_upcoming_per_customer integer not null default 2 check (max_upcoming_per_customer between 1 and 10),
  max_bookings_per_hour     integer not null default 5 check (max_bookings_per_hour between 1 and 30),
  updated_at                timestamptz not null default now()
);

insert into public.settings default values;

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

-- Append-only. Written by a trigger, never edited.
create table public.audit_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  row_id     uuid not null,
  action     text not null check (action in ('insert', 'update', 'delete')),
  old        jsonb,
  new        jsonb,
  actor      uuid,
  at         timestamptz not null default now()
);

create index audit_log_row_idx on public.audit_log (table_name, row_id);
create index audit_log_at_idx on public.audit_log (at);

create function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log (table_name, row_id, action, new, actor)
    values (tg_table_name, new.id, 'insert', to_jsonb(new), (select auth.uid()));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log (table_name, row_id, action, old, new, actor)
    values (tg_table_name, new.id, 'update', to_jsonb(old), to_jsonb(new), (select auth.uid()));
    return new;
  else
    insert into public.audit_log (table_name, row_id, action, old, actor)
    values (tg_table_name, old.id, 'delete', to_jsonb(old), (select auth.uid()));
    return old;
  end if;
end
$$;

-- customers left out on purpose: the log would keep names and numbers after a delete request
create trigger audit_barbers         after insert or update or delete on public.barbers         for each row execute function public.audit_row();
create trigger audit_staff           after insert or update or delete on public.staff           for each row execute function public.audit_row();
create trigger audit_barber_pay      after insert or update or delete on public.barber_pay      for each row execute function public.audit_row();
create trigger audit_services        after insert or update or delete on public.services        for each row execute function public.audit_row();
create trigger audit_products        after insert or update or delete on public.products        for each row execute function public.audit_row();
create trigger audit_shop_hours      after insert or update or delete on public.shop_hours      for each row execute function public.audit_row();
create trigger audit_shop_closures   after insert or update or delete on public.shop_closures   for each row execute function public.audit_row();
create trigger audit_barber_hours    after insert or update or delete on public.barber_hours    for each row execute function public.audit_row();
create trigger audit_barber_breaks   after insert or update or delete on public.barber_breaks   for each row execute function public.audit_row();
create trigger audit_barber_time_off after insert or update or delete on public.barber_time_off for each row execute function public.audit_row();
create trigger audit_settings        after insert or update or delete on public.settings        for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- Who is calling?
-- ---------------------------------------------------------------------------

-- True when this session met the account's sign-in rule: no authenticator app
-- set up, or the code was entered ("aal2"). A stolen password alone is not enough
-- once two-step sign-in is on.
create function public.sign_in_complete()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = (select auth.uid()) and f.status = 'verified'
      )
$$;

-- 'owner', 'desk', 'barber', or null for anyone who isn't active staff
create function public.my_staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.role from public.staff s
  where s.id = (select auth.uid()) and s.active and public.sign_in_complete()
$$;

create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.my_staff_role() is not null
$$;

create function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.my_staff_role() = 'owner', false)
$$;

-- owner or desk: the people who run the queue and close the day
create function public.is_front_desk()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.my_staff_role() in ('owner', 'desk'), false)
$$;

-- the barber chair linked to this login, if any
create function public.my_barber_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.barber_id from public.staff s
  where s.id = (select auth.uid()) and s.active and public.sign_in_complete()
$$;

create function public.my_customer_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.customers c
  where c.auth_user_id = (select auth.uid()) and c.deleted_at is null
$$;

-- ---------------------------------------------------------------------------
-- Customer profile
-- ---------------------------------------------------------------------------

-- Turns "+63 917 123 4567" or "0917-123-4567" into 09171234567, or null if it isn't a PH mobile.
create function public.clean_mobile(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
begin
  if v ~ '^639[0-9]{9}$' then
    v := '0' || substr(v, 3);
  end if;
  if v ~ '^09[0-9]{9}$' then
    return v;
  end if;
  return null;
end
$$;

-- Called by the booking app after sign-up, and to edit name or number later.
create function public.save_my_profile(p_full_name text, p_mobile text, p_consent boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_mobile text := public.clean_mobile(p_mobile);
  v_name   text := btrim(coalesce(p_full_name, ''));
  v_id     uuid;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if char_length(v_name) not between 2 and 80 then
    raise exception 'Enter your name';
  end if;
  if v_mobile is null then
    raise exception 'Enter an 11-digit mobile number that starts with 09';
  end if;

  select c.id into v_id from public.customers c where c.auth_user_id = v_uid and c.deleted_at is null;

  if v_id is null then
    if p_consent is not true then
      raise exception 'Please agree to the privacy notice first';
    end if;
    insert into public.customers (auth_user_id, full_name, mobile, consent_at)
    values (v_uid, v_name, v_mobile, now())
    returning id into v_id;
  else
    update public.customers set full_name = v_name, mobile = v_mobile where id = v_id;
  end if;

  return v_id;
end
$$;

-- Booking rules the app shows before anyone signs in. Nothing private.
create function public.booking_rules()
returns table (slot_step_minutes integer, booking_days_ahead integer, min_notice_minutes integer, cancel_cutoff_minutes integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.slot_step_minutes, s.booking_days_ahead, s.min_notice_minutes, s.cancel_cutoff_minutes
  from public.settings s
$$;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------
-- Supabase gives anon and authenticated everything new in "public" by default.
-- Close it all, then open only what each role needs.

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

alter table public.barbers         enable row level security;
alter table public.staff           enable row level security;
alter table public.barber_pay      enable row level security;
alter table public.customers       enable row level security;
alter table public.services        enable row level security;
alter table public.products        enable row level security;
alter table public.shop_hours      enable row level security;
alter table public.shop_closures   enable row level security;
alter table public.barber_hours    enable row level security;
alter table public.barber_breaks   enable row level security;
alter table public.barber_time_off enable row level security;
alter table public.settings        enable row level security;
alter table public.audit_log       enable row level security;

-- Public menu: anyone (even signed out) can see active services and barbers.
grant select on public.services, public.barbers to anon, authenticated;

grant select on
  public.staff, public.barber_pay, public.customers, public.products,
  public.shop_hours, public.shop_closures, public.barber_hours, public.barber_breaks,
  public.barber_time_off, public.settings, public.audit_log
to authenticated;

-- Owner edits these directly; the policies below limit the writes to the owner.
grant insert, update on
  public.barbers, public.barber_pay, public.services,
  public.shop_hours, public.shop_closures, public.barber_hours, public.barber_breaks, public.barber_time_off
to authenticated;
grant delete on public.shop_closures, public.barber_breaks, public.barber_time_off, public.shop_hours, public.barber_hours to authenticated;
grant insert (name, price_centavos, low_stock_at, active) on public.products to authenticated;
grant update (name, price_centavos, low_stock_at, active) on public.products to authenticated;
grant update (full_name, role, barber_id, active) on public.staff to authenticated;
grant update (slot_step_minutes, booking_days_ahead, min_notice_minutes, cancel_cutoff_minutes,
              max_upcoming_per_customer, max_bookings_per_hour) on public.settings to authenticated;

grant execute on function public.manila_date(timestamptz) to anon, authenticated;
grant execute on function public.manila_today() to anon, authenticated;
grant execute on function public.manila_at(date, time) to anon, authenticated;
grant execute on function public.booking_rules() to anon, authenticated;
grant execute on function public.sign_in_complete() to authenticated;
grant execute on function public.my_staff_role() to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_owner() to authenticated;
grant execute on function public.is_front_desk() to authenticated;
grant execute on function public.my_barber_id() to authenticated;
grant execute on function public.my_customer_id() to authenticated;
grant execute on function public.clean_mobile(text) to authenticated;
grant execute on function public.save_my_profile(text, text, boolean) to authenticated;

-- "(select public.is_owner())" in a select so Postgres works it out once per query, not per row.

-- services and barbers: everyone sees active ones, staff see all, owner edits
create policy services_select on public.services for select to anon, authenticated
  using (active or (select public.is_staff()));
create policy services_insert on public.services for insert to authenticated
  with check ((select public.is_owner()));
create policy services_update on public.services for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

create policy barbers_select on public.barbers for select to anon, authenticated
  using (active or (select public.is_staff()));
create policy barbers_insert on public.barbers for insert to authenticated
  with check ((select public.is_owner()));
create policy barbers_update on public.barbers for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- staff: owner sees everyone; others see only their own row.
-- New logins are made by the staff-admin Edge Function, not from the browser.
create policy staff_select on public.staff for select to authenticated
  using ((select public.is_owner()) or id = (select auth.uid()));
create policy staff_update on public.staff for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- pay: owner only
create policy barber_pay_select on public.barber_pay for select to authenticated
  using ((select public.is_owner()));
create policy barber_pay_insert on public.barber_pay for insert to authenticated
  with check ((select public.is_owner()));
create policy barber_pay_update on public.barber_pay for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- customers: you see your own; owner and desk can look people up. Barbers can't.
-- Changes only through save_my_profile.
create policy customers_select on public.customers for select to authenticated
  using (auth_user_id = (select auth.uid()) or (select public.is_front_desk()));

-- products: staff read (to sell), owner edits. Stock changes go through functions.
create policy products_select on public.products for select to authenticated
  using ((select public.is_staff()));
create policy products_insert on public.products for insert to authenticated
  with check ((select public.is_owner()));
create policy products_update on public.products for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- hours, breaks, days off: staff read, owner edits
create policy shop_hours_select on public.shop_hours for select to authenticated using ((select public.is_staff()));
create policy shop_hours_write  on public.shop_hours for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

create policy shop_closures_select on public.shop_closures for select to authenticated using ((select public.is_staff()));
create policy shop_closures_write  on public.shop_closures for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

create policy barber_hours_select on public.barber_hours for select to authenticated using ((select public.is_staff()));
create policy barber_hours_write  on public.barber_hours for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

create policy barber_breaks_select on public.barber_breaks for select to authenticated using ((select public.is_staff()));
create policy barber_breaks_write  on public.barber_breaks for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

create policy barber_time_off_select on public.barber_time_off for select to authenticated using ((select public.is_staff()));
create policy barber_time_off_write  on public.barber_time_off for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- settings: owner only (the public part is booking_rules())
create policy settings_select on public.settings for select to authenticated using ((select public.is_owner()));
create policy settings_update on public.settings for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- audit log: owner reads, nobody writes directly
create policy audit_log_select on public.audit_log for select to authenticated using ((select public.is_owner()));
