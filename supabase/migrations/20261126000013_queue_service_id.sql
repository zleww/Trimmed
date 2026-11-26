-- The desk screen records a sale straight from the queue, so each row now
-- also says which service it is (the id) and the price it was booked at.
-- Same rules as before: desk and owner see everyone at their branch (owner: all),
-- a barber sees only their own chair and waiting walk-ins, with no phone numbers.

drop function public.queue_for_day(date);
create function public.queue_for_day(p_date date)
returns table (
  id uuid, code text, starts_at timestamptz, ends_at timestamptz, status text, source text,
  service_id uuid, service_name text, price_centavos integer,
  branch_id uuid, barber_id uuid, barber_name text, customer_name text, customer_mobile text
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
         a.service_id, s.name, a.price_centavos,
         a.branch_id, a.barber_id, b.display_name,
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

revoke execute on function public.queue_for_day(date) from public, anon, authenticated;
grant execute on function public.queue_for_day(date) to authenticated;
