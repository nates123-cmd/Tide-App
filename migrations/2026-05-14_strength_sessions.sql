-- Tide v2 chunk 8: per-set strength log linked to tide_activities.
-- Additive. weight in lb to match the imperial profile.

create table if not exists tide_strength_sessions (
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

alter table tide_strength_sessions enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'anon all' and tablename = 'tide_strength_sessions') then
    create policy "anon all" on tide_strength_sessions for all to anon, authenticated using (true) with check (true);
  end if;
end $$;

grant all on tide_strength_sessions to anon, authenticated, service_role;

create index if not exists tide_strength_sessions_activity_idx on tide_strength_sessions(activity_id, set_number);
create index if not exists tide_strength_sessions_exercise_idx on tide_strength_sessions(exercise, logged_at desc);
create index if not exists tide_strength_sessions_weight_idx   on tide_strength_sessions(exercise, weight_lb desc);

notify pgrst, 'reload schema';
