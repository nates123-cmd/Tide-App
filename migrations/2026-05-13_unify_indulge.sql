-- Tide v2 chunk 2: Indulge unification
-- Copy-not-move. Creates the new unified tables and copies all v1 data
-- (tide_sessions, tide_drinks, tide_other_substances) into them with UUIDs preserved.
-- v1 tables remain in place for one release as a safety net.
-- A follow-up cleanup migration will drop them once the new surface is stable.

-- 1) New unified session table (column shape matches v1 tide_sessions).
--    `id` has a default so app-side inserts don't need to supply one.
--    The COPY step below uses ON CONFLICT to preserve v1 IDs without re-firing the default.
create table if not exists tide_indulge_sessions (
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

-- 2) New unified entries table (alcohol + coded share one row shape)
create table if not exists tide_indulge_entries (
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

-- 3) Copy v1 sessions, preserving IDs. ON CONFLICT DO NOTHING so re-running is safe.
insert into tide_indulge_sessions
  (id, started_at, ended_at, duration_min, intention, setting, who_with, feeling, note, log_date, created_at)
select id, started_at, ended_at, duration_min, intention, setting, who_with, feeling, note, log_date, created_at
from tide_sessions
on conflict (id) do nothing;

-- 4) Copy v1 alcohol entries (tide_drinks → tide_indulge_entries with kind='alcohol').
insert into tide_indulge_entries
  (id, session_id, entry_at, kind, drink_type, standard_units, log_date)
select id, session_id, drink_at, 'alcohol', drink_type, standard_units, log_date
from tide_drinks
on conflict (id) do nothing;

-- 5) Copy v1 coded entries (tide_other_substances → tide_indulge_entries with kind='coded').
--    These had no session in v1; session_id stays NULL.
--    Alias text is looked up against tide_other_aliases to get alias_id.
--    dose_amount + dose_unit + setting + who_with + mood_before + notes are folded
--    into the entry's notes / amount fields (notes-as-summary) so nothing is lost.
insert into tide_indulge_entries
  (id, session_id, entry_at, kind, alias_id, amount, notes, log_date)
select
  o.id,
  null,
  o.logged_at,
  'coded',
  a.id,
  case
    when o.dose_amount is not null and o.dose_unit is not null
      then o.dose_amount::text || ' ' || o.dose_unit
    when o.dose_amount is not null
      then o.dose_amount::text
    else null
  end,
  trim(both ' · ' from coalesce(
    nullif(concat_ws(' · ',
      nullif(o.setting, ''),
      nullif(o.who_with, ''),
      nullif(o.mood_before, ''),
      nullif(o.notes, '')
    ), ''),
    ''
  )),
  o.log_date
from tide_other_substances o
left join tide_other_aliases a on a.alias = o.alias
on conflict (id) do nothing;

-- 6) Repoint reflections to the new sessions table.
--    Drop the FK constraint to tide_sessions; the UUIDs in tide_reflections.session_id
--    already match rows in tide_indulge_sessions because we preserved IDs in step 3.
--    The column stays; client code will read against tide_indulge_sessions.
do $$ begin
  if exists (
    select 1 from pg_constraint
    where conname = 'tide_reflections_session_id_fkey'
  ) then
    alter table tide_reflections drop constraint tide_reflections_session_id_fkey;
  end if;
end $$;

-- 7) RLS + policies + grants on the new tables (match the suite-wide pattern).
alter table tide_indulge_sessions enable row level security;
alter table tide_indulge_entries  enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where policyname = 'anon all' and tablename = 'tide_indulge_sessions'
  ) then
    create policy "anon all" on tide_indulge_sessions for all to anon, authenticated using (true) with check (true);
  end if;
  if not exists (
    select 1 from pg_policies where policyname = 'anon all' and tablename = 'tide_indulge_entries'
  ) then
    create policy "anon all" on tide_indulge_entries for all to anon, authenticated using (true) with check (true);
  end if;
end $$;

grant all on tide_indulge_sessions, tide_indulge_entries to anon, authenticated, service_role;

-- 8) Indexes for the queries we'll run.
create index if not exists tide_indulge_sessions_started_idx on tide_indulge_sessions(started_at desc);
create index if not exists tide_indulge_sessions_active_idx on tide_indulge_sessions(ended_at) where ended_at is null;
create index if not exists tide_indulge_entries_session_idx on tide_indulge_entries(session_id);
create index if not exists tide_indulge_entries_log_date_idx on tide_indulge_entries(log_date);
create index if not exists tide_indulge_entries_kind_idx on tide_indulge_entries(kind);

notify pgrst, 'reload schema';
