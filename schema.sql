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
drop table if exists tide_profile cascade;
drop table if exists tide_digests cascade;
drop table if exists tide_body_metrics cascade;
drop table if exists tide_strength_sessions cascade;
drop table if exists tide_activities cascade;
drop table if exists tide_workout_template_exercises cascade;
drop table if exists tide_workout_templates cascade;
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
  category text not null,           -- 'water' | 'food' | 'supplement' | 'caffeine'
  item_type text,                   -- meal name, supplement name, etc.
  quantity numeric,                 -- ml for water, count for supplement, kcal for food (or use metadata.kcal), mg for caffeine
  unit text,                        -- 'ml' | 'count' | 'kcal' | 'mg' | ...
  note text,
  metadata jsonb,                   -- food: { kcal, protein_g, carbs_g, fat_g, source } — null for other categories
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
  schedule text not null check (schedule in ('morning', 'afternoon', 'evening', 'as_needed')),
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

-- 15. Workout templates (v2 — Push/Pull/Leg Day…)
create table tide_workout_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position int not null default 0,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

-- 20. Profile singleton — synced across devices
create table tide_profile (
  id uuid primary key,
  age int,
  gender text,
  weight_lb numeric,
  goal_weight_lb numeric,
  weight_pace text,
  height_in int,
  activity_level text,
  oura_pat text,
  updated_at timestamptz not null default now()
);

-- 19. Weekly digests — Sunday-generated magazine article
create table tide_digests (
  id uuid primary key default gen_random_uuid(),
  week_start date not null unique,
  headline text,
  narrative text,
  week_meta_json jsonb,
  wins_json jsonb,
  drags_json jsonb,
  evidence_lenses_json jsonb,
  experiment_text text,
  experiment_candidates_json jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 18. Body metrics — weight + measurements + photos over time
create table tide_body_metrics (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  weight_lb numeric,
  chest_in numeric,
  waist_in numeric,
  hips_in numeric,
  arms_in numeric,
  thighs_in numeric,
  neck_in numeric,
  body_fat_pct numeric,
  photo_paths jsonb default '[]'::jsonb,
  notes text,
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 17. Strength sessions — one row per individual set
create table tide_strength_sessions (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references tide_activities(id) on delete cascade,
  exercise text not null,
  set_number int not null,
  reps int,
  weight_lb numeric,
  is_pr boolean not null default false,
  notes text,
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 16. Template exercises — ordered exercise list per template
create table tide_workout_template_exercises (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references tide_workout_templates(id) on delete cascade,
  exercise_name text not null,
  set_count int not null default 3,
  target_reps int,                    -- prescribed reps per set (nullable for "to failure")
  target_weight_lb numeric,           -- working weight (progression marker; nullable until first set)
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- 14. Train activities (v2 — strength + cardio + recovery)
create table tide_activities (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  type text,
  category text not null check (category in ('strength', 'cardio', 'recovery')),
  duration_min int,
  perceived_effort int,
  source text not null default 'manual' check (source in ('manual', 'oura', 'apple_health')),
  template_id uuid,
  notes text,
  metadata jsonb,
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 19. Caffeine presets — user-defined quick tiles (in addition to the fixed
--     Coffee/Espresso/Tea defaults hardcoded in the app).
create table tide_caffeine_presets (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  mg int not null,
  position int not null default 0,
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
alter table tide_activities enable row level security;
alter table tide_workout_templates enable row level security;
alter table tide_workout_template_exercises enable row level security;
alter table tide_strength_sessions enable row level security;
alter table tide_body_metrics enable row level security;
alter table tide_digests enable row level security;
alter table tide_profile enable row level security;
alter table tide_caffeine_presets enable row level security;

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
create policy "anon all" on tide_activities for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_workout_templates for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_workout_template_exercises for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_strength_sessions for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_body_metrics for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_digests for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_profile for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_caffeine_presets for all to anon, authenticated using (true) with check (true);

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
  tide_stack_logs,
  tide_activities,
  tide_workout_templates,
  tide_workout_template_exercises,
  tide_strength_sessions,
  tide_body_metrics,
  tide_digests,
  tide_profile,
  tide_caffeine_presets
  to anon, authenticated, service_role;

-- Seed the singleton row
insert into tide_profile (id) values ('00000000-0000-0000-0000-000000000001'::uuid)
on conflict (id) do nothing;

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
create index tide_activities_date_idx          on tide_activities(date desc);
create index tide_activities_category_idx      on tide_activities(category);
create index tide_activities_template_idx      on tide_activities(template_id, date desc);
create index tide_workout_templates_position_idx on tide_workout_templates(position);
create index tide_workout_template_exercises_template_idx on tide_workout_template_exercises(template_id, position);
create index tide_strength_sessions_activity_idx on tide_strength_sessions(activity_id, set_number);
create index tide_strength_sessions_exercise_idx on tide_strength_sessions(exercise, logged_at desc);
create index tide_strength_sessions_weight_idx   on tide_strength_sessions(exercise, weight_lb desc);
create index tide_body_metrics_date_idx          on tide_body_metrics(date desc);
create index tide_digests_week_idx               on tide_digests(week_start desc);
create index tide_caffeine_presets_position_idx  on tide_caffeine_presets(position, created_at);

notify pgrst, 'reload schema';
