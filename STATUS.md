# Tide — Resume Here

Last touched: 2026-05-12

## Where things stand

**Local dev works.** Server still running at http://localhost:8090 (background, started from `python3 -m http.server 8090` in this dir). API key is in `dev-config.js`.

**Blocker:** Supabase PostgREST schema cache will not pick up the four `tide_*` tables despite:
- Tables existing in `public` (confirmed via `select tablename from pg_tables`)
- RLS enabled with `anon all` policies
- `grant all` on all four tables to anon/authenticated/service_role
- `notify pgrst, 'reload schema'` (multiple attempts)
- Full Supabase project restart

`reflections` and `habits` still return 200 with the same anon key; `tide_sessions`, `tide_drinks`, `tide_reflections`, `tide_dismissed_quotes` all return 404 PGRST205.

## Pick up here — try in order

1. **Resave the API exposed-schemas setting in Supabase Dashboard.** Path moves around — look under Settings → API, or Settings → Data API, or Settings → Configuration → Data API. Just hit Save (no changes needed); often forces a full PostgREST reload.

2. **Drop and recreate the tables** (nuclear, but reliable). The full SQL is at the bottom of this file. Won't affect Still/Break/Tick tables. After running, `notify pgrst, 'reload schema'` should be enough — but if not, restart the project again.

3. **Verify from outside the browser** with:
   ```
   curl -s -w "\nHTTP %{http_code}\n" "https://xsmnfcmtbpeaccnyinkr.supabase.co/rest/v1/tide_sessions?select=id&limit=1" -H "apikey: $(grep SB_KEY index.html | head -1 | grep -o \"eyJ[^']*\")"
   ```
   Should return `[]` and `HTTP 200` once it's working.

## Other half-finished things

- **Git:** local repo is initialized with one commit (`74a3280`). **Not pushed to GitHub yet.** No remote configured. `gh` CLI is not installed (`brew install gh` to do it from here, or create the `Tide-App` repo manually on github.com first).
- **GitHub Pages deploy:** not done. Once pushed: GitHub repo Settings → Pages → Deploy from `main`. Live URL will be `https://nates123-cmd.github.io/Tide-App/`.
- **Background `python3 -m http.server 8090`** is still running. Kill it with `lsof -ti :8090 | xargs kill` if you want it gone.

## What's already done and good

- Single-file PWA in `index.html`, all 8 spec features implemented
- Color scheme: blue (warm stone → muted-deep-blue accent `#4A6B8A`)
- Real curated quotes with attribution (Mary Oliver, Annie Dillard, Hemingway, Julia Child, Jefferson, Shakespeare, Rumi, etc.). No AI generation for quotes. Dismissed quotes bias rotation away.
- Calendar week starts Sunday; future days render faded; "no/low drink night" pill only counts past+today
- Intention is range chips: `1–3 / 4–6 / 7–10 / 12+`. Stored as upper-bound int (3, 6, 10, 99 sentinel for "no soft limit")
- Service worker cache: `tide-v6` (bump on every deploy)
- Cross-app: morning reflection optionally writes to Still's `reflections` table with `tags: ['tide', 'morning-after']`

## Files

```
index.html             — entire app
sw.js                  — service worker
manifest.json          — PWA manifest
CLAUDE.md              — project context (the durable doc)
STATUS.md              — this file
dev-config.js          — GITIGNORED — local API key
dev-config.js.example  — template
.gitignore
```

## The drop+recreate SQL

```sql
drop table if exists tide_drinks cascade;
drop table if exists tide_reflections cascade;
drop table if exists tide_dismissed_quotes cascade;
drop table if exists tide_sessions cascade;

create table tide_sessions (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_min int,
  intention int,
  setting text,
  who_with text,
  feeling text,
  note text,
  created_at timestamptz not null default now()
);

create table tide_drinks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references tide_sessions(id) on delete cascade,
  drink_type text not null,
  standard_units numeric default 1,
  drink_at timestamptz not null default now()
);

create table tide_reflections (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references tide_sessions(id) on delete cascade,
  sleep_quality text,
  note text,
  pushed_to_still boolean default false,
  created_at timestamptz not null default now()
);

create table tide_dismissed_quotes (
  id uuid primary key default gen_random_uuid(),
  quote text not null,
  created_at timestamptz not null default now()
);

alter table tide_sessions enable row level security;
alter table tide_drinks enable row level security;
alter table tide_reflections enable row level security;
alter table tide_dismissed_quotes enable row level security;

create policy "anon all" on tide_sessions for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_drinks for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_reflections for all to anon, authenticated using (true) with check (true);
create policy "anon all" on tide_dismissed_quotes for all to anon, authenticated using (true) with check (true);

grant all on tide_sessions, tide_drinks, tide_reflections, tide_dismissed_quotes to anon, authenticated, service_role;

notify pgrst, 'reload schema';
```
