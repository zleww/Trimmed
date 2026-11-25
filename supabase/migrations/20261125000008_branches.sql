-- Migration 8: branches (locations).
--
-- The shop has more than one branch. Each barber works at one branch, each
-- branch has its own opening hours (and may close on its own days), and every
-- booking belongs to a branch. Customers pick the location first.
-- The front desk works one branch and only sees that branch; the owner sees all.
--
-- Everything that exists today goes into one branch called "Main branch",
-- which the owner can rename.

-- ---------------------------------------------------------------------------
-- The branches
-- ---------------------------------------------------------------------------

create table public.branches (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (char_length(btrim(name)) between 2 and 60),
  address    text check (address is null or char_length(btrim(address)) between 5 and 200),
  phone      text check (phone is null or char_length(btrim(phone)) between 7 and 30),
  active     boolean not null default true,
  sort       integer not null default 0,
  created_at timestamptz not null default now()
);

create trigger audit_branches after insert or update or delete on public.branches
  for each row execute function public.audit_row();

insert into public.branches (name, sort) values ('Main branch', 1);

-- ---------------------------------------------------------------------------
-- Barbers, hours, closures, staff and bookings get a branch
-- ---------------------------------------------------------------------------

alter table public.barbers add column branch_id uuid references public.branches (id);
update public.barbers set branch_id = (select id from public.branches where name = 'Main branch');
alter table public.barbers alter column branch_id set not null;
create index barbers_branch_idx on public.barbers (branch_id);

-- one row per branch per weekday
alter table public.shop_hours add column branch_id uuid references public.branches (id);
update public.shop_hours set branch_id = (select id from public.branches where name = 'Main branch');
alter table public.shop_hours alter column branch_id set not null;
alter table public.shop_hours drop constraint shop_hours_weekday_key;
alter table public.shop_hours add constraint shop_hours_branch_weekday_key unique (branch_id, weekday);

-- a closure with no branch closes every branch (a holiday); otherwise just that one
alter table public.shop_closures add column branch_id uuid references public.branches (id);
alter table public.shop_closures drop constraint shop_closures_closed_on_key;
alter table public.shop_closures add constraint shop_closures_branch_day_key unique nulls not distinct (branch_id, closed_on);

