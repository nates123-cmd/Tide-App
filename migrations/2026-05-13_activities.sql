-- Tide v2 chunk 6: workouts, cardio, recovery activities.
-- Additive. Future chunks (7-8) add template_id linkage + strength_sessions for
-- structured set/rep/weight logging.

create table if not exists tide_activities (
  id uuid primary key default gen_random_uuid(),
  date date not null default current_date,
  type text,                          -- free-form: "Push Day", "Zone 2 walk", "Steam", "Stretching"…
  category text not null check (category in ('strength', 'cardio', 'recovery')),
  duration_min int,
  perceived_effort int,               -- 1-10 RPE
  source text not null default 'manual' check (source in ('manual', 'oura', 'apple_health')),
  template_id uuid,                   -- reserved for chunk 7 (workout templates)
  notes text,
  metadata jsonb,                     -- distance, HR, calories, etc. when source is integration
  logged_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table tide_activities enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'anon all' and tablename = 'tide_activities') then
    create policy "anon all" on tide_activities for all to anon, authenticated using (true) with check (true);
  end if;
end $$;

grant all on tide_activities to anon, authenticated, service_role;

create index if not exists tide_activities_date_idx     on tide_activities(date desc);
create index if not exists tide_activities_category_idx on tide_activities(category);

notify pgrst, 'reload schema';
