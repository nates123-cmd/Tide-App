-- Tide v2 chunk 7: workout templates (Push/Pull/Leg Day…).
-- Additive. Used by Train Today's quick-start chips; consumed by chunk 8's
-- set/rep/weight logging.

create table if not exists tide_workout_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  position int not null default 0,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists tide_workout_template_exercises (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references tide_workout_templates(id) on delete cascade,
  exercise_name text not null,
  set_count int not null default 3,
  position int not null default 0,
  created_at timestamptz not null default now()
);

alter table tide_workout_templates enable row level security;
alter table tide_workout_template_exercises enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'anon all' and tablename = 'tide_workout_templates') then
    create policy "anon all" on tide_workout_templates for all to anon, authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'anon all' and tablename = 'tide_workout_template_exercises') then
    create policy "anon all" on tide_workout_template_exercises for all to anon, authenticated using (true) with check (true);
  end if;
end $$;

grant all on tide_workout_templates, tide_workout_template_exercises to anon, authenticated, service_role;

create index if not exists tide_workout_templates_position_idx on tide_workout_templates(position);
create index if not exists tide_workout_template_exercises_template_idx on tide_workout_template_exercises(template_id, position);

notify pgrst, 'reload schema';
