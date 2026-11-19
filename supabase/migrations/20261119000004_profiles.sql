-- Trimmed profiles: customer photo and app settings, barber photos, and the
-- public shop hours for the booking site.
--
-- Photos live in Supabase Storage. Customer photos are private: only the
-- customer can read or change their own folder. Barber photos are public
-- because the booking site shows them; only the owner can change them.

-- ---------------------------------------------------------------------------
-- Customer profile and settings
-- ---------------------------------------------------------------------------

alter table public.customers
  -- "<auth user id>/<file name>" inside the private avatars bucket
  add column avatar_path      text check (avatar_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$'),
  add column preferred_barber uuid references public.barbers (id),
  add column theme            text not null default 'dark' check (theme in ('dark', 'light', 'system')),
  add column time_format      text not null default '12h' check (time_format in ('12h', '24h')),
  -- promos need their own yes, separate from the booking consent (Data Privacy Act)
  add column promo_opt_in     boolean not null default false,
  add column promo_opt_in_at  timestamptz;

create function public.my_profile()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'full_name', c.full_name,
    'mobile', c.mobile,
    'avatar_path', c.avatar_path,
    'preferred_barber', c.preferred_barber,
    'theme', c.theme,
    'time_format', c.time_format,
    'promo_opt_in', c.promo_opt_in,
    'member_since', c.created_at
  )
  from public.customers c
  where c.auth_user_id = (select auth.uid()) and c.deleted_at is null
$$;

create function public.save_my_settings(p_theme text, p_time_format text, p_preferred_barber uuid, p_promo_opt_in boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid := public.my_customer_id();
begin
  if v_customer is null then
    raise exception 'Finish your profile first' using errcode = '42501';
  end if;
  if p_theme not in ('dark', 'light', 'system') or p_time_format not in ('12h', '24h') then
    raise exception 'Unknown setting';
  end if;
  if p_preferred_barber is not null and not exists (select 1 from public.barbers b where b.id = p_preferred_barber and b.active) then
    raise exception 'That barber is not available';
  end if;

  update public.customers
  set theme = p_theme,
      time_format = p_time_format,
      preferred_barber = p_preferred_barber,
      promo_opt_in_at = case when p_promo_opt_in and not promo_opt_in then now() when not p_promo_opt_in then null else promo_opt_in_at end,
      promo_opt_in = coalesce(p_promo_opt_in, false)
  where id = v_customer;

  return public.my_profile();
end
$$;

-- The app uploads the file to avatars/<user id>/..., then saves the path here.
-- null removes the photo.
create function public.set_my_avatar(p_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid := public.my_customer_id();
begin
  if v_customer is null then
    raise exception 'Finish your profile first' using errcode = '42501';
  end if;
  -- only a file inside your own folder
  if p_path is not null and split_part(p_path, '/', 1) <> (select auth.uid())::text then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.customers set avatar_path = p_path where id = v_customer;
  return public.my_profile();
end
$$;

-- Deleting your data now also clears the photo path and the promo choice.
-- (The app removes the photo file itself first; the policy below allows that.)
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
  where customer_id = v_customer and status = 'booked';

  update public.customers
  set full_name = 'Deleted customer', mobile = null, auth_user_id = null, deleted_at = now(),
      avatar_path = null, preferred_barber = null, promo_opt_in = false, promo_opt_in_at = null
  where id = v_customer;
end
$$;

-- The booking summary now also carries the service and barber ids, so the app
-- can open "move this booking" on the right service.
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
    'price_centavos', a.price_centavos
  )
$$;

-- my_bookings now returns one JSON list (newest first), which the app reads
-- more simply than a set of rows.
drop function public.my_bookings();
create function public.my_bookings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.booking_summary(a) order by a.starts_at desc), '[]'::jsonb)
  from public.appointments a
  where a.customer_id = public.my_customer_id()
$$;

-- ---------------------------------------------------------------------------
-- Barbers on the booking site
-- ---------------------------------------------------------------------------

alter table public.barbers
  add column photo_path text check (char_length(photo_path) <= 200),
  add column bio        text check (char_length(bio) <= 160);

-- Opening hours for the booking site. Nothing private.
create function public.public_shop_hours()
returns table (weekday smallint, opens_at time, closes_at time)
language sql
stable
security definer
set search_path = ''
as $$
  select h.weekday, h.opens_at, h.closes_at from public.shop_hours h order by h.weekday
$$;

-- ---------------------------------------------------------------------------
-- Storage buckets and their rules
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp']),
  ('barber-photos', 'barber-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- avatars: a customer can only see and change files in their own folder
create policy avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- barber photos: anyone can view (public bucket), only the owner uploads
create policy barber_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'barber-photos' and (select public.is_owner()));
create policy barber_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'barber-photos' and (select public.is_owner()))
  with check (bucket_id = 'barber-photos' and (select public.is_owner()));
create policy barber_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'barber-photos' and (select public.is_owner()));

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

-- booking_summary stays internal (create or replace keeps its old grants: none)
revoke execute on function
  public.booking_summary(public.appointments),
  public.my_bookings(),
  public.my_profile(),
  public.save_my_settings(text, text, uuid, boolean),
  public.set_my_avatar(text),
  public.delete_my_data(),
  public.public_shop_hours()
from public, anon, authenticated;

grant execute on function public.my_bookings() to authenticated;
grant execute on function public.my_profile() to authenticated;
grant execute on function public.save_my_settings(text, text, uuid, boolean) to authenticated;
grant execute on function public.set_my_avatar(text) to authenticated;
grant execute on function public.delete_my_data() to authenticated;
grant execute on function public.public_shop_hours() to anon, authenticated;
