-- Tide v2.x fix #5: custom caffeine entries become reusable quick tiles.
-- Additive. Safe to re-run. Mirrors the tide_stack_items pattern so custom
-- tiles sync across devices via the shared project.

create table if not exists tide_caffeine_presets (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  mg int not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

alter table tide_caffeine_presets enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'anon all' and tablename = 'tide_caffeine_presets') then
    create policy "anon all" on tide_caffeine_presets for all to anon, authenticated using (true) with check (true);
  end if;
end $$;

grant all on tide_caffeine_presets to anon, authenticated, service_role;

create index if not exists tide_caffeine_presets_position_idx on tide_caffeine_presets(position, created_at);

notify pgrst, 'reload schema';
