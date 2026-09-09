-- Counter — Supabase schema.
--
-- Paste the whole file into the SQL editor and run it once. It is written to be
-- safe to re-run: every statement is guarded, so running it twice changes
-- nothing.
--
-- Two things in here are load-bearing and are the ones most often left out:
--
--   1. **unique (business_id, client_id)** on every table. The device generates
--      its own ids and the app upserts on that pair, so a retry — a flaky
--      connection, a crash mid-upload, tapping Back up twice — is a no-op rather
--      than a duplicate. Without the constraint the upsert has no conflict
--      target and every retry doubles the table.
--
--   2. **with check** on every policy, not just **using**. `using` decides which
--      rows you can see and change; `with check` decides what you are allowed to
--      write. A policy with only `using` lets any signed-in account INSERT rows
--      carrying somebody else's business_id — they cannot read them back, but
--      they have written into another tenant's data.
--
-- Row Level Security is the only thing separating one business from another. The
-- anon key ships inside the app and is readable by anyone who downloads it; that
-- is by design and is fine, but it means a table with RLS off is a public table.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- businesses --
create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  owner_name text,
  archetype text,
  vocabulary jsonb,
  shape jsonb,
  description text,
  created_at timestamptz not null default now()
);

-- One business per account, which is what `ensureBusiness` assumes when it looks
-- one up by owner_id and takes the first row.
create unique index if not exists businesses_owner_key on businesses (owner_id);

alter table businesses enable row level security;

drop policy if exists "own business" on businesses;
create policy "own business" on businesses
  for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ------------------------------------------------------- parties --
create table if not exists parties (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  client_id text not null,
  name text not null,
  phone text,
  joined_at timestamptz,
  staff_client_id text,
  detail text,
  notes text,
  tags text[],
  referred_by text,
  group_id text,
  contactable boolean,
  archived_at timestamptz,
  synced_at timestamptz not null default now()
);

create unique index if not exists parties_client_key on parties (business_id, client_id);
create index if not exists parties_business_idx on parties (business_id);

alter table parties enable row level security;

drop policy if exists "own rows" on parties;
create policy "own rows" on parties
  for all
  using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));

-- --------------------------------------------------- engagements --
create table if not exists engagements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  client_id text not null,
  party_client_id text,
  at timestamptz,
  staff_client_id text,
  offering_client_id text,
  resource_client_id text,
  template_client_id text,
  value numeric,
  no_show boolean,
  note text,
  source text,
  synced_at timestamptz not null default now()
);

create unique index if not exists engagements_client_key on engagements (business_id, client_id);
create index if not exists engagements_business_idx on engagements (business_id);

alter table engagements enable row level security;

drop policy if exists "own rows" on engagements;
create policy "own rows" on engagements
  for all
  using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));

-- --------------------------------------------------------- money --
create table if not exists money (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  client_id text not null,
  party_client_id text,
  offering_client_id text,
  amount numeric,
  direction text,
  status text,
  at timestamptz,
  due_at timestamptz,
  settled_at timestamptz,
  label text,
  method text,
  category text,
  part_of text,
  refund_of text,
  synced_at timestamptz not null default now()
);

create unique index if not exists money_client_key on money (business_id, client_id);
create index if not exists money_business_idx on money (business_id);

alter table money enable row level security;

drop policy if exists "own rows" on money;
create policy "own rows" on money
  for all
  using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));

-- --------------------------------------------------- commitments --
create table if not exists commitments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  client_id text not null,
  party_client_id text,
  offering_client_id text,
  start_at timestamptz,
  end_at timestamptz,
  price numeric,
  status text,
  renewed_from text,
  auto_renew boolean,
  cancelled_at timestamptz,
  cancel_reason text,
  synced_at timestamptz not null default now()
);

create unique index if not exists commitments_client_key on commitments (business_id, client_id);
create index if not exists commitments_business_idx on commitments (business_id);

alter table commitments enable row level security;

drop policy if exists "own rows" on commitments;
create policy "own rows" on commitments
  for all
  using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));

-- ----------------------------------------------------- offerings --
create table if not exists offerings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  client_id text not null,
  name text,
  price numeric,
  cost numeric,
  duration_days integer,
  capacity integer,
  active boolean,
  synced_at timestamptz not null default now()
);

