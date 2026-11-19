-- Stand-in for the parts of Supabase the migrations use, so the real migration
-- files can run on a plain in-memory Postgres during tests.

create role anon nologin;
create role authenticated nologin;

-- Supabase keeps extensions in their own schema
create schema extensions;

create schema auth;
create table auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

-- Supabase reads the signed-in user's id from the request token.
-- Tests set the same setting by hand to act as a user.
create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- the whole token; "aal" says if the two-step code was entered
create function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

-- authenticator apps people set up for two-step sign-in
create table auth.mfa_factors (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  status  text not null default 'unverified'
);

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
grant execute on function auth.jwt() to anon, authenticated;
grant usage on schema public to anon, authenticated;
grant usage on schema extensions to anon, authenticated;

-- Supabase gives these roles full access to new things in "public" by default.
-- Copying that here proves the migrations really close it again.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
