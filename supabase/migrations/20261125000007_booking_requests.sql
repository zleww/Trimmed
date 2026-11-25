-- Migration 7: online bookings become requests that the shop confirms.
--
-- A customer's booking starts as "requested". The time is held for them, so
-- nobody else can take it, until the owner or the front desk confirms it
-- ("booked") or declines it with a reason ("declined"). Bookings the desk makes
-- for someone on the phone, and walk-ins, are confirmed straight away.

-- ---------------------------------------------------------------------------
-- New statuses and who confirmed
-- ---------------------------------------------------------------------------

alter table public.appointments drop constraint appointments_status_check;
alter table public.appointments add constraint appointments_status_check
  check (status in ('requested', 'booked', 'checked_in', 'in_chair', 'done', 'cancelled', 'declined', 'no_show'));

alter table public.appointments
  add column confirmed_at timestamptz,
  add column confirmed_by uuid;

-- a request holds its time too: same barber, overlapping time = refused
alter table public.appointments drop constraint appointments_no_overlap;
alter table public.appointments add constraint appointments_no_overlap exclude using gist (
  barber_id with =,
  tstzrange(starts_at, ends_at) with &&
) where (status in ('requested', 'booked', 'checked_in', 'in_chair', 'done') and barber_id is not null and starts_at is not null);

-- ---------------------------------------------------------------------------
-- Free time: a waiting request takes the slot
-- ---------------------------------------------------------------------------

create or replace function public.barber_is_free(p_barber uuid, p_start timestamptz, p_end timestamptz, p_ignore uuid default null)
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

-- Online bookings now start as a request; desk bookings and walk-ins are confirmed.
create or replace function public.create_appointment(
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
        and a.status in ('requested', 'booked', 'checked_in', 'in_chair', 'done')
        and public.manila_date(a.starts_at) = public.manila_date(p_starts_at)
    ), b.sort, b.id
    limit 1;
  end if;

  begin
    insert into public.appointments
      (customer_id, guest_name, service_id, barber_id, starts_at, ends_at, source, status, price_centavos, created_by,
       confirmed_at, confirmed_by)
    values
      (p_customer, p_guest_name, p_service, v_barber, p_starts_at, v_end, p_source,
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

-- The summary now carries the shop's reason when a request is declined.
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
    'barber_id', a.barber_id,
    'barber', (select b.display_name from public.barbers b where b.id = a.barber_id),
    'price_centavos', a.price_centavos,
    'reason', case when a.status = 'declined' then a.cancel_reason end
  )
$$;

-- ---------------------------------------------------------------------------
-- Customer side: requests count toward the limits and can be cancelled or moved
-- ---------------------------------------------------------------------------

create or replace function public.book_appointment(p_service uuid, p_barber uuid, p_starts_at timestamptz)
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

  v_row := public.create_appointment(v_customer, null, p_service, p_barber, p_starts_at, 'online');
  return public.booking_summary(v_row);
end
$$;

-- A waiting request can be cancelled or moved any time before it starts.
-- A confirmed booking keeps the cut-off (the shop has planned around it).
create or replace function public.my_changeable_booking(p_id uuid)
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
  if v_row.status not in ('requested', 'booked') or v_row.starts_at <= now() then
    raise exception 'This booking can no longer be changed';
  end if;
  if v_row.status = 'booked' then
    select s.cancel_cutoff_minutes into v_cutoff from public.settings s limit 1;
    if v_row.starts_at - now() < make_interval(mins => v_cutoff) then
      raise exception 'It is too close to your time to change it online. Please call the shop.';
    end if;
  end if;
  return v_row;
end
$$;

