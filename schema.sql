-- Tide — full schema (9 tables)
-- Runs as drop + recreate. Safe for tide_* only; will not touch reflections/habits/etc.
-- Anonymous access via anon RLS, matching the existing suite pattern (no auth.users FK).
-- Paste into Supabase SQL editor and run.
--
-- For incremental additions on an existing DB (won't drop data) use the files
-- under ./migrations/ instead.

-- Drop in dependency order (cascades clear FKs anyway, but explicit is clearer)
drop table if exists tide_drinks cascade;
drop table if exists tide_reflections cascade;
drop table if exists tide_dismissed_quotes cascade;
drop table if exists tide_intake_logs cascade;
drop table if exists tide_supplements cascade;
drop table if exists tide_other_substances cascade;
drop table if exists tide_other_aliases cascade;
drop table if exists tide_oura_daily cascade;
drop table if exists tide_indulge_entries cascade;
drop table if exists tide_indulge_sessions cascade;
drop table if exists tide_stack_logs cascade;
drop table if exists tide_stack_items cascade;
drop table if exists tide_sessions cascade;

-- 1. Drinking sessions
create table tide_sessions (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_min int,
  intention int,
  setting text,
  who_with text,
  feeling text,
  note text,
  log_date date not null default current_date,
  created_at timestamptz not null default now()
);

-- 2. Individual drink logs
create table tide_drinks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references tide_sessions(id) on delete cascade,
  drink_type text not null,
  standard_units numeric default 1,
  drink_at timestamptz not null default now(),
  log_date date not null default current_date
);

-- 3. Morning-after reflections
create table tide_reflections (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references tide_sessions(id) on delete cascade,
  sleep_quality text,
  note text,
  pushed_to_still boolean default false,
  log_date date not null default current_date,
  created_at timestamptz not null default now()
);

-- 4. Dismissed quotes (bias rotation away)
create table tide_dismissed_quotes (
  id uuid primary key default gen_random_uuid(),
  quote text not null,
  created_at timestamptz not null default now()
);

-- 5. Water / food / supplement intake logs
create table tide_intake_logs (
  id uuid primary key default gen_random_uuid(),
  category text not null,           -- 'water' | 'food' | 'supplement'
  item_type text,                   -- meal type, supplement name, etc.
  quantity numeric,                 -- ml for water, count for supplement, null for food
  unit text,                        -- 'ml' | 'count' | etc.
  note text,
  logged_at timestamptz not null default now(),
  log_date date not null default current_date
);

-- 6. User-defined supplement stack
create table tide_supplements (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timing text not null,             -- 'morning' | 'evening' | 'as_needed'
  active boolean default true,
  created_at timestamptz not null default now()
);

-- 7. Discreet substance log (alias only — never the real name)
create table tide_other_substances (
  id uuid primary key default gen_random_uuid(),
  alias text not null,              -- references tide_other_aliases.alias by value
  dose_amount numeric,
  dose_unit text,                   -- user-defined: 'tab' | 'g' | 'mg' | ...
  route text,                       -- 'oral' | 'inhaled' | 'other' | null
  setting text,
  who_with text,
  mood_before text,
  notes text,
  logged_at timestamptz not null default now(),
  log_date date not null default current_date
);

-- 8. User-defined aliases (label only — no real-name column by design)
create table tide_other_aliases (
  id uuid primary key default gen_random_uuid(),
  alias text not null unique,
  active boolean default true,
  created_at timestamptz not null default now()
);

-- 9. Oura biometric daily snapshot (one row per date)
create table tide_oura_daily (
  date date primary key,
  sleep_score int,
  total_sleep_min int,
  rem_sleep_min int,
  deep_sleep_min int,
  sleep_efficiency int,
  hrv_avg int,
  resting_hr int,
  readiness_score int,
  activity_score int,
  raw jsonb,
  fetched_at timestamptz not null default now()
);

-- 10. Indulge sessions (v2 unified — replaces tide_sessions after cleanup migration)
create table tide_indulge_sessions (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_min int,
  intention int,
  intention_text text,
  setting text,
  who_with text,
  feeling text,
  note text,
  log_date date not null default current_date,
  created_at timestamptz not null default now()
);

