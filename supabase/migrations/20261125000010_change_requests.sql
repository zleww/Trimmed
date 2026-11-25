-- Migration 10: once the shop confirms a booking, the customer can't undo it alone.
--
-- Moving a confirmed booking: the new time is a request (it holds its seat), and the
--   confirmed booking stays exactly as it is until the front desk confirms the new time.
--   Confirmed: the old booking is cancelled. Declined: nothing changes, the old one stands.
-- Cancelling a confirmed booking: the customer asks, the booking stays until the desk
--   agrees (cancelled) or keeps it (with a short reason the customer sees).
--   The customer can take the ask back ("keep my booking") while it waits.
-- A request that was never confirmed can still be cancelled or moved straight away.

alter table public.appointments
  -- this request is a new time for that confirmed booking
  add column replaces_id         uuid references public.appointments (id),
  -- the customer asked to cancel this confirmed booking
  add column cancel_requested_at timestamptz,
  -- the shop's reason when it kept the booking instead
  add column cancel_answer       text check (cancel_answer is null or char_length(cancel_answer) between 3 and 200);

create index appointments_replaces on public.appointments (replaces_id) where replaces_id is not null;
create index appointments_cancel_asks on public.appointments (cancel_requested_at) where cancel_requested_at is not null;

-- What the customer sees about a booking now also says what's waiting on the shop.
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
    'reason', case when a.status = 'declined' then a.cancel_reason end,
    'cancel_requested', a.status = 'booked' and a.cancel_requested_at is not null,
    'cancel_answer', case when a.status = 'booked' then a.cancel_answer end,
    -- on a move request: the confirmed time it would replace
    'replaces_starts_at', (select o.starts_at from public.appointments o where o.id = a.replaces_id),
    -- on a confirmed booking: the new time asked for, while the shop decides
    'moving_to', (
      select n.starts_at from public.appointments n
      where n.replaces_id = a.id and n.status = 'requested' and n.starts_at > now()
      order by n.created_at desc limit 1
    )
  )
$$;

-- Customer: cancel. A waiting request goes at once; a confirmed booking becomes an ask.
create or replace function public.cancel_my_booking(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.appointments%rowtype := public.my_changeable_booking(p_id);
begin
  if v_row.status = 'requested' then
    update public.appointments
    set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()), cancel_reason = 'Cancelled by customer'
    where id = v_row.id
    returning * into v_row;
    return public.booking_summary(v_row);
  end if;

  if v_row.cancel_requested_at is not null then
    raise exception 'You already asked to cancel this booking. The shop will answer soon.';
  end if;
  -- wanting out beats wanting a new time: drop a waiting move
  update public.appointments
  set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()), cancel_reason = 'Customer asked to cancel instead'
  where replaces_id = v_row.id and status = 'requested';

  update public.appointments
  set cancel_requested_at = now(), cancel_answer = null
  where id = v_row.id
  returning * into v_row;
  return public.booking_summary(v_row);
end
$$;

-- Customer: take back a cancel ask while the shop hasn't answered.
create function public.keep_my_booking(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.appointments%rowtype;
begin
  select * into v_row from public.appointments a
  where a.id = p_id and a.customer_id = public.my_customer_id()
  for update;
  if v_row.id is null then
    raise exception 'Booking not found';
  end if;
  if v_row.status <> 'booked' or v_row.cancel_requested_at is null then
    raise exception 'There is no cancel request on this booking';
  end if;
  update public.appointments set cancel_requested_at = null where id = v_row.id returning * into v_row;
  return public.booking_summary(v_row);
end
$$;

-- Customer: move. A waiting request is replaced at once. A confirmed booking stays
-- and the new time waits for the shop; asking again replaces the earlier ask.
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
  if v_old.status = 'requested' then
    update public.appointments
    set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()), cancel_reason = 'Moved by customer'
    where id = v_old.id;
    v_new := public.create_appointment(v_old.customer_id, null, v_old.service_id, v_old.branch_id, p_barber, p_starts_at, 'online');
    -- a move of a move still points at the confirmed booking
    update public.appointments set replaces_id = v_old.replaces_id where id = v_new.id returning * into v_new;
    update public.booking_inspo set appointment_id = v_new.id where appointment_id = v_old.id;
    return public.booking_summary(v_new);
  end if;

  if v_old.cancel_requested_at is not null then
    raise exception 'You asked to cancel this booking. Keep it first if you want to move it.';
  end if;
  update public.appointments
  set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()), cancel_reason = 'Customer picked another time'
  where replaces_id = v_old.id and status = 'requested';

  v_new := public.create_appointment(v_old.customer_id, null, v_old.service_id, v_old.branch_id, p_barber, p_starts_at, 'online');
  update public.appointments set replaces_id = v_old.id where id = v_new.id returning * into v_new;
  return public.booking_summary(v_new);
