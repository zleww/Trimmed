-- Migration 11: customers can sign in with their username instead of their email.
--
-- Supabase Auth signs in with an email, so the username has to be turned into one.
-- That must never happen in the browser: usernames are public (they show on reviews),
-- so a public "username -> email" lookup would hand out everyone's email address.
-- Instead the "username-sign-in" Edge Function does it on Supabase's side with the
-- secret key, and only these functions, callable by nothing but that key, can see emails.
--
-- Wrong tries are counted here. Every username sign-in reaches Supabase Auth from the
-- function's address, not the visitor's, so Supabase's own per-visitor limit can't
-- protect these accounts: 5 wrong tries per username or 20 per visitor in 15 minutes,
-- then a 15 minute wait. Signing in with the email still works as before.

create table public.login_failures (
  id         bigint generated always as identity primary key,
  username   text not null,
  ip         text, -- the visitor's address, kept one day only, just for the limit
  created_at timestamptz not null default now()
);

create index login_failures_username on public.login_failures (username, created_at);
create index login_failures_ip on public.login_failures (ip, created_at) where ip is not null;

alter table public.login_failures enable row level security;
revoke all on public.login_failures from public, anon, authenticated;
-- no policies: nobody reads this from the site

-- The email for a username, if sign-in may be tried now. null = no such customer.
-- Raises when there were too many wrong tries.
create function public.login_email(p_username text, p_ip text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := public.clean_username(p_username);
begin
  if v_username is null then
    return null;
  end if;
  if (
    select count(*) from public.login_failures f
    where f.username = v_username and f.created_at > now() - interval '15 minutes'
  ) >= 5 or (
    p_ip is not null and (
      select count(*) from public.login_failures f
      where f.ip = p_ip and f.created_at > now() - interval '15 minutes'
    ) >= 20
  ) then
    raise exception 'Too many tries. Wait 15 minutes, or sign in with your email.';
  end if;
  return (
    select u.email from public.customers c
    join auth.users u on u.id = c.auth_user_id
    where c.username = v_username and c.deleted_at is null
  );
end
$$;

-- count a wrong try (and forget old ones, so addresses aren't kept)
create function public.note_login_failure(p_username text, p_ip text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.login_failures where created_at < now() - interval '1 day';
  insert into public.login_failures (username, ip)
  values (coalesce(public.clean_username(p_username), left(lower(btrim(coalesce(p_username, ''))), 40)), left(p_ip, 64));
$$;

-- a good sign-in wipes that username's wrong tries
create function public.clear_login_failures(p_username text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.login_failures where username = public.clean_username(p_username);
$$;

revoke execute on function
  public.login_email(text, text),
  public.note_login_failure(text, text),
  public.clear_login_failures(text)
from public, anon, authenticated;

-- only the Edge Function's secret key may run these
grant execute on function public.login_email(text, text) to service_role;
grant execute on function public.note_login_failure(text, text) to service_role;
grant execute on function public.clear_login_failures(text) to service_role;
