-- Attendance: barbers and front desk clock in and out of their shift.
-- The owner sees every shift and can fix a wrong one (with a reason).
-- No location check (decided with the owner): the log is for review, not proof.
-- Nothing is deleted; every change lands in the audit log.

create table public.shifts (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references public.staff (id),
  branch_id  uuid references public.branches (id),
  clock_in   timestamptz not null default now(),
  clock_out  timestamptz,
  fixed_at   timestamptz,
  fixed_by   uuid references auth.users (id),
  fix_reason text check (char_length(fix_reason) <= 200),
  constraint shifts_order check (clock_out is null or clock_out > clock_in),
  -- one person can't be on two shifts at the same time (also: only one open shift)
  constraint shifts_no_overlap exclude using gist (
    staff_id with =,
    tstzrange(clock_in, coalesce(clock_out, 'infinity'::timestamptz)) with &&
  )
);

create index shifts_clock_in_idx on public.shifts (clock_in);

create trigger audit_shifts after insert or update or delete on public.shifts
for each row execute function public.audit_row();

-- The caller's role, only for barbers and desk (the owner doesn't clock in).
create function public.my_clock_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_staff() then s.role end
  from public.staff s
  where s.id = (select auth.uid()) and s.role in ('barber', 'desk')
$$;

-- Clock in now, at the branch this login works at.
create function public.clock_in()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.shifts%rowtype;
begin
  if public.my_clock_role() is null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.shifts s where s.staff_id = (select auth.uid()) and s.clock_out is null) then
    raise exception 'You are already clocked in';
  end if;
  insert into public.shifts (staff_id, branch_id) values ((select auth.uid()), public.my_branch_id())
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'clock_in', v_row.clock_in);
end
$$;

-- Clock out of the open shift.
create function public.clock_out()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.shifts%rowtype;
begin
  if public.my_clock_role() is null then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.shifts set clock_out = now()
  where staff_id = (select auth.uid()) and clock_out is null
  returning * into v_row;
  if v_row.id is null then
    raise exception 'You are not clocked in';
  end if;
  return jsonb_build_object('id', v_row.id, 'clock_in', v_row.clock_in, 'clock_out', v_row.clock_out);
end
$$;

-- The caller's own shifts that touch today (Manila), plus any open one.
-- null for anyone who doesn't clock in (owner, customers).
create function public.my_shifts_today()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.my_clock_role() is null then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'clock_in', s.clock_in, 'clock_out', s.clock_out) order by s.clock_in)
    from public.shifts s
    where s.staff_id = (select auth.uid())
      and (s.clock_out is null or public.manila_date(s.clock_in) = public.manila_today() or public.manila_date(s.clock_out) = public.manila_today())
  ), '[]'::jsonb);
end
$$;

-- Every shift that started between two Manila dates (up to 3 months). Owner only.
create function public.attendance(p_from date, p_to date)
returns table (
  id uuid, staff_id uuid, full_name text, role text, branch_id uuid, branch_name text,
  clock_in timestamptz, clock_out timestamptz, minutes integer,
  fixed_at timestamptz, fix_reason text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception 'Pick a range of up to 3 months';
  end if;
  return query
  select sh.id, sh.staff_id, st.full_name, st.role, sh.branch_id, br.name,
         sh.clock_in, sh.clock_out,
         case when sh.clock_out is not null then (extract(epoch from sh.clock_out - sh.clock_in) / 60)::integer end,
         sh.fixed_at, sh.fix_reason
  from public.shifts sh
  join public.staff st on st.id = sh.staff_id
  left join public.branches br on br.id = sh.branch_id
  where public.manila_date(sh.clock_in) between p_from and p_to
  order by sh.clock_in desc;
end
$$;

-- Fix a shift: a forgotten clock-out, a wrong time. Owner only, always with a reason.
-- p_out null leaves the shift open.
create function public.fix_shift(p_id uuid, p_in timestamptz, p_out timestamptz, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 200 then
    raise exception 'Give a reason (3 to 200 characters)';
  end if;
  if p_in is null or p_in > now() or (p_out is not null and p_out > now()) then
    raise exception 'Times can''t be in the future';
  end if;
  if p_out is not null and p_out <= p_in then
    raise exception 'Clock-out must be after clock-in';
  end if;
  begin
    update public.shifts
    set clock_in = p_in, clock_out = p_out,
        fixed_at = now(), fixed_by = (select auth.uid()), fix_reason = btrim(p_reason)
    where id = p_id;
  exception when exclusion_violation then
    raise exception 'That overlaps another shift of the same person';
  end;
  if not found then
    raise exception 'Shift not found';
  end if;
end
$$;

-- Access: no direct table access at all; everything goes through the functions.
revoke all on public.shifts from public, anon, authenticated;
alter table public.shifts enable row level security;

revoke execute on function
  public.my_clock_role(),
  public.clock_in(),
  public.clock_out(),
  public.my_shifts_today(),
  public.attendance(date, date),
  public.fix_shift(uuid, timestamptz, timestamptz, text)
from public, anon, authenticated;

grant execute on function public.clock_in() to authenticated;
grant execute on function public.clock_out() to authenticated;
grant execute on function public.my_shifts_today() to authenticated;
grant execute on function public.attendance(date, date) to authenticated;
grant execute on function public.fix_shift(uuid, timestamptz, timestamptz, text) to authenticated;