create unique index if not exists offerings_client_key on offerings (business_id, client_id);
create index if not exists offerings_business_idx on offerings (business_id);

alter table offerings enable row level security;

drop policy if exists "own rows" on offerings;
create policy "own rows" on offerings
  for all
  using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));

-- --------------------------------------------------------- staff --
create table if not exists staff (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  client_id text not null,
  name text,
  role text,
  access text,
  phone text,
  active boolean,
  synced_at timestamptz not null default now()
);

create unique index if not exists staff_client_key on staff (business_id, client_id);
create index if not exists staff_business_idx on staff (business_id);

alter table staff enable row level security;

drop policy if exists "own rows" on staff;
create policy "own rows" on staff
  for all
  using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));

-- ----------------------------------------------------- templates --
create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  client_id text not null,
  name text,
  weekdays integer[],
  minute_of_day integer,
  party_client_ids text[],
  staff_client_id text,
  resource_client_id text,
  offering_client_id text,
  duration_min integer,
  active boolean,
  synced_at timestamptz not null default now()
);

create unique index if not exists templates_client_key on templates (business_id, client_id);
create index if not exists templates_business_idx on templates (business_id);

alter table templates enable row level security;

drop policy if exists "own rows" on templates;
create policy "own rows" on templates
  for all
  using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));

-- --------------------------------------------------- obligations --
create table if not exists obligations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  client_id text not null,
  kind text,
  party_client_id text,
  due_at timestamptz,
  label text,
  done boolean,
  done_at timestamptz,
  repeat_days integer,
  lead_days integer,
  amount numeric,
  from_insight text,
  synced_at timestamptz not null default now()
);

create unique index if not exists obligations_client_key on obligations (business_id, client_id);
create index if not exists obligations_business_idx on obligations (business_id);

alter table obligations enable row level security;

drop policy if exists "own rows" on obligations;
create policy "own rows" on obligations
  for all
  using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));

-- --------------------------------------------------------- facts --
create table if not exists facts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  client_id text not null,
  key text,
  origin text,
  value text,
  numeric_value numeric,
  at timestamptz,
  confidence numeric,
  note text,
  synced_at timestamptz not null default now()
);

create unique index if not exists facts_client_key on facts (business_id, client_id);
create index if not exists facts_business_idx on facts (business_id);

alter table facts enable row level security;

drop policy if exists "own rows" on facts;
create policy "own rows" on facts
  for all
  using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));

-- -------------------------------------------------------- events --
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  client_id text not null,
  at timestamptz,
  label text,
  origin text,
  basis text,
  synced_at timestamptz not null default now()
);

create unique index if not exists events_client_key on events (business_id, client_id);
create index if not exists events_business_idx on events (business_id);

alter table events enable row level security;

drop policy if exists "own rows" on events;
create policy "own rows" on events
  for all
  using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));

-- ------------------------------------------------------- actions --
create table if not exists actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  client_id text not null,
  kind text,
  label text,
  party_client_ids text[],
  insight_id text,
  rule_client_id text,
  created_at timestamptz,
  outcome text,
  completed_at timestamptz,
  reason text,
  worked boolean,
  reviewed_at timestamptz,
  snoozed_until timestamptz,
  synced_at timestamptz not null default now()
);

create unique index if not exists actions_client_key on actions (business_id, client_id);
create index if not exists actions_business_idx on actions (business_id);

alter table actions enable row level security;

drop policy if exists "own rows" on actions;
create policy "own rows" on actions
  for all
  using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));

-- --------------------------------------------------------- rules --
create table if not exists rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  client_id text not null,
  trigger text,
  sentence text,
  trust numeric,
  enabled boolean,
  fired_count integer,
  undone_count integer,
  last_fired_at timestamptz,
  created_at timestamptz,
  synced_at timestamptz not null default now()
);

create unique index if not exists rules_client_key on rules (business_id, client_id);
create index if not exists rules_business_idx on rules (business_id);

alter table rules enable row level security;

drop policy if exists "own rows" on rules;
create policy "own rows" on rules
  for all
  using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));

-- ------------------------------------------------------------------ check it --
-- After running this, confirm every table is protected. Any row this returns is
-- a table readable by anyone holding the anon key.
--
--   select tablename from pg_tables
--   where schemaname = 'public' and rowsecurity = false;
