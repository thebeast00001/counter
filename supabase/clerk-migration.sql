-- Counter — migrate Row Level Security from Supabase Auth to Clerk.
--
-- Run this once in the SQL editor, AFTER adding Clerk as a Third-Party Auth
-- provider in the Supabase dashboard. Safe to re-run.
--
-- ## Why anything has to change at all
--
-- The policies deployed with `schema.sql` are written against `auth.uid()`,
-- which reads the subject claim of a *Supabase-issued* JWT and returns a uuid.
-- With Clerk issuing the token there is no Supabase user, `auth.uid()` returns
-- null, and every policy silently matches nothing — the backup would fail with
-- a row-level-security error on every single write, and no amount of correct
-- app code would fix it.
--
-- So two things change together, and neither works without the other:
--
--   1. **`owner_id` becomes `text`.** A Clerk user id looks like
--      `user_2abc123…` — it is not a uuid and never will be. The column also
--      loses its foreign key to `auth.users`, because with Clerk there is no
--      row in that table to point at.
--   2. **Policies read `auth.jwt() ->> 'sub'`** instead of `auth.uid()`. That is
--      the Clerk user id, as a string, taken from the verified token.
--
-- The child tables never referenced `auth.uid()` directly — they reach it
-- through `businesses` — but their policies are recreated anyway so the whole
-- set is provably consistent rather than partly migrated.
--
-- ## The check that matters afterwards
--
-- `with check` is preserved on every policy. `using` governs which rows you can
-- see; `with check` governs what you may write. A policy with only `using` lets
-- any signed-in account insert rows carrying somebody else's business_id.

begin;

-- ---------------------------------------------------------------- businesses --
alter table businesses drop constraint if exists businesses_owner_id_fkey;
alter table businesses alter column owner_id type text using owner_id::text;

drop policy if exists "own business" on businesses;
create policy "own business" on businesses
  for all
  using (owner_id = auth.jwt() ->> 'sub')
  with check (owner_id = auth.jwt() ->> 'sub');

drop policy if exists "own rows" on parties;
create policy "own rows" on parties
  for all
  using (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'))
  with check (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'));

drop policy if exists "own rows" on engagements;
create policy "own rows" on engagements
  for all
  using (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'))
  with check (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'));

drop policy if exists "own rows" on money;
create policy "own rows" on money
  for all
  using (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'))
  with check (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'));

drop policy if exists "own rows" on commitments;
create policy "own rows" on commitments
  for all
  using (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'))
  with check (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'));

drop policy if exists "own rows" on offerings;
create policy "own rows" on offerings
  for all
  using (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'))
  with check (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'));

drop policy if exists "own rows" on staff;
create policy "own rows" on staff
  for all
  using (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'))
  with check (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'));

drop policy if exists "own rows" on templates;
create policy "own rows" on templates
  for all
  using (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'))
  with check (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'));

drop policy if exists "own rows" on obligations;
create policy "own rows" on obligations
  for all
  using (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'))
  with check (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'));

drop policy if exists "own rows" on facts;
create policy "own rows" on facts
  for all
  using (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'))
  with check (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'));

drop policy if exists "own rows" on events;
create policy "own rows" on events
  for all
  using (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'))
  with check (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'));

drop policy if exists "own rows" on actions;
create policy "own rows" on actions
  for all
  using (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'))
  with check (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'));

drop policy if exists "own rows" on rules;
create policy "own rows" on rules
  for all
  using (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'))
  with check (business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub'));

commit;

-- ------------------------------------------------------------------ check it --
-- Both of these must come back empty. The first finds tables anyone holding the
-- publishable key could read; the second finds policies still looking for a
-- Supabase user that Clerk will never create.
--
--   select tablename from pg_tables
--   where schemaname = 'public' and rowsecurity = false;
--
--   select tablename, policyname from pg_policies
--   where schemaname = 'public'
--     and (qual like '%auth.uid()%' or with_check like '%auth.uid()%');
