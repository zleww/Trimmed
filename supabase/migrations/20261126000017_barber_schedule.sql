-- A barber's own coming bookings, today and the next days, so they can see
-- who booked them and open the inspo before the customer arrives.
-- Confirmed bookings and requests still waiting for the desk.
-- No phone numbers: the desk handles contact.

create function public.barber_schedule(p_days integer default 14)
returns table (
  id uuid, code text, starts_at timestamptz, ends_at timestamptz, status text, source text,
  service_name text, customer_name text, branch_name text,
  confirmed_at timestamptz, created_at timestamptz, inspo integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_barber uuid := public.my_barber_id();
begin
  if v_barber is null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_days is null or p_days not between 1 and 31 then
    raise exception 'Pick 1 to 31 days';
  end if;

  return query
  select a.id, a.code, a.starts_at, a.ends_at, a.status, a.source,
         s.name, coalesce(c.full_name, a.guest_name), br.name,
         a.confirmed_at, a.created_at,
         (select count(*)::integer from public.booking_inspo i where i.appointment_id = a.id)
  from public.appointments a
  join public.services s on s.id = a.service_id
  left join public.customers c on c.id = a.customer_id
  left join public.branches br on br.id = a.branch_id
  where a.barber_id = v_barber
    and a.status in ('requested', 'booked', 'checked_in', 'in_chair')
    and a.starts_at is not null
    and a.ends_at > now()
    and public.manila_date(a.starts_at) < public.manila_today() + p_days
  order by a.starts_at;
end
$$;

revoke execute on function public.barber_schedule(integer) from public, anon, authenticated;
grant execute on function public.barber_schedule(integer) to authenticated;
