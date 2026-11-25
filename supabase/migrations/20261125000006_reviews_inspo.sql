-- Migration 6: usernames, barber reviews and favourites, and inspo photos/videos on bookings.

-- ---------------------------------------------------------------------------
-- Usernames
-- ---------------------------------------------------------------------------

-- Lowercase letters, numbers, dot and underscore, 3 to 20 long. Shown on reviews
-- instead of the customer's real name. Older profiles may have none.
alter table public.customers add column username text
  constraint customers_username_format check (username is null or username ~ '^[a-z0-9._]{3,20}$');

-- one person per username (deleted customers free theirs up)
create unique index customers_username_key on public.customers (username) where deleted_at is null;

create function public.clean_username(p_username text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when lower(btrim(coalesce(p_username, ''))) ~ '^[a-z0-9._]{3,20}$'
    then lower(btrim(p_username)) end
$$;

-- Names nobody should be able to take, so a customer can't pose as the shop.
create function public.username_reserved(p_username text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_username in ('admin', 'owner', 'staff', 'desk', 'barber', 'support', 'help', 'trimmed', 'shop', 'root', 'system')
$$;

-- For the sign-up form: is this username free? Says nothing else about anyone.
create function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.clean_username(p_username) is not null
    and not public.username_reserved(public.clean_username(p_username))
    and not exists (
      select 1 from public.customers c
      where c.username = public.clean_username(p_username) and c.deleted_at is null
        and c.auth_user_id is distinct from (select auth.uid())
    )
$$;

-- The profile save now takes a username too. The old 3-value version stays so
-- an older copy of the app keeps working until it reloads.
create function public.save_my_profile(p_username text, p_full_name text, p_mobile text, p_consent boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := public.clean_username(p_username);
  v_id       uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if v_username is null then
    raise exception 'Pick a username: 3 to 20 letters, numbers, dots or underscores';
  end if;
  if public.username_reserved(v_username) or not public.username_available(v_username) then
    raise exception 'That username is taken. Try another.';
  end if;

  -- name, number and consent rules live in the original function
  v_id := public.save_my_profile(p_full_name, p_mobile, p_consent);
  update public.customers set username = v_username where id = v_id;
  return v_id;
end
$$;

create or replace function public.my_profile()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', c.id,
    'username', c.username,
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

-- ---------------------------------------------------------------------------
-- Favourite barber: one tap on the star. null clears it.
-- ---------------------------------------------------------------------------

create function public.set_favourite_barber(p_barber uuid)
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
  if p_barber is not null and not exists (select 1 from public.barbers b where b.id = p_barber and b.active) then
    raise exception 'That barber is not available';
  end if;
  update public.customers set preferred_barber = p_barber where id = v_customer;
  return public.my_profile();
end
$$;

-- ---------------------------------------------------------------------------
-- Reviews
-- ---------------------------------------------------------------------------

-- One review per customer per barber, which they can change or remove.
-- Only someone who actually had a cut from that barber can leave one.
-- No audit trigger here: a removed review shouldn't live on in the log.
create table public.barber_reviews (
  id            uuid primary key default gen_random_uuid(),
  barber_id     uuid not null references public.barbers (id),
  customer_id   uuid not null references public.customers (id),
  rating        smallint not null check (rating between 1 and 5),
  comment       text check (comment is null or char_length(comment) between 1 and 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- the owner can hide a rude or fake review, with a reason
  hidden_at     timestamptz,
  hidden_by     uuid references auth.users (id),
  hidden_reason text,
  unique (barber_id, customer_id)
);
alter table public.barber_reviews enable row level security;
-- no direct access at all: everything goes through the functions below

-- star average and count for every active barber (hidden reviews don't count)
create function public.barber_ratings()
returns table (barber_id uuid, average numeric, reviews integer)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, round(avg(r.rating), 1), count(r.id)::integer
  from public.barbers b
  left join public.barber_reviews r on r.barber_id = b.id and r.hidden_at is null
  where b.active
  group by b.id
$$;

-- Everything the barber page needs: the newest reviews (username only, never
-- the real name), the caller's own review, and whether they may write one.
create function public.barber_reviews(p_barber uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reviews', coalesce((
      select jsonb_agg(x.review order by x.created_at desc)
      from (
        select r.created_at, jsonb_build_object(
          'id', r.id,
          'rating', r.rating,
          'comment', r.comment,
          'created_at', r.created_at,
          'edited', r.updated_at > r.created_at + interval '1 minute',
          'username', c.username,
          'mine', coalesce(c.id = public.my_customer_id(), false)
        ) as review
        from public.barber_reviews r
        join public.customers c on c.id = r.customer_id
        where r.barber_id = p_barber and r.hidden_at is null and c.deleted_at is null
        order by r.created_at desc
        limit 50
      ) x
    ), '[]'::jsonb),
    'can_review', public.my_customer_id() is not null and exists (
      select 1 from public.appointments a
      where a.barber_id = p_barber and a.customer_id = public.my_customer_id() and a.status = 'done'
    )
  )
$$;

create function public.review_barber(p_barber uuid, p_rating integer, p_comment text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_customer uuid := public.my_customer_id();
  v_comment  text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if v_customer is null then
    raise exception 'Finish your profile first' using errcode = '42501';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'Pick 1 to 5 stars';
  end if;
  if char_length(v_comment) > 500 then
    raise exception 'Keep the comment under 500 characters';
  end if;
  if not exists (
    select 1 from public.appointments a
    where a.barber_id = p_barber and a.customer_id = v_customer and a.status = 'done'
  ) then
    raise exception 'You can review a barber after your cut with them';
  end if;

  insert into public.barber_reviews (barber_id, customer_id, rating, comment)
  values (p_barber, v_customer, p_rating, v_comment)
  on conflict (barber_id, customer_id) do update
    set rating = excluded.rating, comment = excluded.comment, updated_at = now();

  return public.barber_reviews(p_barber);
end
$$;

create function public.remove_my_review(p_barber uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.barber_reviews
  where barber_id = p_barber and customer_id = public.my_customer_id();
  return public.barber_reviews(p_barber);
end
$$;

-- Owner only: hide a review (it stays stored, with who hid it and why).
create function public.hide_review(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_owner() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason';
  end if;
  update public.barber_reviews
  set hidden_at = now(), hidden_by = (select auth.uid()), hidden_reason = btrim(p_reason)
  where id = p_id;
end
$$;

-- ---------------------------------------------------------------------------
-- Inspo: photos or short videos a customer adds to a booking for the barber
-- ---------------------------------------------------------------------------

-- Files live in the private "inspo" bucket under <customer login id>/...
-- The free plan has 1 GB of storage in total, so: at most 3 files a booking,
-- 25 MB each (the app also shrinks photos and caps videos at 30 seconds).
create table public.booking_inspo (
  id             uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments (id),
  path           text not null unique,
  kind           text not null check (kind in ('image', 'video')),
  created_at     timestamptz not null default now()
);
create index booking_inspo_appointment on public.booking_inspo (appointment_id);
alter table public.booking_inspo enable row level security;
-- no direct access: through the functions below

create function public.add_booking_inspo(p_appointment uuid, p_path text, p_kind text)
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
    where a.id = p_appointment and a.customer_id = v_customer and a.status = 'booked' and a.starts_at > now()
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

-- Returns the file path so the app can delete the file itself.
create function public.remove_booking_inspo(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_path text;
begin
  delete from public.booking_inspo i
  using public.appointments a
  where i.id = p_id and a.id = i.appointment_id and a.customer_id = public.my_customer_id()
  returning i.path into v_path;
  if v_path is null then
    raise exception 'Not found';
  end if;
  return v_path;
end
$$;

-- Who may see a booking's inspo: the customer, the desk and owner, and the barber on it.
create function public.can_see_booking(p_appointment uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.appointments a
    where a.id = p_appointment
      and (
        a.customer_id = public.my_customer_id()
        or public.is_front_desk()
        or (a.barber_id is not null and a.barber_id = public.my_barber_id())
      )
  )
$$;

create function public.booking_inspo(p_appointment uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.can_see_booking(p_appointment) then coalesce((
    select jsonb_agg(jsonb_build_object('id', i.id, 'path', i.path, 'kind', i.kind) order by i.created_at)
    from public.booking_inspo i where i.appointment_id = p_appointment
  ), '[]'::jsonb) else '[]'::jsonb end
$$;

-- Used by the storage rule below: may the caller open this inspo file?
create function public.can_see_inspo_file(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.booking_inspo i
    where i.path = p_path and public.can_see_booking(i.appointment_id)
  )
$$;

-- Moving a booking makes a new booking row, so the inspo moves with it.
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
  update public.appointments
  set status = 'cancelled', cancelled_at = now(), cancelled_by = (select auth.uid()), cancel_reason = 'Moved by customer'
  where id = v_old.id;

  v_new := public.create_appointment(v_old.customer_id, null, v_old.service_id, p_barber, p_starts_at, 'online');
  update public.booking_inspo set appointment_id = v_new.id where appointment_id = v_old.id;
  return public.booking_summary(v_new);
end
$$;

-- Deleting your data now also removes your username, reviews and inspo records.
-- (The app deletes the photo and inspo files from storage first.)
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
-- Storage: the private inspo bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inspo', 'inspo', false, 26214400,
        array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do nothing;

-- customers upload and delete only in their own folder;
-- the desk, owner and the booking's barber can also open the file
create policy inspo_select on storage.objects for select to authenticated
  using (
    bucket_id = 'inspo'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.can_see_inspo_file(name))
  );
create policy inspo_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'inspo' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy inspo_delete on storage.objects for delete to authenticated
  using (bucket_id = 'inspo' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------------
-- Access rules
-- ---------------------------------------------------------------------------

revoke all on public.barber_reviews, public.booking_inspo from public, anon, authenticated;

revoke execute on function
  public.clean_username(text),
  public.username_reserved(text),
  public.username_available(text),
  public.save_my_profile(text, text, text, boolean),
  public.my_profile(),
  public.set_favourite_barber(uuid),
  public.barber_ratings(),
  public.barber_reviews(uuid),
  public.review_barber(uuid, integer, text),
  public.remove_my_review(uuid),
  public.hide_review(uuid, text),
  public.add_booking_inspo(uuid, text, text),
  public.remove_booking_inspo(uuid),
  public.can_see_booking(uuid),
  public.booking_inspo(uuid),
  public.can_see_inspo_file(text),
  public.reschedule_my_booking(uuid, uuid, timestamptz),
  public.delete_my_data()
from public, anon, authenticated;

-- anyone (signed in or not): check a username, see star ratings and reviews
grant execute on function public.username_available(text) to anon, authenticated;
grant execute on function public.barber_ratings() to anon, authenticated;
grant execute on function public.barber_reviews(uuid) to anon, authenticated;

-- signed in
grant execute on function public.save_my_profile(text, text, text, boolean) to authenticated;
grant execute on function public.my_profile() to authenticated;
grant execute on function public.set_favourite_barber(uuid) to authenticated;
grant execute on function public.review_barber(uuid, integer, text) to authenticated;
grant execute on function public.remove_my_review(uuid) to authenticated;
grant execute on function public.hide_review(uuid, text) to authenticated;
grant execute on function public.add_booking_inspo(uuid, text, text) to authenticated;
grant execute on function public.remove_booking_inspo(uuid) to authenticated;
grant execute on function public.booking_inspo(uuid) to authenticated;
grant execute on function public.can_see_inspo_file(text) to authenticated;
grant execute on function public.reschedule_my_booking(uuid, uuid, timestamptz) to authenticated;
grant execute on function public.delete_my_data() to authenticated;
