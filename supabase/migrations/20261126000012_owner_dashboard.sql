-- Owner dashboard: every number on the owner's home screen in one call.
-- Owner only. Voided sales and expenses never count. Days are Manila days.

create function public.owner_dashboard(p_days integer default 30)
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

  return jsonb_build_object(
    'days', p_days,
    'today', (
      select jsonb_build_object(
        'revenue_centavos', coalesce(sum(s.total_centavos), 0),
        'sales', count(*)
      )
      from public.sales s where s.voided_at is null and s.business_date = v_today
    ),
    'bookings_today', (
      select jsonb_build_object(
        'total', count(*) filter (where a.status not in ('cancelled', 'declined', 'requested')),
        'done', count(*) filter (where a.status = 'done'),
        'no_show', count(*) filter (where a.status = 'no_show')
      )
      from public.appointments a
      where public.manila_date(coalesce(a.starts_at, a.created_at)) = v_today
    ),
    'waiting_requests', (
      select count(*) from public.appointments a
      where a.starts_at > now() and (a.status = 'requested' or (a.status = 'booked' and a.cancel_requested_at is not null))
    ),
    'period', jsonb_build_object(
      'revenue_centavos', (select coalesce(sum(total_centavos), 0) from public.sales
                           where voided_at is null and business_date between v_from and v_today),
      'previous_centavos', (select coalesce(sum(total_centavos), 0) from public.sales
                            where voided_at is null and business_date between v_from - p_days and v_from - 1),
      'expenses_centavos', (select coalesce(sum(amount_centavos), 0) from public.expenses
                            where voided_at is null and spent_on between v_from and v_today),
      'sales', (select count(*) from public.sales where voided_at is null and business_date between v_from and v_today)
    ),
    -- one row per day, zero on quiet days, so the chart has no gaps
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object('day', d.day, 'revenue_centavos', coalesce(t.total, 0)) order by d.day), '[]')
      from generate_series(v_from, v_today, interval '1 day') as d(day)
      left join (
        select business_date, sum(total_centavos) as total from public.sales
        where voided_at is null and business_date between v_from and v_today group by business_date
      ) t on t.business_date = d.day::date
    ),
    'barbers', (
      select coalesce(jsonb_agg(row_to_json(x) order by x.revenue_centavos desc), '[]')
      from (
        select b.display_name as name, count(i.id) as services, coalesce(sum(i.line_total_centavos), 0) as revenue_centavos
        from public.barbers b
        left join public.sale_items i on i.barber_id = b.id and i.kind = 'service'
          and exists (select 1 from public.sales s where s.id = i.sale_id and s.voided_at is null
                        and s.business_date between v_from and v_today)
        where b.active
        group by b.id, b.display_name
      ) x
    ),
    'services', (
      select coalesce(jsonb_agg(row_to_json(x) order by x.count desc), '[]')
      from (
        select sv.name, count(*) as count
        from public.sale_items i
        join public.sales s on s.id = i.sale_id
        join public.services sv on sv.id = i.service_id
        where i.kind = 'service' and s.voided_at is null and s.business_date between v_from and v_today
        group by sv.name
        order by count(*) desc
        limit 5
      ) x
    ),
    'recent', (
      select coalesce(jsonb_agg(row_to_json(x) order by x.sold_at desc), '[]')
      from (
        select s.id, s.sold_at, s.total_centavos,
          (select string_agg(coalesce(sv.name, p.name), ', ')
             from public.sale_items i
             left join public.services sv on sv.id = i.service_id
             left join public.products p on p.id = i.product_id
            where i.sale_id = s.id) as items,
          (select b.display_name from public.sale_items i join public.barbers b on b.id = i.barber_id
            where i.sale_id = s.id and i.kind = 'service' limit 1) as barber,
          (select string_agg(distinct pm.method, ' + ') from public.payments pm
            where pm.sale_id = s.id and not pm.voided) as paid_by
        from public.sales s
        where s.voided_at is null
        order by s.sold_at desc
        limit 8
      ) x
    )
  );
end
$$;

revoke execute on function public.owner_dashboard(integer) from public, anon, authenticated;
grant execute on function public.owner_dashboard(integer) to authenticated;
