-- Migration 9: branch descriptions, branch reviews, and the contact form.
--
-- 1. Each branch gets a short description the owner writes.
-- 2. Customers can rate a branch (stars + an optional comment), but only after
--    a finished visit there. Same rules as barber reviews: one per customer per
--    branch, shown with the username only, and the owner can hide one with a reason.
-- 3. A contact form anyone can send (email and/or number, and a note). Messages are
--    stored for the owner and front desk to read. Nobody can read them back from the site.

-- ---------------------------------------------------------------------------
-- Branch description
-- ---------------------------------------------------------------------------

-- visitors already read branches straight from the table (active ones only),
-- so the new column is public like the name and address
alter table public.branches add column description text
  check (description is null or char_length(btrim(description)) between 10 and 600);

-- ---------------------------------------------------------------------------
-- Branch reviews
-- ---------------------------------------------------------------------------

-- No audit trigger: a removed review shouldn't live on in the log.
create table public.branch_reviews (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references public.branches (id),
  customer_id   uuid not null references public.customers (id),
  rating        smallint not null check (rating between 1 and 5),
  comment       text check (comment is null or char_length(comment) between 1 and 500),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  hidden_at     timestamptz,
  hidden_by     uuid references auth.users (id),
  hidden_reason text,
  unique (branch_id, customer_id)
);

alter table public.branch_reviews enable row level security;
revoke all on public.branch_reviews from public, anon, authenticated;
-- no direct access at all: everything goes through the functions below

-- star average and count for every active branch (hidden reviews don't count)
create function public.branch_ratings()
returns table (branch_id uuid, average numeric, reviews integer)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, round(avg(r.rating), 1), count(r.id)::integer
  from public.branches b
  left join public.branch_reviews r on r.branch_id = b.id and r.hidden_at is null
  where b.active
  group by b.id
$$;

-- did the signed-in customer finish a visit at this branch?
create function public.visited_branch(p_branch uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.my_customer_id() is not null and exists (
    select 1 from public.appointments a
    where a.branch_id = p_branch and a.customer_id = public.my_customer_id() and a.status = 'done'
  )
$$;

-- The newest reviews for one branch (username only, never the real name),
-- whether the caller may write one, and which one is theirs.
create function public.branch_reviews(p_branch uuid)
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
        from public.branch_reviews r
        join public.customers c on c.id = r.customer_id
        join public.branches b on b.id = r.branch_id
        where r.branch_id = p_branch and r.hidden_at is null and c.deleted_at is null and b.active
        order by r.created_at desc
        limit 50
      ) x
    ), '[]'::jsonb),
    'can_review', public.visited_branch(p_branch)
  )
$$;

-- write or change your review of a branch
create function public.review_branch(p_branch uuid, p_rating integer, p_comment text)
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
  if not public.visited_branch(p_branch) then
    raise exception 'You can review a branch after a visit there';
  end if;

  insert into public.branch_reviews (branch_id, customer_id, rating, comment)
  values (p_branch, v_customer, p_rating, v_comment)
  on conflict (branch_id, customer_id) do update
    set rating = excluded.rating, comment = excluded.comment, updated_at = now();

  return public.branch_reviews(p_branch);
end
$$;