-- the branch a desk person works at (owners: none, they see all; barbers: their chair's branch)
alter table public.staff add column branch_id uuid references public.branches (id);
alter table public.staff add constraint staff_desk_needs_branch check (role <> 'desk' or branch_id is not null);

alter table public.appointments add column branch_id uuid references public.branches (id);

-- a booking with a barber is at that barber's branch: fill it in if it's missing, and
-- refuse a mismatch, so no path (function, dashboard, script) can get it wrong
create function public.appointment_branch()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_barber_branch uuid := (select b.branch_id from public.barbers b where b.id = new.barber_id);
begin
  new.branch_id := coalesce(new.branch_id, v_barber_branch);
  if v_barber_branch is not null and new.branch_id <> v_barber_branch then
    raise exception 'That barber works at another location';
  end if;
  return new;
end
$$;
revoke execute on function public.appointment_branch() from public, anon, authenticated;
create trigger appointments_branch before insert or update of barber_id, branch_id on public.appointments
  for each row execute function public.appointment_branch();

update public.appointments a set branch_id = coalesce(
  (select b.branch_id from public.barbers b where b.id = a.barber_id),
  (select id from public.branches where name = 'Main branch')
);
alter table public.appointments alter column branch_id set not null;
create index appointments_branch_idx on public.appointments (branch_id, starts_at);

-- ---------------------------------------------------------------------------
-- Who works where
-- ---------------------------------------------------------------------------

-- The branch this staff login is tied to: a barber's chair's branch, a desk
-- person's branch, or null for the owner (all branches) and non-staff.
create function public.my_branch_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case s.role
    when 'barber' then (select b.branch_id from public.barbers b where b.id = s.barber_id)
    when 'desk' then s.branch_id
    else null
  end
  from public.staff s
  where s.id = (select auth.uid()) and s.active and public.sign_in_complete()
$$;

-- May this staff login act on that branch? The owner may act on all of them.
create function public.works_at(p_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_owner() or (public.is_staff() and public.my_branch_id() = p_branch)
$$;

-- For a booking with only a barber, or only one branch open: which branch?
-- Raises a plain message when it can't tell or the two don't match.
create function public.pick_branch(p_branch uuid, p_barber uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_barber_branch uuid := (select b.branch_id from public.barbers b where b.id = p_barber);
  v_only          uuid;
begin
  if p_branch is not null and not exists (select 1 from public.branches br where br.id = p_branch and br.active) then
    raise exception 'That location is not available';
  end if;
  if p_branch is not null and v_barber_branch is not null and v_barber_branch <> p_branch then
    raise exception 'That barber works at another location';
  end if;
  if coalesce(p_branch, v_barber_branch) is not null then
    return coalesce(p_branch, v_barber_branch);
  end if;
  -- no location and no barber: fine only when there is just one branch
  if (select count(*) from public.branches br where br.active) = 1 then
    select br.id into v_only from public.branches br where br.active;
    return v_only;
  end if;
  raise exception 'Pick a location first';
end
$$;

-- ---------------------------------------------------------------------------
-- Free time, per branch
-- ---------------------------------------------------------------------------

-- Same checks as before, but the opening hours and closures are the barber's branch.
create or replace function public.barber_is_free(p_barber uuid, p_start timestamptz, p_end timestamptz, p_ignore uuid default null)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d        date := public.manila_date(p_start);
  dow      integer := extract(dow from d)::integer;
  v_branch uuid;
begin
  -- must start and end on the same Manila day
  if public.manila_date(p_end - interval '1 second') <> d then
    return false;
  end if;

  select b.branch_id into v_branch from public.barbers b
  join public.branches br on br.id = b.branch_id
  where b.id = p_barber and b.active and br.active;
  if v_branch is null then
    return false;
  end if;

  -- closed: the whole shop (no branch) or this branch
  if exists (select 1 from public.shop_closures c where c.closed_on = d and (c.branch_id is null or c.branch_id = v_branch)) then
    return false;
  end if;

  -- inside this branch's hours
  if not exists (
    select 1 from public.shop_hours h
    where h.branch_id = v_branch and h.weekday = dow
      and public.manila_at(d, h.opens_at) <= p_start
      and public.manila_at(d, h.closes_at) >= p_end
  ) then
    return false;
  end if;

  -- inside the barber's hours
  if not exists (
    select 1 from public.barber_hours h
    where h.barber_id = p_barber and h.weekday = dow
      and public.manila_at(d, h.starts_at) <= p_start
      and public.manila_at(d, h.ends_at) >= p_end
  ) then
    return false;
  end if;

  -- not on a break
  if exists (
    select 1 from public.barber_breaks b
    where b.barber_id = p_barber and b.weekday = dow
      and tstzrange(public.manila_at(d, b.starts_at), public.manila_at(d, b.ends_at)) && tstzrange(p_start, p_end)
  ) then
    return false;
  end if;

  -- not on time off
  if exists (
    select 1 from public.barber_time_off t
    where t.barber_id = p_barber
      and tstzrange(t.starts_at, t.ends_at) && tstzrange(p_start, p_end)
  ) then
    return false;
  end if;

  -- no other active appointment or waiting request in the way
  if exists (
    select 1 from public.appointments a
    where a.barber_id = p_barber
      and a.status in ('requested', 'booked', 'checked_in', 'in_chair', 'done')
      and a.starts_at is not null
      and tstzrange(a.starts_at, a.ends_at) && tstzrange(p_start, p_end)
      and a.id is distinct from p_ignore
  ) then
    return false;
  end if;

  return true;
end
$$;

-- The slot list now takes a branch. p_branch null = every branch (or the barber's).
drop function public.get_free_slots(uuid, uuid, date);
drop function public.desk_free_slots(uuid, uuid, date);
drop function public.list_free_slots(uuid, uuid, date, integer);

create function public.list_free_slots(p_service uuid, p_branch uuid, p_barber uuid, p_date date, p_notice integer)
returns table (starts_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_set      public.settings%rowtype;
  v_duration integer;
  v_branch   uuid := coalesce(p_branch, (select b.branch_id from public.barbers b where b.id = p_barber));
  v_open     time;
  v_close    time;
begin
  select * into v_set from public.settings limit 1;
  select s.duration_minutes into v_duration from public.services s where s.id = p_service and s.active;
  if v_duration is null then
    return;
  end if;
  if p_date < public.manila_today() or p_date > public.manila_today() + v_set.booking_days_ahead then
    return;
  end if;

  -- the earliest opening and latest closing that day (one branch, or all of them)
  select min(h.opens_at), max(h.closes_at) into v_open, v_close
  from public.shop_hours h
  join public.branches br on br.id = h.branch_id and br.active
  where h.weekday = extract(dow from p_date)::integer
    and (v_branch is null or h.branch_id = v_branch);
  if v_open is null then
    return;
  end if;

  return query
  select distinct slot.t
  from generate_series(
         public.manila_at(p_date, v_open),
         public.manila_at(p_date, v_close) - make_interval(mins => v_duration),
         make_interval(mins => v_set.slot_step_minutes)
       ) as slot(t)
  where slot.t >= now() + make_interval(mins => p_notice)
    and exists (
      select 1 from public.barbers b
      where b.active
        and (p_barber is null or b.id = p_barber)
        and (v_branch is null or b.branch_id = v_branch)
        and public.barber_is_free(b.id, slot.t, slot.t + make_interval(mins => v_duration))
    )
  order by slot.t;
end
$$;

-- For the booking site (signed out too). Times only, never names.
create function public.get_free_slots(p_service uuid, p_branch uuid, p_barber uuid, p_date date)
returns table (starts_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select f.starts_at
  from public.list_free_slots(p_service, p_branch, p_barber, p_date, (select s.min_notice_minutes from public.settings s limit 1)) f
$$;

-- The older call without a branch, kept so a page that hasn't reloaded yet still works.
create function public.get_free_slots(p_service uuid, p_barber uuid, p_date date)
returns table (starts_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select f.starts_at from public.get_free_slots(p_service, null, p_barber, p_date) f
$$;

-- For the desk: no notice period. A desk person only sees their own branch.
create function public.desk_free_slots(p_service uuid, p_branch uuid, p_barber uuid, p_date date)
returns table (starts_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_branch uuid;
begin
  if not public.is_front_desk() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_branch := public.pick_branch(coalesce(p_branch, public.my_branch_id()), p_barber);
  if not public.works_at(v_branch) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query select f.starts_at from public.list_free_slots(p_service, v_branch, p_barber, p_date, 0) f;
end
$$;

-- ---------------------------------------------------------------------------
-- Making a booking at a branch
-- ---------------------------------------------------------------------------

drop function public.create_appointment(uuid, text, uuid, uuid, timestamptz, text);

create function public.create_appointment(
  p_customer uuid, p_guest_name text, p_service uuid, p_branch uuid, p_barber uuid, p_starts_at timestamptz, p_source text
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service public.services%rowtype;
  v_branch  uuid := public.pick_branch(p_branch, p_barber);
  v_barber  uuid := p_barber;
  v_end     timestamptz;
  v_notice  integer;
  v_row     public.appointments%rowtype;
begin
  select * into v_service from public.services s where s.id = p_service and s.active;
  if v_service.id is null then
    raise exception 'That service is not available';
  end if;
  v_end := p_starts_at + make_interval(mins => v_service.duration_minutes);

  -- the time must be one the slot list would offer at this branch (online keeps the notice period)
  select case when p_source = 'online' then s.min_notice_minutes else 0 end
  into v_notice from public.settings s limit 1;
  if not exists (
    select 1 from public.list_free_slots(p_service, v_branch, p_barber, public.manila_date(p_starts_at), v_notice) f
    where f.starts_at = p_starts_at
  ) then
    raise exception 'That time is no longer free. Please pick another.';
  end if;

  -- "any barber": the free barber at this branch with the fewest bookings that day
  if v_barber is null then
    select b.id into v_barber
    from public.barbers b
    where b.active and b.branch_id = v_branch and public.barber_is_free(b.id, p_starts_at, v_end)
    order by (
      select count(*) from public.appointments a
      where a.barber_id = b.id
        and a.status in ('requested', 'booked', 'checked_in', 'in_chair', 'done')
        and public.manila_date(a.starts_at) = public.manila_date(p_starts_at)
    ), b.sort, b.id
    limit 1;
  end if;

  begin
    insert into public.appointments
      (customer_id, guest_name, service_id, branch_id, barber_id, starts_at, ends_at, source, status, price_centavos, created_by,
       confirmed_at, confirmed_by)
    values
      (p_customer, p_guest_name, p_service, v_branch, v_barber, p_starts_at, v_end, p_source,
       case when p_source = 'online' then 'requested' else 'booked' end,
       v_service.price_centavos, (select auth.uid()),
       case when p_source = 'online' then null else now() end,
       case when p_source = 'online' then null else (select auth.uid()) end)
    returning * into v_row;
  exception when exclusion_violation then
    -- someone else got it a moment earlier
    raise exception 'That time is no longer free. Please pick another.';
  end;

  return v_row;
end
$$;

-- The summary now says where.
create or replace function public.booking_summary(a public.appointments)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id,
    'code', a.code,
    'starts_at', a.starts_at,
    'ends_at', a.ends_at,
    'status', a.status,
    'service_id', a.service_id,
    'service', (select s.name from public.services s where s.id = a.service_id),
    'branch_id', a.branch_id,
    'branch', (select br.name from public.branches br where br.id = a.branch_id),
    'barber_id', a.barber_id,
    'barber', (select b.display_name from public.barbers b where b.id = a.barber_id),
    'price_centavos', a.price_centavos,
    'reason', case when a.status = 'declined' then a.cancel_reason end
  )
$$;

-- Customers: book at a branch. The older call without a branch stays for a page that hasn't reloaded.
create function public.book_appointment(p_service uuid, p_branch uuid, p_barber uuid, p_starts_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid := public.my_customer_id();
  v_set      public.settings%rowtype;
  v_row      public.appointments%rowtype;
begin
  if v_customer is null then
    raise exception 'Finish your profile before booking' using errcode = '42501';
  end if;
  select * into v_set from public.settings limit 1;

  -- limits that stop one account from filling the whole day (waiting requests count)
  if (
    select count(*) from public.appointments a
    where a.customer_id = v_customer and a.status in ('requested', 'booked') and a.starts_at > now()
  ) >= v_set.max_upcoming_per_customer then
    raise exception 'You already have % upcoming bookings. Cancel one first.', v_set.max_upcoming_per_customer;
  end if;
  if (
    select count(*) from public.appointments a
    where a.customer_id = v_customer and a.source = 'online' and a.created_at > now() - interval '1 hour'
  ) >= v_set.max_bookings_per_hour then
    raise exception 'Too many bookings in a short time. Please try again later.';
  end if;

  v_row := public.create_appointment(v_customer, null, p_service, p_branch, p_barber, p_starts_at, 'online');
  return public.booking_summary(v_row);
end
$$;

create or replace function public.book_appointment(p_service uuid, p_barber uuid, p_starts_at timestamptz)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.book_appointment(p_service, null::uuid, p_barber, p_starts_at)
$$;

-- Moving stays at the same branch.
create or replace function public.reschedule_my_booking(p_id uuid, p_barber uuid, p_starts_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.appointments%rowtype := public.my_changeable_booking(p_id);
  v_new public.appointments%rowtype;
begin
  update public.appointments
  set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()), cancel_reason = 'Moved by customer'
  where id = v_old.id;

  v_new := public.create_appointment(v_old.customer_id, null, v_old.service_id, v_old.branch_id, p_barber, p_starts_at, 'online');
  update public.booking_inspo set appointment_id = v_new.id where appointment_id = v_old.id;
  return public.booking_summary(v_new);
end
$$;

-- Desk bookings and walk-ins land at the desk person's branch (or the barber's).
create or replace function public.desk_book(p_guest_name text, p_service uuid, p_barber uuid, p_starts_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_branch uuid;
  v_row    public.appointments%rowtype;
begin
  if not public.is_front_desk() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_guest_name, ''))) not between 2 and 80 then
    raise exception 'Enter the customer''s name';
  end if;
  v_branch := public.pick_branch(public.my_branch_id(), p_barber);
  if not public.works_at(v_branch) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_row := public.create_appointment(null, btrim(p_guest_name), p_service, v_branch, p_barber, p_starts_at, 'desk');
  return public.booking_summary(v_row);
end
$$;

create or replace function public.add_walk_in(p_guest_name text, p_service uuid, p_barber uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price  integer;
  v_branch uuid;
  v_row    public.appointments%rowtype;
begin
  if not public.is_front_desk() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_guest_name, ''))) not between 2 and 80 then
    raise exception 'Enter the customer''s name';
  end if;
  select s.price_centavos into v_price from public.services s where s.id = p_service and s.active;
  if v_price is null then
    raise exception 'That service is not available';
  end if;
  if p_barber is not null and not exists (select 1 from public.barbers b where b.id = p_barber and b.active) then
    raise exception 'That barber is not available';
  end if;
  v_branch := public.pick_branch(public.my_branch_id(), p_barber);
  if not public.works_at(v_branch) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  insert into public.appointments
    (guest_name, service_id, branch_id, barber_id, source, status, price_centavos, created_by, checked_in_at, confirmed_at, confirmed_by)
  values
    (btrim(p_guest_name), p_service, v_branch, p_barber, 'walk_in', 'checked_in', v_price, (select auth.uid()), now(), now(), (select auth.uid()))
  returning * into v_row;
  return public.booking_summary(v_row);
end
$$;

-- ---------------------------------------------------------------------------
-- The desk only sees and touches its own branch
-- ---------------------------------------------------------------------------

create or replace function public.staff_appointment(p_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.appointments%rowtype;
begin
  if not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_row from public.appointments a where a.id = p_id for update;
  if v_row.id is null then
    raise exception 'Appointment not found';
  end if;
  -- another branch: only the owner
  if not public.works_at(v_row.branch_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  -- a barber may also take a waiting walk-in that has no barber yet
  if not public.is_front_desk()
     and v_row.barber_id is distinct from public.my_barber_id()
     and not (v_row.barber_id is null and v_row.status = 'checked_in') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return v_row;
end
$$;

drop function public.queue_for_day(date);
create function public.queue_for_day(p_date date)
returns table (
  id uuid, code text, starts_at timestamptz, ends_at timestamptz, status text, source text,
  service_name text, branch_id uuid, barber_id uuid, barber_name text, customer_name text, customer_mobile text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_desk   boolean := public.is_front_desk();
  v_barber uuid := public.my_barber_id();
  v_owner  boolean := public.is_owner();
  v_branch uuid := public.my_branch_id();
begin
  if not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return query
  select a.id, a.code, a.starts_at, a.ends_at, a.status, a.source,
         s.name, a.branch_id, a.barber_id, b.display_name,
         coalesce(c.full_name, a.guest_name),
         case when v_desk then c.mobile end
  from public.appointments a
  join public.services s on s.id = a.service_id
  left join public.barbers b on b.id = a.barber_id
  left join public.customers c on c.id = a.customer_id
  where (
      public.manila_date(a.starts_at) = p_date
      or (a.starts_at is null and public.manila_date(a.checked_in_at) = p_date)
    )
    and (v_owner or a.branch_id = v_branch)
    and (v_desk or a.barber_id = v_barber or (a.barber_id is null and a.status = 'checked_in'))
  order by coalesce(a.starts_at, a.checked_in_at);
end
$$;

create or replace function public.booking_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner  boolean := public.is_owner();
  v_branch uuid := public.my_branch_id();
begin
  if not public.is_front_desk() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id,
      'code', a.code,
      'starts_at', a.starts_at,
      'ends_at', a.ends_at,
      'service', s.name,
      'price_centavos', a.price_centavos,
      'branch_id', a.branch_id,
      'branch', br.name,
      'barber_id', a.barber_id,
      'barber', b.display_name,
      'customer', c.full_name,
      'username', c.username,
      'mobile', c.mobile,
      'requested_at', a.created_at,
      'visits', (select count(*) from public.appointments x where x.customer_id = c.id and x.status = 'done'),
      'no_shows', (select count(*) from public.appointments x where x.customer_id = c.id and x.status = 'no_show'),
      'inspo', (select count(*) from public.booking_inspo i where i.appointment_id = a.id)
    ) order by a.starts_at)
    from public.appointments a
    join public.services s on s.id = a.service_id
    join public.branches br on br.id = a.branch_id
    left join public.barbers b on b.id = a.barber_id
    join public.customers c on c.id = a.customer_id
    where a.status = 'requested' and a.starts_at > now()
      and (v_owner or a.branch_id = v_branch)
  ), '[]'::jsonb);
end
$$;

create or replace function public.waiting_request(p_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.appointments%rowtype;
begin
  if not public.is_front_desk() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_row from public.appointments a where a.id = p_id for update;
  if v_row.id is null then
    raise exception 'Request not found';
  end if;
  if not public.works_at(v_row.branch_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_row.status <> 'requested' then
    raise exception 'This request was already answered or cancelled';
  end if;
  if v_row.starts_at <= now() then
    raise exception 'This request has expired';
  end if;
  return v_row;
end
$$;

-- inspo: the desk only for its own branch now
create or replace function public.can_see_booking(p_appointment uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.appointments a
    where a.id = p_appointment
      and (
        a.customer_id = public.my_customer_id()
        or (public.is_front_desk() and public.works_at(a.branch_id))
        or (a.barber_id is not null and a.barber_id = public.my_barber_id())
      )
  )
$$;

-- ---------------------------------------------------------------------------
-- Public: opening hours per branch
-- ---------------------------------------------------------------------------

drop function public.public_shop_hours();
create function public.public_shop_hours()
returns table (branch_id uuid, weekday smallint, opens_at time, closes_at time)
language sql
stable
security definer
set search_path = ''
as $$
  select h.branch_id, h.weekday, h.opens_at, h.closes_at
  from public.shop_hours h
  join public.branches br on br.id = h.branch_id and br.active
  order by h.branch_id, h.weekday
$$;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

alter table public.branches enable row level security;
revoke all on public.branches from public, anon, authenticated;
grant select on public.branches to anon, authenticated;
grant insert, update on public.branches to authenticated;
grant update (full_name, role, barber_id, branch_id, active) on public.staff to authenticated;

-- anyone sees open branches (a rule with no function call, so signed-out visitors can run it)
create policy branches_select_visitor on public.branches for select to anon using (active);
create policy branches_select_signed_in on public.branches for select to authenticated
  using (active or (select public.is_staff()));
create policy branches_insert on public.branches for insert to authenticated with check ((select public.is_owner()));
create policy branches_update on public.branches for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

revoke execute on function
  public.my_branch_id(),
  public.works_at(uuid),
  public.pick_branch(uuid, uuid),
  public.barber_is_free(uuid, timestamptz, timestamptz, uuid),
  public.list_free_slots(uuid, uuid, uuid, date, integer),
  public.get_free_slots(uuid, uuid, uuid, date),
  public.get_free_slots(uuid, uuid, date),
  public.desk_free_slots(uuid, uuid, uuid, date),
  public.create_appointment(uuid, text, uuid, uuid, uuid, timestamptz, text),
  public.booking_summary(public.appointments),
  public.book_appointment(uuid, uuid, uuid, timestamptz),
  public.book_appointment(uuid, uuid, timestamptz),
  public.reschedule_my_booking(uuid, uuid, timestamptz),
  public.desk_book(text, uuid, uuid, timestamptz),
  public.add_walk_in(text, uuid, uuid),
  public.staff_appointment(uuid),
  public.queue_for_day(date),
  public.booking_requests(),
  public.waiting_request(uuid),
  public.can_see_booking(uuid),
  public.public_shop_hours()
from public, anon, authenticated;

grant execute on function public.my_branch_id() to authenticated;
grant execute on function public.get_free_slots(uuid, uuid, uuid, date) to anon, authenticated;
grant execute on function public.get_free_slots(uuid, uuid, date) to anon, authenticated;
grant execute on function public.public_shop_hours() to anon, authenticated;
grant execute on function public.desk_free_slots(uuid, uuid, uuid, date) to authenticated;
grant execute on function public.book_appointment(uuid, uuid, uuid, timestamptz) to authenticated;
grant execute on function public.book_appointment(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.reschedule_my_booking(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.desk_book(text, uuid, uuid, timestamptz) to authenticated;
grant execute on function public.add_walk_in(text, uuid, uuid) to authenticated;
grant execute on function public.queue_for_day(date) to authenticated;
grant execute on function public.booking_requests() to authenticated;
