-- Fix: signed-out visitors couldn't read services or barbers.
--
-- The old rule was "active or is_staff()". A rule runs as the person asking,
-- and signed-out visitors aren't allowed to run is_staff(), so the whole read
-- failed with "permission denied". Found by checking the live project.
--
-- Now visitors get their own simple rule (active only, no function call),
-- and signed-in people keep the old one.

drop policy services_select on public.services;
drop policy barbers_select on public.barbers;

create policy services_select_visitor on public.services for select to anon
  using (active);
create policy services_select_signed_in on public.services for select to authenticated
  using (active or (select public.is_staff()));

create policy barbers_select_visitor on public.barbers for select to anon
  using (active);
create policy barbers_select_signed_in on public.barbers for select to authenticated
  using (active or (select public.is_staff()));