create function public.remove_my_branch_review(p_branch uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.branch_reviews
  where branch_id = p_branch and customer_id = public.my_customer_id();
  return public.branch_reviews(p_branch);
end
$$;

-- Owner only: hide a branch review (it stays stored, with who hid it and why).
create function public.hide_branch_review(p_id uuid, p_reason text)
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
  update public.branch_reviews
  set hidden_at = now(), hidden_by = (select auth.uid()), hidden_reason = btrim(p_reason)
  where id = p_id;
end
$$;

-- deleting your data now removes your branch reviews too
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
  where customer_id = v_customer and status in ('requested', 'booked');

  delete from public.booking_inspo i using public.appointments a
  where a.id = i.appointment_id and a.customer_id = v_customer;
  delete from public.barber_reviews where customer_id = v_customer;
  delete from public.branch_reviews where customer_id = v_customer;

  update public.customers
  set full_name = 'Deleted customer', mobile = null, auth_user_id = null, deleted_at = now(),
      avatar_path = null, preferred_barber = null, promo_opt_in = false, promo_opt_in_at = null,
      username = null
  where id = v_customer;
end
$$;

-- ---------------------------------------------------------------------------
-- Contact form
-- ---------------------------------------------------------------------------

-- At least one way to reply (email or number), plus the note.
-- consented_at: the sender ticked "you may use these details to reply" (Data Privacy Act).
create table public.contact_messages (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid references public.branches (id),
  email        text check (email is null or (char_length(email) <= 254 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  mobile       text check (mobile is null or mobile ~ '^09[0-9]{9}$'),
  note         text not null check (char_length(note) between 5 and 1000),
  consented_at timestamptz not null,
  sent_by      uuid references auth.users (id), -- set when the sender was signed in
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  read_by      uuid references auth.users (id),
  check (email is not null or mobile is not null)
);

create index contact_messages_new on public.contact_messages (created_at desc);
create index contact_messages_email on public.contact_messages (email, created_at) where email is not null;
create index contact_messages_mobile on public.contact_messages (mobile, created_at) where mobile is not null;

alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from public, anon, authenticated;
-- no direct access: send with send_contact_message, read with contact_messages()

-- Anyone can send one. Simple flood guards: 3 an hour from the same email or number,
-- and 40 every 10 minutes for the whole shop (so a script can't fill the table).
create function public.send_contact_message(p_email text, p_mobile text, p_note text, p_branch uuid, p_consent boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email  text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_mobile text := nullif(btrim(coalesce(p_mobile, '')), '');
  v_note   text := btrim(coalesce(p_note, ''));
begin
  if not coalesce(p_consent, false) then
    raise exception 'Please agree to let us use your details to reply';
  end if;
  if v_mobile is not null then
    v_mobile := public.clean_mobile(v_mobile);
    if v_mobile is null then
      raise exception 'Enter a mobile number like 09171234567';
    end if;
  end if;
  if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Enter a valid email address';
  end if;
  if v_email is null and v_mobile is null then
    raise exception 'Leave an email or a mobile number so we can reply';
  end if;
  if char_length(v_note) < 5 then
    raise exception 'Write a short note (at least 5 characters)';
  end if;
  if char_length(v_note) > 1000 then
    raise exception 'Keep the note under 1000 characters';
  end if;
  if p_branch is not null and not exists (select 1 from public.branches b where b.id = p_branch and b.active) then
    raise exception 'That branch is not available';
  end if;

  if (
    select count(*) from public.contact_messages m
    where m.created_at > now() - interval '1 hour'
      and ((v_email is not null and m.email = v_email) or (v_mobile is not null and m.mobile = v_mobile))
  ) >= 3 then
    raise exception 'You already sent a few messages. Please wait an hour, or call the shop.';
  end if;
  if (select count(*) from public.contact_messages m where m.created_at > now() - interval '10 minutes') >= 40 then
    raise exception 'Too many messages right now. Please try again in a few minutes.';
  end if;

  insert into public.contact_messages (branch_id, email, mobile, note, consented_at, sent_by)
  values (p_branch, v_email, v_mobile, v_note, now(), (select auth.uid()));
end
$$;

-- Owner sees every message; the front desk sees its own branch's and the ones with no branch.
-- Newest first, the last 200.
create function public.contact_messages()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_front_desk() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x.item order by x.created_at desc)
    from (
      select m.created_at, jsonb_build_object(
        'id', m.id,
        'branch_id', m.branch_id,
        'branch', b.name,
        'email', m.email,
        'mobile', m.mobile,
        'note', m.note,
        'created_at', m.created_at,
        'read', m.read_at is not null
      ) as item
      from public.contact_messages m
      left join public.branches b on b.id = m.branch_id
      where public.is_owner() or m.branch_id is null or m.branch_id = public.my_branch_id()
      order by m.created_at desc
      limit 200
    ) x
  ), '[]'::jsonb);
end
$$;

-- mark a message read (or unread again)
create function public.mark_contact_message(p_id uuid, p_read boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_front_desk() then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  update public.contact_messages m
  set read_at = case when p_read then now() end,
      read_by = case when p_read then (select auth.uid()) end
  where m.id = p_id
    and (public.is_owner() or m.branch_id is null or m.branch_id = public.my_branch_id());
  if not found then
    raise exception 'Message not found';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Who may run what
-- ---------------------------------------------------------------------------

revoke execute on function
  public.branch_ratings(),
  public.visited_branch(uuid),
  public.branch_reviews(uuid),
  public.review_branch(uuid, integer, text),
  public.remove_my_branch_review(uuid),
  public.hide_branch_review(uuid, text),
  public.delete_my_data(),
  public.send_contact_message(text, text, text, uuid, boolean),
  public.contact_messages(),
  public.mark_contact_message(uuid, boolean)
from public, anon, authenticated;

-- anyone (signed in or not): branch stars and reviews, and the contact form
grant execute on function public.branch_ratings() to anon, authenticated;
grant execute on function public.branch_reviews(uuid) to anon, authenticated;
grant execute on function public.send_contact_message(text, text, text, uuid, boolean) to anon, authenticated;

-- signed in
grant execute on function public.visited_branch(uuid) to authenticated;
grant execute on function public.review_branch(uuid, integer, text) to authenticated;
grant execute on function public.remove_my_branch_review(uuid) to authenticated;
grant execute on function public.hide_branch_review(uuid, text) to authenticated;
grant execute on function public.delete_my_data() to authenticated;
grant execute on function public.contact_messages() to authenticated;
grant execute on function public.mark_contact_message(uuid, boolean) to authenticated;
