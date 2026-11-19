-- Trimmed bookings: appointments, free slots, booking and queue actions.
--
-- Online bookings, phone bookings made by the desk, and walk-ins all live in one
-- table, so the queue is one list. The database itself refuses two overlapping
-- appointments for the same barber, even if two people tap at the same second.

create table public.appointments (
  id             uuid primary key default gen_random_uuid(),
  -- short code read out at the desk; random so nobody can guess someone else's
  code           text not null unique default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)),
  customer_id    uuid references public.customers (id),
  -- walk-ins and phone bookings have no account, just a name
  guest_name     text check (char_length(btrim(guest_name)) between 2 and 80),
  service_id     uuid not null references public.services (id),
  -- null only for a walk-in still waiting for "any barber"
  barber_id      uuid references public.barbers (id),
  -- null only for a walk-in still waiting
  starts_at      timestamptz,
  ends_at        timestamptz,
  source         text not null check (source in ('online', 'desk', 'walk_in')),
  status         text not null default 'booked'
                 check (status in ('booked', 'checked_in', 'in_chair', 'done', 'cancelled', 'no_show')),
  -- price when booked, so the customer sees what they agreed to (the sale still reads the live price)
  price_centavos integer not null check (price_centavos > 0),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  checked_in_at  timestamptz,
  cancelled_at   timestamptz,
  cancelled_by   uuid,
  cancel_reason  text,
  constraint appointments_one_person check (num_nonnulls(customer_id, guest_name) = 1),
  constraint appointments_times check (
    (starts_at is null and ends_at is null) or (starts_at is not null and ends_at > starts_at)
  ),
  -- only a walk-in that is waiting (or left before their turn) may have no time
  constraint appointments_time_needed check (
    starts_at is not null or (source = 'walk_in' and status in ('checked_in', 'cancelled'))
  ),
  -- no double booking: same barber, overlapping time, both still active = refused
  constraint appointments_no_overlap exclude using gist (
    barber_id with =,
    tstzrange(starts_at, ends_at) with &&
  ) where (status in ('booked', 'checked_in', 'in_chair', 'done') and barber_id is not null and starts_at is not null)
);

create index appointments_starts_idx on public.appointments (starts_at);
create index appointments_customer_idx on public.appointments (customer_id, starts_at);
create index appointments_barber_idx on public.appointments (barber_id, starts_at);

create trigger audit_appointments after insert or update or delete on public.appointments
  for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- Is this barber free?
-- ---------------------------------------------------------------------------

-- One place that decides if a barber can take [p_start, p_end). Used by the slot
-- list and by every booking action, so the screen and the database always agree.
-- p_ignore skips one appointment (the one being moved).
create function public.barber_is_free(p_barber uuid, p_start timestamptz, p_end timestamptz, p_ignore uuid default null)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d   date := public.manila_date(p_start);
  dow integer := extract(dow from d)::integer;