end
$$;

-- Desk: confirming a move also cancels the booking it replaces, and the inspo comes along.
create or replace function public.confirm_booking(p_id uuid)
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

  if v_row.replaces_id is not null then
    update public.appointments
    set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()), cancel_reason = 'Moved by customer'
    where id = v_row.replaces_id and status = 'booked';
    update public.booking_inspo set appointment_id = v_row.id where appointment_id = v_row.replaces_id;
  end if;
  return public.booking_summary(v_row);
end
$$;

-- a confirmed booking with a cancel ask, for the desk of its branch
create function public.waiting_cancel(p_id uuid)
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
  if v_row.status <> 'booked' or v_row.cancel_requested_at is null then
    raise exception 'This request was already answered or taken back';
  end if;
  return v_row;
end
$$;

-- Desk: agree to cancel.
create function public.approve_cancel(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.appointments%rowtype := public.waiting_cancel(p_id);
begin
  update public.appointments
  set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()), cancel_reason = 'Cancelled by customer'
  where id = v_row.id
  returning * into v_row;
  return public.booking_summary(v_row);
end
$$;

-- Desk: keep the booking, with a short polite reason the customer sees.
create function public.refuse_cancel(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    public.appointments%rowtype := public.waiting_cancel(p_id);
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if char_length(v_reason) not between 3 and 200 then
    raise exception 'Give the customer a short reason (3 to 200 characters)';
  end if;
  update public.appointments
  set cancel_requested_at = null, cancel_answer = v_reason
  where id = v_row.id
  returning * into v_row;
  return public.booking_summary(v_row);
end
$$;

-- Desk list: new requests, moves (with the time they'd replace) and cancel asks, soonest first.
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
      'kind', case when a.status = 'booked' then 'cancel' when a.replaces_id is not null then 'move' else 'new' end,
      'code', a.code,
      'starts_at', a.starts_at,
      'ends_at', a.ends_at,
      'replaces_starts_at', o.starts_at,
      'service', s.name,
      'price_centavos', a.price_centavos,
      'branch_id', a.branch_id,
      'branch', br.name,
      'barber_id', a.barber_id,
      'barber', b.display_name,
      'customer', c.full_name,
      'username', c.username,
      'mobile', c.mobile,
      'requested_at', coalesce(a.cancel_requested_at, a.created_at),
      'visits', (select count(*) from public.appointments x where x.customer_id = c.id and x.status = 'done'),
      'no_shows', (select count(*) from public.appointments x where x.customer_id = c.id and x.status = 'no_show'),
      'inspo', (select count(*) from public.booking_inspo i where i.appointment_id = coalesce(a.replaces_id, a.id))
    ) order by a.starts_at)
    from public.appointments a
    join public.services s on s.id = a.service_id
    join public.branches br on br.id = a.branch_id
    left join public.barbers b on b.id = a.barber_id
    left join public.appointments o on o.id = a.replaces_id
    join public.customers c on c.id = a.customer_id
    where a.starts_at > now()
      and (a.status = 'requested' or (a.status = 'booked' and a.cancel_requested_at is not null))
      and (v_owner or a.branch_id = v_branch)
  ), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- Who may run what
-- ---------------------------------------------------------------------------

revoke execute on function
  public.booking_summary(public.appointments),
  public.cancel_my_booking(uuid),
  public.keep_my_booking(uuid),
  public.reschedule_my_booking(uuid, uuid, timestamptz),
  public.confirm_booking(uuid),
  public.waiting_cancel(uuid),
  public.approve_cancel(uuid),
  public.refuse_cancel(uuid, text),
  public.booking_requests()
from public, anon, authenticated;

grant execute on function public.cancel_my_booking(uuid) to authenticated;
grant execute on function public.keep_my_booking(uuid) to authenticated;
grant execute on function public.reschedule_my_booking(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.confirm_booking(uuid) to authenticated;
grant execute on function public.approve_cancel(uuid) to authenticated;
grant execute on function public.refuse_cancel(uuid, text) to authenticated;
grant execute on function public.booking_requests() to authenticated;
