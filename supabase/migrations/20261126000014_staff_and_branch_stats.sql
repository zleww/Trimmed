-- Owner tools: the staff list (with each login's email), editing a staff
-- member's name and branch, and numbers per branch.
-- New logins are made by the staff-admin Edge Function (it needs the secret key).

-- Everyone who works here, newest first. Owner only.
create function public.staff_list()
returns table (
  id uuid, full_name text, role text, email text, active boolean,
  branch_id uuid, branch_name text, barber_id uuid, created_at timestamptz
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
  return query
  select s.id, s.full_name, s.role, u.email::text, s.active,
         coalesce(s.branch_id, b.branch_id), br.name, s.barber_id, s.created_at
  from public.staff s
  join auth.users u on u.id = s.id
  left join public.barbers b on b.id = s.barber_id
  left join public.branches br on br.id = coalesce(s.branch_id, b.branch_id)
  order by s.active desc, s.created_at desc;
end
$$;

-- Rename someone or move them to another branch. A barber's chair moves with them.
create function public.update_staff(p_id uuid, p_full_name text, p_branch uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff%rowtype;
begin
  if not public.is_owner() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select * into v_row from public.staff s where s.id = p_id for update;
  if v_row.id is null then
    raise exception 'Staff member not found';
  end if;
  if char_length(btrim(coalesce(p_full_name, ''))) not between 2 and 80 then
    raise exception 'Enter their full name';
  end if;
  if p_branch is not null and not exists (select 1 from public.branches b where b.id = p_branch and b.active) then
    raise exception 'That branch is not open';
  end if;
  if v_row.role = 'desk' and p_branch is null then
    raise exception 'Pick the branch they work at';
  end if;

  update public.staff
  set full_name = btrim(p_full_name),
      branch_id = case when v_row.role = 'owner' then null else p_branch end
  where id = p_id;

  if v_row.barber_id is not null and p_branch is not null then
    update public.barbers set branch_id = p_branch, display_name = btrim(p_full_name) where id = v_row.barber_id;
  end if;
end
$$;

-- How each branch is doing over the last 7, 30 or 90 days. Owner only.
-- A sale belongs to the branch of its booking; a sale without one (a pomade
-- sold over the counter) belongs to the branch of the person who recorded it.
create function public.branch_stats(p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := public.manila_today();
  v_from  date;
begin
  if not public.is_owner() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_days is null or p_days not in (7, 30, 90) then
    raise exception 'Pick 7, 30 or 90 days';
  end if;
  v_from := v_today - (p_days - 1);

  return coalesce((
    with sale_branch as (
      select s.total_centavos, s.business_date,
             coalesce(a.branch_id, st.branch_id, b.branch_id) as branch_id
      from public.sales s
      left join public.appointments a on a.id = s.appointment_id
      left join public.staff st on st.id = s.recorded_by
      left join public.barbers b on b.id = st.barber_id
      where s.voided_at is null and s.business_date between v_from - p_days and v_today
    )
    select jsonb_agg(jsonb_build_object(
      'id', br.id,
      'name', br.name,
      'revenue_centavos', (select coalesce(sum(x.total_centavos), 0) from sale_branch x
                           where x.branch_id = br.id and x.business_date >= v_from),
      'previous_centavos', (select coalesce(sum(x.total_centavos), 0) from sale_branch x
                            where x.branch_id = br.id and x.business_date < v_from),
      'sales', (select count(*) from sale_branch x where x.branch_id = br.id and x.business_date >= v_from),
      'done', (select count(*) from public.appointments a where a.branch_id = br.id and a.status = 'done'
                 and public.manila_date(coalesce(a.starts_at, a.checked_in_at)) between v_from and v_today),
      'no_shows', (select count(*) from public.appointments a where a.branch_id = br.id and a.status = 'no_show'
                     and public.manila_date(a.starts_at) between v_from and v_today),
      'cancelled', (select count(*) from public.appointments a where a.branch_id = br.id and a.status = 'cancelled'
                      and public.manila_date(coalesce(a.starts_at, a.checked_in_at)) between v_from and v_today),
      'barbers', (select count(*) from public.barbers b where b.branch_id = br.id and b.active)
    ) order by br.sort, br.name)
    from public.branches br
    where br.active
  ), '[]');
end
$$;

revoke execute on function
  public.staff_list(),
  public.update_staff(uuid, text, uuid),
  public.branch_stats(integer)
from public, anon, authenticated;

grant execute on function public.staff_list() to authenticated;
grant execute on function public.update_staff(uuid, text, uuid) to authenticated;
grant execute on function public.branch_stats(integer) to authenticated;
