-- Tide v2 chunk 4: Stack restructure
-- Additive. Creates tide_stack_items (renamed concept from tide_supplements with
-- extended fields) and tide_stack_logs (structured check-off events).
-- v1 data is copied. tide_supplements stays in place as a backup.

-- 1) Stack items — the user's stack definition (supplements + medications, scheduled).
create table if not exists tide_stack_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  dose text,
  schedule text not null check (schedule in ('morning', 'evening', 'as_needed')),
  category text not null default 'supplement' check (category in ('supplement', 'medication')),
  notes text,
  position int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 2) Stack logs — one row per "I took it" event.
create table if not exists tide_stack_logs (
  id uuid primary key default gen_random_uuid(),
  stack_item_id uuid not null references tide_stack_items(id) on delete cascade,
  taken_at timestamptz not null default now(),
  log_date date not null default current_date,
  created_at timestamptz not null default now()
);

-- 3) Copy v1 supplements → stack items, preserving UUIDs and the timing column as schedule.
insert into tide_stack_items (id, name, schedule, category, position, active, created_at)
select id, name, timing, 'supplement', 0, active, created_at
from tide_supplements
on conflict (id) do nothing;

-- 4) Backfill historical check-offs: tide_intake_logs(category=supplement) → tide_stack_logs.
--    item_type carried the supplement name; match against tide_stack_items.name.
--    Skip rows that already mapped (e.g., re-running the migration).
insert into tide_stack_logs (stack_item_id, taken_at, log_date)
select s.id, l.logged_at, l.log_date
from tide_intake_logs l
join tide_stack_items s on s.name = l.item_type
where l.category = 'supplement'
  and not exists (
    select 1 from tide_stack_logs existing
    where existing.stack_item_id = s.id
      and existing.taken_at = l.logged_at
  );

-- 5) RLS + policies + grants.
alter table tide_stack_items enable row level security;
alter table tide_stack_logs  enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where policyname = 'anon all' and tablename = 'tide_stack_items') then
    create policy "anon all" on tide_stack_items for all to anon, authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where policyname = 'anon all' and tablename = 'tide_stack_logs') then
    create policy "anon all" on tide_stack_logs for all to anon, authenticated using (true) with check (true);
  end if;
end $$;

grant all on tide_stack_items, tide_stack_logs to anon, authenticated, service_role;

-- 6) Indexes.
create index if not exists tide_stack_items_schedule_idx on tide_stack_items(schedule);
create index if not exists tide_stack_items_position_idx on tide_stack_items(position);
create index if not exists tide_stack_logs_item_date_idx on tide_stack_logs(stack_item_id, log_date desc);
create index if not exists tide_stack_logs_date_idx     on tide_stack_logs(log_date desc);

notify pgrst, 'reload schema';
