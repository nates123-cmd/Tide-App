-- Tide: add daily Oura snapshot table.
-- Idempotent / additive — safe to run against the live DB without dropping anything else.

create table if not exists tide_oura_daily (
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

alter table tide_oura_daily enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where policyname = 'anon all' and tablename = 'tide_oura_daily'
  ) then
    create policy "anon all" on tide_oura_daily for all to anon, authenticated using (true) with check (true);
  end if;
end $$;

grant all on tide_oura_daily to anon, authenticated, service_role;

create index if not exists tide_oura_daily_date_idx on tide_oura_daily(date desc);

notify pgrst, 'reload schema';
