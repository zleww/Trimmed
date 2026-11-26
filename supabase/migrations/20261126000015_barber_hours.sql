-- A barber only gets free times inside their own working hours (barber_hours).
-- Barbers added from the staff app had none, so nobody could book them.
-- Now: a new barber starts with their branch's opening hours, barbers with no
-- hours get them now, and the owner can change them in one call.

-- New barber: copy the branch's opening hours as a starting point.
create function public.default_barber_hours()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.barber_hours (barber_id, weekday, starts_at, ends_at)
  select new.id, h.weekday, h.opens_at, h.closes_at
  from public.shop_hours h
  where h.branch_id = new.branch_id
  on conflict (barber_id, weekday) do nothing;
  return new;
end
$$;

create trigger barbers_default_hours
after insert on public.barbers
for each row execute function public.default_barber_hours();

-- Barbers who have no hours at all (made before this fix) get their branch's hours.
insert into public.barber_hours (barber_id, weekday, starts_at, ends_at)
select b.id, h.weekday, h.opens_at, h.closes_at
from public.barbers b
join public.shop_hours h on h.branch_id = b.branch_id
where not exists (select 1 from public.barber_hours x where x.barber_id = b.id)
on conflict (barber_id, weekday) do nothing;

-- Replace a barber's whole week at once. Owner only.
-- p_hours: [{"weekday": 1, "starts_at": "10:00", "ends_at": "19:00"}, ...]
-- A day that isn't in the list is a day off.
create function public.set_barber_hours(p_barber uuid, p_hours jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day   jsonb;
  v_dow   integer;
  v_start time;
  v_end   time;
begin
  if not public.is_owner() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.barbers b where b.id = p_barber) then
    raise exception 'Barber not found';
  end if;
  if jsonb_typeof(p_hours) is distinct from 'array' then
    raise exception 'Hours are not in the right format';
  end if;

  delete from public.barber_hours where barber_id = p_barber;

  for v_day in select * from jsonb_array_elements(p_hours) loop
    begin
      v_dow   := (v_day ->> 'weekday')::integer;
      v_start := (v_day ->> 'starts_at')::time;
      v_end   := (v_day ->> 'ends_at')::time;
    exception when others then
      raise exception 'Hours are not in the right format';
    end;
    if v_dow is null or v_dow not between 0 and 6 or v_start is null or v_end is null then
      raise exception 'Hours are not in the right format';
    end if;
    if v_end <= v_start then
      raise exception 'Each day must end after it starts';
    end if;
    begin
      insert into public.barber_hours (barber_id, weekday, starts_at, ends_at)
      values (p_barber, v_dow, v_start, v_end);
    exception when unique_violation then
      raise exception 'Each day can only be listed once';
    end;
  end loop;
end
$$;

revoke execute on function public.default_barber_hours() from public, anon, authenticated;
revoke execute on function public.set_barber_hours(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_barber_hours(uuid, jsonb) to authenticated;
