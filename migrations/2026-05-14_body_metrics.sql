-- Tide v2 chunk 10: body composition log.
-- Additive. Imperial units to match the user's profile. Photos deferred to
-- chunk 10.5; photo_paths column lands now so the schema is forward-compat.

create table if not exists tide_body_metrics (
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

alter table tide_body_metrics enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'anon all' and tablename = 'tide_body_metrics') then
    create policy "anon all" on tide_body_metrics for all to anon, authenticated using (true) with check (true);
  end if;
end $$;

grant all on tide_body_metrics to anon, authenticated, service_role;

create index if not exists tide_body_metrics_date_idx on tide_body_metrics(date desc);

notify pgrst, 'reload schema';
