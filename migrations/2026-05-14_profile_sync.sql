-- Tide v2 profile sync — fixed-singleton row so every device shares one profile.
-- Stores: profile fields (age/sex/weight/etc.) + Oura PAT.
-- Anthropic API key intentionally NOT synced — stays per-device in localStorage.

create table if not exists tide_profile (
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

insert into tide_profile (id) values ('00000000-0000-0000-0000-000000000001'::uuid)
on conflict (id) do nothing;

alter table tide_profile enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'anon all' and tablename = 'tide_profile') then
    create policy "anon all" on tide_profile for all to anon, authenticated using (true) with check (true);
  end if;
end $$;

grant all on tide_profile to anon, authenticated, service_role;

notify pgrst, 'reload schema';