-- 11. Indulge entries (v2 unified — alcohol + coded in one table, replaces tide_drinks + tide_other_substances)
create table tide_indulge_entries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references tide_indulge_sessions(id) on delete cascade,
  entry_at timestamptz not null default now(),
  kind text not null check (kind in ('alcohol', 'coded')),
  alias_id uuid references tide_other_aliases(id),
  drink_type text,
  standard_units numeric,
  amount text,
  notes text,
  log_date date not null default current_date,
  created_at timestamptz not null default now()
);

-- 12. Stack items (v2 — replaces tide_supplements after cleanup migration)
create table tide_stack_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  dose text,
  schedule text not null check (schedule in ('morning', 'evening', 'as_needed')),
  category text not null default 'supplement' check (category in ('supplement', 'medication')),
  required boolean not null default false,  -- counts toward day total + streak when true
  notes text,
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 13. Stack logs (v2 — structured check-off events; replaces intake_log rows of category=supplement)
create table tide_stack_logs (
  id uuid primary key default gen_random_uuid(),
  stack_item_id uuid not null references tide_stack_items(id) on delete cascade,
  taken_at timestamptz not null default now(),
  log_date date not null default current_date,
  created_at timestamptz not null default now()
);

-- RLS on everything
alter table tide_sessions enable row level security;
alter table tide_drinks enable row level security;
alter table tide_reflections enable row level security;
alter table tide_dismissed_quotes enable row level security;
alter table tide_intake_logs enable row level security;
alter table tide_supplements enable row level security;
alter table tide_other_substances enable row level security;
alter table tide_other_aliases enable row level security;
alter table tide_oura_daily enable row level security;
alter table tide_indulge_sessions enable row level security;
alter table tide_indulge_entries enable row level security;
alter table tide_stack_items enable row level security;
alter table tide_stack_logs enable row level security;

create policy "anon all" on tide_sessions for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_drinks for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_reflections for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_dismissed_quotes for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_intake_logs for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_supplements for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_other_substances for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_other_aliases for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_oura_daily for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_indulge_sessions for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_indulge_entries for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_stack_items for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_stack_logs for all to anon, authenticated using (true) with check (true);

grant all on
  tide_sessions,
  tide_drinks,
  tide_reflections,
  tide_dismissed_quotes,
  tide_intake_logs,
  tide_supplements,
  tide_other_substances,
  tide_other_aliases,
  tide_oura_daily,
  tide_indulge_sessions,
  tide_indulge_entries,
  tide_stack_items,
  tide_stack_logs
  to anon, authenticated, service_role;

-- Indexes for the queries we'll actually run
create index tide_drinks_session_idx           on tide_drinks(session_id);
create index tide_sessions_log_date_idx        on tide_sessions(log_date);
create index tide_intake_logs_log_date_idx     on tide_intake_logs(log_date);
create index tide_intake_logs_category_idx     on tide_intake_logs(category);
create index tide_other_substances_log_date_idx on tide_other_substances(log_date);
create index tide_oura_daily_date_idx          on tide_oura_daily(date desc);
create index tide_indulge_sessions_started_idx on tide_indulge_sessions(started_at desc);
create index tide_indulge_sessions_active_idx  on tide_indulge_sessions(ended_at) where ended_at is null;
create index tide_indulge_entries_session_idx  on tide_indulge_entries(session_id);
create index tide_indulge_entries_log_date_idx on tide_indulge_entries(log_date);
create index tide_indulge_entries_kind_idx     on tide_indulge_entries(kind);
create index tide_stack_items_schedule_idx     on tide_stack_items(schedule);
create index tide_stack_items_position_idx     on tide_stack_items(position);
create index tide_stack_logs_item_date_idx     on tide_stack_logs(stack_item_id, log_date desc);
create index tide_stack_logs_date_idx          on tide_stack_logs(log_date desc);

notify pgrst, 'reload schema';
