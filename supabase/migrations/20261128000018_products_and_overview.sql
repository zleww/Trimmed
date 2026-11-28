-- 1. Products: category, size, a short description and a photo.
--    Customers can browse them (stock shown as a status, never the count)
--    and buy at the shop. The front desk can now receive deliveries too.
-- 2. The owner's home screen: today against last week, walk-ins, completed,
--    a month calendar of appointments, quick insights, and CSV exports.

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------

alter table public.products
  add column category    text not null default 'Styling' check (category in ('Styling', 'Hair care', 'Beard care', 'Tools', 'Other')),
  add column size        text check (char_length(size) <= 30),
  add column description text check (char_length(description) <= 200),
  add column photo_path  text check (char_length(photo_path) <= 200);

-- the owner edits these too (the policies still say owner only)
grant insert (category, size, description, photo_path) on public.products to authenticated;
grant update (category, size, description, photo_path) on public.products to authenticated;

-- product photos: anyone can view (public bucket), only the owner uploads
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-photos', 'product-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy product_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos' and (select public.is_owner()));
create policy product_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'product-photos' and (select public.is_owner()))
  with check (bucket_id = 'product-photos' and (select public.is_owner()));
create policy product_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'product-photos' and (select public.is_owner()));

-- For the booking site (signed out too): what's for sale and whether it's in.
-- Stock is a status only: 'in_stock', 'low' or 'out'. Exact counts stay with the shop.
create function public.public_products()
returns table (
  id uuid, name text, category text, size text, description text,
  price_centavos integer, photo_path text, stock_status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.name, p.category, p.size, p.description, p.price_centavos, p.photo_path,
         case when p.stock_qty = 0 then 'out'
              when p.stock_qty <= p.low_stock_at then 'low'
              else 'in_stock' end
  from public.products p
  where p.active
  order by p.category, p.name
$$;

-- A delivery came in: the owner or the front desk adds it.
-- (Selling takes stock out through record_sale; fixing a count stays owner only.)
create or replace function public.stock_in(p_product uuid, p_qty integer, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qty integer;
begin
  if not public.is_front_desk() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if p_qty is null or p_qty not between 1 and 1000 then
    raise exception 'Quantity must be 1 to 1000';
  end if;
  update public.products set stock_qty = stock_qty + p_qty where id = p_product and active returning stock_qty into v_qty;
  if v_qty is null then
    raise exception 'Product not found';
  end if;
  insert into public.stock_movements (product_id, change, reason, note, created_by)
  values (p_product, p_qty, 'stock_in', nullif(btrim(p_note), ''), (select auth.uid()));
  return v_qty;
end
$$;

-- ---------------------------------------------------------------------------
-- Owner: today at a glance and quick insights
-- ---------------------------------------------------------------------------

create function public.owner_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := public.manila_today();
  v_week  date := v_today - ((extract(isodow from v_today)::integer) - 1); -- this Monday
begin
  if not public.is_owner() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'today', (
      select jsonb_build_object(
        -- appointments that are on (not waiting, declined or cancelled)
        'appointments', count(*) filter (where public.manila_date(coalesce(a.starts_at, a.checked_in_at)) = v_today
                                           and a.status in ('booked', 'checked_in', 'in_chair', 'done', 'no_show')),
        'last_week', count(*) filter (where public.manila_date(coalesce(a.starts_at, a.checked_in_at)) = v_today - 7
                                        and a.status in ('booked', 'checked_in', 'in_chair', 'done', 'no_show')),
        'walk_ins', count(*) filter (where public.manila_date(coalesce(a.starts_at, a.checked_in_at)) = v_today
                                       and a.source = 'walk_in' and a.status not in ('cancelled', 'declined')),
        'completed', count(*) filter (where public.manila_date(coalesce(a.starts_at, a.checked_in_at)) = v_today and a.status = 'done'),
        'in_chair', count(*) filter (where a.status = 'in_chair'),
        'waiting', count(*) filter (where a.status = 'checked_in'),
        'no_shows', count(*) filter (where public.manila_date(a.starts_at) = v_today and a.status = 'no_show')
      )
      from public.appointments a
      where coalesce(a.starts_at, a.checked_in_at) >= public.manila_at(v_today - 7, '00:00')
    ),
    'insights', jsonb_build_object(
      -- the hour with the most finished cuts in the last 30 days (0-23, Manila)
      'busiest_hour', (
        select extract(hour from a.starts_at at time zone 'Asia/Manila')::integer
        from public.appointments a
        where a.status = 'done' and a.starts_at >= now() - interval '30 days'
        group by 1 order by count(*) desc, 1 limit 1),
      -- 0 = Sunday
      'busiest_weekday', (
        select extract(dow from a.starts_at at time zone 'Asia/Manila')::integer
        from public.appointments a
        where a.status = 'done' and a.starts_at >= now() - interval '30 days'
        group by 1 order by count(*) desc, 1 limit 1),
      'top_barber_week', (
        select jsonb_build_object('name', b.display_name, 'cuts', count(*))
        from public.appointments a join public.barbers b on b.id = a.barber_id
        where a.status = 'done' and public.manila_date(a.starts_at) between v_week and v_today
        group by b.display_name order by count(*) desc, b.display_name limit 1),
      -- no-shows out of everyone who was due, last 30 days (percent, 0-100)
      'no_show_rate', (
        select case when count(*) = 0 then null
                    else round(100.0 * count(*) filter (where a.status = 'no_show') / count(*)) end
        from public.appointments a
        where a.status in ('done', 'no_show') and a.starts_at >= now() - interval '30 days'),
      -- customers this month who had come before (percent)
      'returning_rate', (
        with this_month as (
          select distinct a.customer_id from public.appointments a
          where a.customer_id is not null and a.status = 'done'
            and public.manila_date(a.starts_at) >= date_trunc('month', v_today)::date)
        select case when count(*) = 0 then null
                    else round(100.0 * count(*) filter (where exists (
                      select 1 from public.appointments p
                      where p.customer_id = m.customer_id and p.status = 'done'
                        and public.manila_date(p.starts_at) < date_trunc('month', v_today)::date)) / count(*)) end
        from this_month m),
      'average_sale_centavos', (
        select round(avg(s.total_centavos))::integer from public.sales s
        where s.voided_at is null and s.business_date > v_today - 30),
      'low_stock', (select count(*) from public.products p where p.active and p.stock_qty > 0 and p.stock_qty <= p.low_stock_at),
      'out_of_stock', (select count(*) from public.products p where p.active and p.stock_qty = 0)
    )
  );
end
$$;

-- Appointments per day for one month, for the calendar. Owner only.
create function public.appointment_calendar(p_month date)
returns table (day date, total integer, done integer, walk_ins integer, requests integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_first date := date_trunc('month', p_month)::date;
begin
  if not public.is_owner() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query
  select d::date,
         count(a.id) filter (where a.status in ('booked', 'checked_in', 'in_chair', 'done', 'no_show'))::integer,
         count(a.id) filter (where a.status = 'done')::integer,
         count(a.id) filter (where a.source = 'walk_in' and a.status not in ('cancelled', 'declined'))::integer,
         count(a.id) filter (where a.status = 'requested')::integer
  from generate_series(v_first, (v_first + interval '1 month - 1 day')::date, interval '1 day') d
  left join public.appointments a on public.manila_date(coalesce(a.starts_at, a.checked_in_at)) = d::date
  group by d
  order by d;
end
$$;

-- ---------------------------------------------------------------------------
-- Owner: CSV exports (the app turns these rows into a file)
-- ---------------------------------------------------------------------------

create function public.export_sales(p_from date, p_to date)
returns table (
  sold_at timestamptz, business_date date, items text, barbers text, paid_with text,
  subtotal_centavos integer, discount_centavos integer, total_centavos integer, tips_centavos integer,
  voided boolean, recorded_by text
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
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'Pick a range of up to a year';
  end if;
  return query
  select s.sold_at, s.business_date,
         (select string_agg(coalesce(sv.name, pr.name) || case when i.qty > 1 then ' x' || i.qty else '' end, '; ' order by i.kind desc)
          from public.sale_items i
          left join public.services sv on sv.id = i.service_id
          left join public.products pr on pr.id = i.product_id
          where i.sale_id = s.id),
         (select string_agg(distinct b.display_name, '; ')
          from public.sale_items i join public.barbers b on b.id = i.barber_id where i.sale_id = s.id),
         (select string_agg(p.method || coalesce(' ' || p.reference, ''), '; ') from public.payments p where p.sale_id = s.id),
         s.subtotal_centavos, s.discount_centavos, s.total_centavos, s.tips_centavos,
         s.voided_at is not null, st.full_name
  from public.sales s
  join public.staff st on st.id = s.recorded_by
  where s.business_date between p_from and p_to
  order by s.sold_at;
end
$$;

create function public.export_appointments(p_from date, p_to date)
returns table (
  starts_at timestamptz, code text, customer text, mobile text, service text, barber text,
  branch text, source text, status text, price_centavos integer
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
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'Pick a range of up to a year';
  end if;
  return query
  select coalesce(a.starts_at, a.checked_in_at), a.code, coalesce(c.full_name, a.guest_name), c.mobile,
         sv.name, b.display_name, br.name, a.source, a.status, a.price_centavos
  from public.appointments a
  join public.services sv on sv.id = a.service_id
  left join public.customers c on c.id = a.customer_id
  left join public.barbers b on b.id = a.barber_id
  left join public.branches br on br.id = a.branch_id
  where public.manila_date(coalesce(a.starts_at, a.checked_in_at)) between p_from and p_to
  order by coalesce(a.starts_at, a.checked_in_at);
end
$$;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

revoke execute on function
  public.public_products(),
  public.owner_overview(),
  public.appointment_calendar(date),
  public.export_sales(date, date),
  public.export_appointments(date, date)
from public, anon, authenticated;

grant execute on function public.public_products() to anon, authenticated;
grant execute on function public.owner_overview() to authenticated;
grant execute on function public.appointment_calendar(date) to authenticated;
grant execute on function public.export_sales(date, date) to authenticated;
grant execute on function public.export_appointments(date, date) to authenticated;
