-- Breathalyzer readings, for calibrating the BAC model against reality.
--
-- Everything the estimate currently rests on is a population model: Watson's
-- body-water regression and published elimination ranges. A handful of real
-- readings replaces the population with Nate.
--
-- The row deliberately stores THREE things, not just the measurement:
--
--   1. what the breathalyzer said,
--   2. what the model predicted at that exact moment,
--   3. the inputs the model used (drinks, units, elapsed hours, r, beta).
--
-- Storing (2) and (3) means a fit can be run later even if the underlying
-- entries are edited or deleted, and means drift is visible immediately
-- without re-deriving anything. A table holding only the measurement would be
-- almost useless a week later.

create table if not exists tide_bac_readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  session_id uuid references tide_indulge_sessions(id) on delete set null,

  measured_at timestamptz not null default now(),
  bac numeric not null,              -- what the device read, %BAC (e.g. 0.062)
  device text,                       -- which breathalyzer, so models can be compared
  note text,                         -- "after food", "20min after last drink", etc.

  -- What the model said at measured_at.
  predicted_low  numeric,
  predicted_mid  numeric,
  predicted_high numeric,
  predicted_safe numeric,            -- the conservative bound driving clear-by

  -- The inputs behind that prediction, so a refit never needs the entries.
  drinks_count  int,
  units_total   numeric,
  hours_elapsed numeric,             -- since the first drink of the session
  mins_since_last int,
  model_r       numeric,             -- Widmark factor actually used
  model_beta    numeric,             -- central elimination rate actually used

  log_date date not null default current_date,
  created_at timestamptz not null default now()
);

alter table tide_bac_readings enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'own rows' and tablename = 'tide_bac_readings'
  ) then
    create policy "own rows" on tide_bac_readings
      for all to anon, authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

grant all on tide_bac_readings to anon, authenticated, service_role;

create index if not exists tide_bac_readings_user_time_idx
  on tide_bac_readings(user_id, measured_at desc);
create index if not exists tide_bac_readings_session_idx
  on tide_bac_readings(session_id);

notify pgrst, 'reload schema';