create or replace function public.add_booking_inspo(p_appointment uuid, p_path text, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid := public.my_customer_id();
  v_row      public.booking_inspo%rowtype;
begin
  if v_customer is null then
    raise exception 'Finish your profile first' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.appointments a
    where a.id = p_appointment and a.customer_id = v_customer and a.status in ('requested', 'booked') and a.starts_at > now()
  ) then
    raise exception 'You can add inspo to your own upcoming bookings';
  end if;
  -- only a file inside your own folder
  if p_path is null or split_part(p_path, '/', 1) <> (select auth.uid())::text then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_kind not in ('image', 'video') then
    raise exception 'Use a photo or a video';
  end if;
  if (select count(*) from public.booking_inspo i where i.appointment_id = p_appointment) >= 3 then
    raise exception 'Up to 3 photos or videos per booking';
  end if;

  insert into public.booking_inspo (appointment_id, path, kind)
  values (p_appointment, p_path, p_kind)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'path', v_row.path, 'kind', v_row.kind);
end
$$;

create or replace function public.delete_my_data()
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
  where customer_id = v_customer and status in ('requested', 'booked');

  delete from public.booking_inspo i using public.appointments a
  where a.id = i.appointment_id and a.customer_id = v_customer;
  delete from public.barber_reviews where customer_id = v_customer;

  update public.customers
  set full_name = 'Deleted customer', mobile = null, auth_user_id = null, deleted_at = now(),
      avatar_path = null, preferred_barber = null, promo_opt_in = false, promo_opt_in_at = null,
      username = null
  where id = v_customer;
end
$$;

-- ---------------------------------------------------------------------------
-- Shop side: the owner or front desk confirms or declines
-- ---------------------------------------------------------------------------

-- Upcoming requests, soonest first, with what the desk needs to decide:
-- who, their number, how many times they came, and how many times they didn't show.
create function public.booking_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    left join public.barbers b on b.id = a.barber_id
    join public.customers c on c.id = a.customer_id
    where a.status = 'requested' and a.starts_at > now()
  ), '[]'::jsonb);
end
$$;

-- Internal: a request the desk may still act on.
create function public.waiting_request(p_id uuid)
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
  if v_row.status <> 'requested' then
    raise exception 'This request was already answered or cancelled';
  end if;
  if v_row.starts_at <= now() then
    raise exception 'This request has expired';
  end if;
  return v_row;
end
$$;

create function public.confirm_booking(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.appointments%rowtype := public.waiting_request(p_id);
begin
  update public.appointments
  set status = 'booked', confirmed_at = now(), confirmed_by = (select auth.uid())
  where id = v_row.id
  returning * into v_row;
  return public.booking_summary(v_row);
end
$$;

-- The reason is shown to the customer, so it should be polite and short.
create function public.decline_booking(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    public.appointments%rowtype := public.waiting_request(p_id);
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) not between 3 and 200 then
    raise exception 'Give the customer a short reason (3 to 200 characters)';
  end if;
  update public.appointments
  set status = 'declined', cancelled_at = now(), cancelled_by = (select auth.uid()), cancel_reason = v_reason
  where id = v_row.id
  returning * into v_row;
  return public.booking_summary(v_row);
end
$$;

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

revoke execute on function
  public.barber_is_free(uuid, timestamptz, timestamptz, uuid),
  public.create_appointment(uuid, text, uuid, uuid, timestamptz, text),
  public.booking_summary(public.appointments),
  public.book_appointment(uuid, uuid, timestamptz),
  public.my_changeable_booking(uuid),
  public.add_booking_inspo(uuid, text, text),
  public.delete_my_data(),
  public.booking_requests(),
  public.waiting_request(uuid),
  public.confirm_booking(uuid),
  public.decline_booking(uuid, text)
from public, anon, authenticated;

grant execute on function public.book_appointment(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.add_booking_inspo(uuid, text, text) to authenticated;
grant execute on function public.delete_my_data() to authenticated;
grant execute on function public.booking_requests() to authenticated;
grant execute on function public.confirm_booking(uuid) to authenticated;
grant execute on function public.decline_booking(uuid, text) to authenticated;
