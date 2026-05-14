-- Tide v2 chunk 11: weekly digest cache.
-- Additive. One row per week_start (Monday of the summarized week).

create table if not exists tide_digests (
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

alter table tide_digests enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'anon all' and tablename = 'tide_digests') then
    create policy "anon all" on tide_digests for all to anon, authenticated using (true) with check (true);
  end if;
end $$;

grant all on tide_digests to anon, authenticated, service_role;

create index if not exists tide_digests_week_idx on tide_digests(week_start desc);

notify pgrst, 'reload schema';
