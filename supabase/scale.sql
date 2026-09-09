-- Counter — making row-level security cheap at scale.
--
-- Run after `clerk-migration.sql`. Safe to re-run.
--
-- ## The problem this solves
--
-- Every policy currently reads:
--
--   business_id in (select id from businesses where owner_id = auth.jwt() ->> 'sub')
--
-- That subquery is correct, and Postgres may re-evaluate `auth.jwt()` per row.
-- On a table with one business's records it is free. Across every tenant's
-- engagements it is the difference between an index scan and a sequential one,
-- and it degrades exactly as the product succeeds — which is the worst shape a
-- performance problem can have, because it is invisible until it is urgent.
--
-- Two changes, and the second matters more than the first:
--
--   1. **`(select auth.jwt() ->> 'sub')`** — wrapping it in a scalar subquery
--      lets the planner evaluate it *once per statement* instead of once per
--      row. This is a documented Supabase optimisation and it is close to free.
--   2. **A `stable` helper** so the business lookup is cached within a
--      statement rather than repeated, and every policy reads the same way.

create or replace function public.current_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from businesses where owner_id = (select auth.jwt() ->> 'sub');
$$;

comment on function public.current_business_ids() is
  'Business ids owned by the caller. STABLE so the planner evaluates it once per statement rather than once per row.';

-- `security definer` bypasses RLS *inside the function*, which is why its body
-- is narrow and its search_path is pinned: it can only ever return ids matching
-- the caller''s own subject claim.
revoke all on function public.current_business_ids() from public;
grant execute on function public.current_business_ids() to authenticated, anon;

-- ------------------------------------------------------------------ indexes --
-- The lookup the function performs, and the join every policy depends on.
create index if not exists businesses_owner_idx on businesses (owner_id);

do $$
declare t text;
begin
  foreach t in array array[
    'parties','engagements','money','commitments','offerings','staff',
    'templates','obligations','facts','events','actions','rules'
  ]
  loop
    execute format('drop policy if exists "own rows" on %I', t);
    execute format($f$
      create policy "own rows" on %I
        for all
        using (business_id in (select public.current_business_ids()))
        with check (business_id in (select public.current_business_ids()))
    $f$, t);

    -- Reads are almost always "this business, newest first".
    execute format('create index if not exists %I on %I (business_id)', t || '_business_idx', t);
  end loop;
end $$;

drop policy if exists "own business" on businesses;
create policy "own business" on businesses
  for all
  using (owner_id = (select auth.jwt() ->> 'sub'))
  with check (owner_id = (select auth.jwt() ->> 'sub'));

-- Time-ordered reads on the two tables that actually grow without bound.
create index if not exists engagements_business_at_idx on engagements (business_id, at desc);
create index if not exists money_business_at_idx on money (business_id, at desc);

-- ------------------------------------------------------------------ check it --
--   select tablename from pg_tables
--   where schemaname = 'public' and rowsecurity = false;
--
--   explain analyze select * from engagements limit 100;
--   -- should show an index scan on engagements_business_idx, never a seq scan.