begin
  -- must start and end on the same Manila day
  if public.manila_date(p_end - interval '1 second') <> d then
    return false;
  end if;

  if not exists (select 1 from public.barbers b where b.id = p_barber and b.active) then
    return false;
  end if;

  if exists (select 1 from public.shop_closures c where c.closed_on = d) then
    return false;
  end if;

  -- inside shop hours
  if not exists (
    select 1 from public.shop_hours h
    where h.weekday = dow
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

  -- no other active appointment in the way
  if exists (
    select 1 from public.appointments a
    where a.barber_id = p_barber
      and a.status in ('booked', 'checked_in', 'in_chair', 'done')
      and a.starts_at is not null
      and tstzrange(a.starts_at, a.ends_at) && tstzrange(p_start, p_end)
      and a.id is distinct from p_ignore
  ) then
    return false;
  end if;

  return true;
end
$$;

-- ---------------------------------------------------------------------------
-- Free slots (public)
-- ---------------------------------------------------------------------------

-- Start times for a service on a Manila date. p_barber null = "any barber".
-- p_notice = how many minutes from now the first slot may be.
-- Returns times only: never names or numbers.
create function public.list_free_slots(p_service uuid, p_barber uuid, p_date date, p_notice integer)
returns table (starts_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_set      public.settings%rowtype;
  v_duration integer;
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

  select h.opens_at, h.closes_at into v_open, v_close
  from public.shop_hours h where h.weekday = extract(dow from p_date)::integer;
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
        and public.barber_is_free(b.id, slot.t, slot.t + make_interval(mins => v_duration))
    )
  order by slot.t;
end
$$;

-- For the booking app (anyone, even signed out): uses the shop's notice period.
create function public.get_free_slots(p_service uuid, p_barber uuid, p_date date)
returns table (starts_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select f.starts_at
  from public.list_free_slots(p_service, p_barber, p_date, (select s.min_notice_minutes from public.settings s limit 1)) f
$$;

-- For the desk: no notice period, so a caller can be booked for later today.
create function public.desk_free_slots(p_service uuid, p_barber uuid, p_date date)
returns table (starts_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_front_desk() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query select f.starts_at from public.list_free_slots(p_service, p_barber, p_date, 0) f;
end
$$;

-- ---------------------------------------------------------------------------
-- Making a booking (shared by online and desk bookings)
-- ---------------------------------------------------------------------------

-- Not callable from the app. Picks a barber for "any barber" and inserts the row.
create function public.create_appointment(
  p_customer uuid, p_guest_name text, p_service uuid, p_barber uuid, p_starts_at timestamptz, p_source text
)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_service public.services%rowtype;
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

  -- the time must be one the slot list would offer (online keeps the notice period)
  select case when p_source = 'online' then s.min_notice_minutes else 0 end
  into v_notice from public.settings s limit 1;
  if not exists (
    select 1 from public.list_free_slots(p_service, p_barber, public.manila_date(p_starts_at), v_notice) f
    where f.starts_at = p_starts_at
  ) then
    raise exception 'That time is no longer free. Please pick another.';
  end if;

  -- "any barber": the free barber with the fewest bookings that day
  if v_barber is null then
    select b.id into v_barber
    from public.barbers b
    where b.active and public.barber_is_free(b.id, p_starts_at, v_end)
    order by (
      select count(*) from public.appointments a
      where a.barber_id = b.id
        and a.status in ('booked', 'checked_in', 'in_chair', 'done')
        and public.manila_date(a.starts_at) = public.manila_date(p_starts_at)
    ), b.sort, b.id
    limit 1;
  end if;

  begin
    insert into public.appointments
      (customer_id, guest_name, service_id, barber_id, starts_at, ends_at, source, price_centavos, created_by)
    values
      (p_customer, p_guest_name, p_service, v_barber, p_starts_at, v_end, p_source, v_service.price_centavos, (select auth.uid()))
    returning * into v_row;
  exception when exclusion_violation then
    -- someone else got it a moment earlier
    raise exception 'That time is no longer free. Please pick another.';
  end;

  return v_row;
end
$$;

-- What the app gets back after a booking. No other customer's data.
create function public.booking_summary(a public.appointments)
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
    'service', (select s.name from public.services s where s.id = a.service_id),
    'barber', (select b.display_name from public.barbers b where b.id = a.barber_id),
    'price_centavos', a.price_centavos
  )
$$;

-- ---------------------------------------------------------------------------
-- Customer actions (booking app)
-- ---------------------------------------------------------------------------

create function public.book_appointment(p_service uuid, p_barber uuid, p_starts_at timestamptz)
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

  -- limits that stop one account from filling the whole day
  if (
    select count(*) from public.appointments a
    where a.customer_id = v_customer and a.status = 'booked' and a.starts_at > now()
  ) >= v_set.max_upcoming_per_customer then
    raise exception 'You already have % upcoming bookings. Cancel one first.', v_set.max_upcoming_per_customer;
  end if;
  if (
    select count(*) from public.appointments a
    where a.customer_id = v_customer and a.source = 'online' and a.created_at > now() - interval '1 hour'
  ) >= v_set.max_bookings_per_hour then
    raise exception 'Too many bookings in a short time. Please try again later.';
  end if;

  v_row := public.create_appointment(v_customer, null, p_service, p_barber, p_starts_at, 'online');
  return public.booking_summary(v_row);
end
$$;

-- The signed-in customer's own bookings, newest first.
create function public.my_bookings()
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.booking_summary(a)
  from public.appointments a
  where a.customer_id = public.my_customer_id()
  order by a.starts_at desc
$$;

-- Internal: the customer's own upcoming booking that may still be changed.
create function public.my_changeable_booking(p_id uuid)
returns public.appointments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    public.appointments%rowtype;
  v_cutoff integer;
begin
  select * into v_row from public.appointments a
  where a.id = p_id and a.customer_id = public.my_customer_id()
  for update;
  -- same message whether it isn't yours or doesn't exist
  if v_row.id is null then
    raise exception 'Booking not found';
  end if;
  if v_row.status <> 'booked' then
    raise exception 'This booking can no longer be changed';
  end if;
  select s.cancel_cutoff_minutes into v_cutoff from public.settings s limit 1;
  if v_row.starts_at - now() < make_interval(mins => v_cutoff) then
    raise exception 'It is too close to your time to change it online. Please call the shop.';
  end if;
  return v_row;
end
$$;

create function public.cancel_my_booking(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.appointments%rowtype := public.my_changeable_booking(p_id);
begin
  update public.appointments
  set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()), cancel_reason = 'Cancelled by customer'
  where id = v_row.id
  returning * into v_row;
  return public.booking_summary(v_row);
end
$$;

-- Move a booking: cancel the old one and book the new time in one go.
-- If the new time fails, nothing changes.
create function public.reschedule_my_booking(p_id uuid, p_barber uuid, p_starts_at timestamptz)
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

  v_new := public.create_appointment(v_old.customer_id, null, v_old.service_id, p_barber, p_starts_at, 'online');
  return public.booking_summary(v_new);
end
$$;

-- Data Privacy Act: a customer can ask to be forgotten. Upcoming bookings are
-- cancelled and the name and number are wiped. Past sales stay, with no name on them.
-- Removing the login itself is done by an Edge Function with the secret key.
create function public.delete_my_data()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid := public.my_customer_id();
begin
  if v_customer is null then
    raise exception 'Nothing to delete';
  end if;

  update public.appointments
  set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()), cancel_reason = 'Customer deleted their data'
  where customer_id = v_customer and status = 'booked';

  update public.customers
  set full_name = 'Deleted customer', mobile = null, auth_user_id = null, deleted_at = now()
  where id = v_customer;
end
$$;

-- ---------------------------------------------------------------------------
-- Shop actions (desk, barbers, owner)
-- ---------------------------------------------------------------------------

-- A booking taken over the phone or chat. Just a name, no account.
create function public.desk_book(p_guest_name text, p_service uuid, p_barber uuid, p_starts_at timestamptz)
returns jsonb
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
  if char_length(btrim(coalesce(p_guest_name, ''))) not between 2 and 80 then
    raise exception 'Enter the customer''s name';
  end if;
  v_row := public.create_appointment(null, btrim(p_guest_name), p_service, p_barber, p_starts_at, 'desk');
  return public.booking_summary(v_row);
end
$$;

-- A walk-in joins the queue now. Barber is optional ("next free barber").
create function public.add_walk_in(p_guest_name text, p_service uuid, p_barber uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_price integer;
  v_row   public.appointments%rowtype;
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

  insert into public.appointments
    (guest_name, service_id, barber_id, source, status, price_centavos, created_by, checked_in_at)
  values
    (btrim(p_guest_name), p_service, p_barber, 'walk_in', 'checked_in', v_price, (select auth.uid()), now())
  returning * into v_row;
  return public.booking_summary(v_row);
end
$$;

-- Internal: lock an appointment for a staff action and check who may touch it.
-- Desk and owner may act on any; a barber only on their own.
create function public.staff_appointment(p_id uuid)
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
  -- a barber may also take a waiting walk-in that has no barber yet
  if not public.is_front_desk()
     and v_row.barber_id is distinct from public.my_barber_id()
     and not (v_row.barber_id is null and v_row.status = 'checked_in') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return v_row;
end
$$;

-- The customer arrived.
create function public.check_in(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.appointments%rowtype := public.staff_appointment(p_id);
begin
  if v_row.status <> 'booked' then
    raise exception 'Only a booked appointment can be checked in';
  end if;
  if public.manila_date(v_row.starts_at) <> public.manila_today() then
    raise exception 'This booking is for another day';
  end if;
  update public.appointments set status = 'checked_in', checked_in_at = now()
  where id = v_row.id returning * into v_row;
  return public.booking_summary(v_row);
end
$$;

-- The customer sits in the chair. A walk-in gets its barber and time now,
-- and the no-overlap rule checks that barber isn't due for a booking.
create function public.start_service(p_id uuid, p_barber uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row      public.appointments%rowtype := public.staff_appointment(p_id);
  v_barber   uuid;
  v_duration integer;
begin
  if v_row.status <> 'checked_in' then
    raise exception 'Check the customer in first';
  end if;

  if v_row.source = 'walk_in' and v_row.starts_at is null then
    v_barber := coalesce(p_barber, v_row.barber_id, public.my_barber_id());
    if v_barber is null then
      raise exception 'Pick a barber';
    end if;
    -- a barber can only start a walk-in on their own chair
    if not public.is_front_desk() and v_barber is distinct from public.my_barber_id() then
      raise exception 'Not allowed' using errcode = '42501';
    end if;
    if not exists (select 1 from public.barbers b where b.id = v_barber and b.active) then
      raise exception 'That barber is not available';
    end if;
    select s.duration_minutes into v_duration from public.services s where s.id = v_row.service_id;
    begin
      update public.appointments
      set status = 'in_chair', barber_id = v_barber, starts_at = now(), ends_at = now() + make_interval(mins => v_duration)
      where id = v_row.id returning * into v_row;
    exception when exclusion_violation then
      raise exception 'That barber has a booking coming up. Pick another barber.';
    end;
  else
    update public.appointments set status = 'in_chair' where id = v_row.id returning * into v_row;
  end if;

  return public.booking_summary(v_row);
end
$$;

create function public.mark_no_show(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.appointments%rowtype := public.staff_appointment(p_id);
begin
  if not public.is_front_desk() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_row.status <> 'booked' then
    raise exception 'Only a booked appointment can be a no-show';
  end if;
  if v_row.starts_at > now() then
    raise exception 'It is not their time yet';
  end if;
  update public.appointments set status = 'no_show' where id = v_row.id returning * into v_row;
  return public.booking_summary(v_row);
end
$$;

create function public.cancel_appointment(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.appointments%rowtype := public.staff_appointment(p_id);
begin
  if not public.is_front_desk() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if v_row.status not in ('booked', 'checked_in') then
    raise exception 'This appointment can no longer be cancelled';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason';
  end if;
  update public.appointments
  set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()), cancel_reason = btrim(p_reason)
  where id = v_row.id returning * into v_row;
  return public.booking_summary(v_row);
end
$$;

-- The day's list for the shop app. Desk and owner see everyone with numbers;
-- a barber sees only their own chair (and waiting walk-ins), with no numbers.
create function public.queue_for_day(p_date date)
returns table (
  id uuid, code text, starts_at timestamptz, ends_at timestamptz, status text, source text,
  service_name text, barber_id uuid, barber_name text, customer_name text, customer_mobile text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_desk   boolean := public.is_front_desk();
  v_barber uuid := public.my_barber_id();
begin
  if not public.is_staff() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return query
  select a.id, a.code, a.starts_at, a.ends_at, a.status, a.source,
         s.name, a.barber_id, b.display_name,
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
    and (v_desk or a.barber_id = v_barber or (a.barber_id is null and a.status = 'checked_in'))
  order by coalesce(a.starts_at, a.checked_in_at);
end
$$;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

revoke all on public.appointments from public, anon, authenticated;
alter table public.appointments enable row level security;

-- close every new function first (Postgres gives functions to everyone by default)
revoke execute on function
  public.barber_is_free(uuid, timestamptz, timestamptz, uuid),
  public.list_free_slots(uuid, uuid, date, integer),
  public.get_free_slots(uuid, uuid, date),
  public.desk_free_slots(uuid, uuid, date),
  public.create_appointment(uuid, text, uuid, uuid, timestamptz, text),
  public.booking_summary(public.appointments),
  public.book_appointment(uuid, uuid, timestamptz),
  public.my_bookings(),
  public.my_changeable_booking(uuid),
  public.cancel_my_booking(uuid),
  public.reschedule_my_booking(uuid, uuid, timestamptz),
  public.delete_my_data(),
  public.desk_book(text, uuid, uuid, timestamptz),
  public.add_walk_in(text, uuid, uuid),
  public.staff_appointment(uuid),
  public.check_in(uuid),
  public.start_service(uuid, uuid),
  public.mark_no_show(uuid),
  public.cancel_appointment(uuid, text),
  public.queue_for_day(date)
from public, anon, authenticated;

-- Reads go through my_bookings and queue_for_day; direct reads are for the owner
-- (reports) and a customer's own rows. All writes go through the functions above.
grant select on public.appointments to authenticated;
create policy appointments_select on public.appointments for select to authenticated
  using (
    (select public.is_owner())
    or customer_id = (select public.my_customer_id())
  );

-- barber_is_free, list_free_slots, create_appointment, booking_summary,
-- my_changeable_booking and staff_appointment stay internal: no grant at all.

-- the one booking function signed-out visitors may call
grant execute on function public.get_free_slots(uuid, uuid, date) to anon, authenticated;
grant execute on function public.desk_free_slots(uuid, uuid, date) to authenticated;

grant execute on function public.book_appointment(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.my_bookings() to authenticated;
grant execute on function public.cancel_my_booking(uuid) to authenticated;
grant execute on function public.reschedule_my_booking(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.delete_my_data() to authenticated;
grant execute on function public.desk_book(text, uuid, uuid, timestamptz) to authenticated;
grant execute on function public.add_walk_in(text, uuid, uuid) to authenticated;
grant execute on function public.check_in(uuid) to authenticated;
grant execute on function public.start_service(uuid, uuid) to authenticated;
grant execute on function public.mark_no_show(uuid) to authenticated;
grant execute on function public.cancel_appointment(uuid, text) to authenticated;
grant execute on function public.queue_for_day(date) to authenticated;
