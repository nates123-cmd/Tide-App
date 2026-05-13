# Tide — Project Context

## What it is
A mindful drinking companion PWA — fourth app in a personal OS suite alongside Break (mind enrichment), Tick (behavioral tracking), and Still (reflection). Awareness over restriction: set an intention, track pace, stay present.

**Live URL:** https://nates123-cmd.github.io/Tide-App/ (set up GitHub Pages on the repo named `Tide-App`)
**Local dev:** `python3 -m http.server 8080` → http://localhost:8080 (SW bypasses cache on localhost)

---

## File structure
```
index.html    — entire app (~900 lines, HTML + CSS + JS)
sw.js         — service worker (cache name: tide-vN, bump on deploy)
manifest.json — PWA manifest
dev-config.js — GITIGNORED — sets Anthropic API key in localStorage for local dev
.gitignore    — ignores dev-config.js
```

---

## Tech stack
- **No build step** — plain HTML/CSS/JS, edit and refresh
- **Model:** `claude-sonnet-4-6`, direct browser fetch with `anthropic-dangerous-direct-browser-access: true`
- **Supabase** — REST API (no SDK), anon key auth, **same project as Break/Tick/Still**
- **Service worker** — cache-first static, network-first for Anthropic + Supabase, bypass on localhost

---

## Supabase config (same project as the rest of the suite)
```js
SB_URL = 'https://xsmnfcmtbpeaccnyinkr.supabase.co'
SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' // anon key, safe to commit
```

### Tables — run this SQL in Supabase Dashboard → SQL Editor
```sql
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

create policy "anon all" on tide_sessions for all using (true) with check (true);
create policy "anon all" on tide_drinks for all using (true) with check (true);
create policy "anon all" on tide_reflections for all using (true) with check (true);
create policy "anon all" on tide_dismissed_quotes for all using (true) with check (true);

create index tide_drinks_session_idx on tide_drinks(session_id);
create index tide_sessions_started_idx on tide_sessions(started_at desc);
```

Cross-app: morning-after notes optionally pushed to Still's `reflections` table (with `tags: ['tide', 'morning-after']`). Same Supabase project, same anon key.

---

## Screens
| Screen | Purpose |
|---|---|
| `home` | Active session card OR idle "start a session", rotating quote, week summary |
| `history` | Past sessions, weekly stats, tap a row to view detail or fill morning reflection |
| `morning` | Auto-prompts on app open if a session ended 6–36hr ago and has no reflection yet |
| `apikey` | First-launch API key entry, stored in `localStorage['anthropic_api_key']` |

Modals (bottom sheets, no separate route):
- Start session — intention (1–8), setting, who with
- Log drink — type, standard units (½/1/1.5/2)
- End session — feeling (great/good/okay/rough), optional note
- Session detail — drinks, intention vs actual, duration, note

---

## Key JS patterns

### `sbFetch(path, opts)`
Wraps Supabase REST fetch with auth headers. PATCH/POST set `Prefer: return=representation` so we can read the new row back.

### `callClaude(userPrompt, { system, maxTokens })` and `callClaudeJSON(prompt, fallback)`
Direct Claude browser fetch. The JSON variant strips code fences and falls back to a provided default object on any failure — so quotes always render even offline / no key / quota.

### `computePace(drinks)`
Returns `{ perHour, status, minSinceLast, total }`. Floors elapsed at 15min so the first drink doesn't show "12/hr". Status thresholds: `fast >= 2.5/hr`, `moderate >= 1.5/hr`, else `easy`.

### `loadActiveSession()` / `loadHistory()`
Server is source of truth. Active session = most recent `tide_sessions` row with `ended_at IS NULL`. Drink counts merged in via single `in.(...)` query rather than per-session round trips.

### Morning resurfacing
On boot, if there's a session that ended 6–36hr ago with no `tide_reflections` row, auto-route to `morning` screen. Uses `sessionStorage` flag to avoid re-prompting in the same browser session.

### Local cache
Active session + drinks + last 50 dismissed quotes mirrored to `localStorage['tide_state']` so reload is instant and offline shows last state.

### Quotes
- Generated by Claude on each home render (cached in `state.currentQuote` until "New quote" or "Dismiss" is tapped)
- "Dismiss" appends to `tide_dismissed_quotes` and biases prompts away from that tone via the last 10 dismissed in the prompt context
- `maybeNudge(kind)` swaps the current quote for a contextual one when pace is fast or user crosses their intention

---

## Drink unit defaults
Standard drink = 14g pure alcohol (US). Defaults in app:
- beer = 1.0
- wine = 1.0
- spirits = 1.0
- cocktail = 1.5 (auto-bumps when chosen)
User can override per-log with ½/1/1.5/2 chips.

---

## CSS design tokens
```css
--bg:      #F5F2EE   /* warm off-white */
--text:    #1C1C1C
--muted:   #6B6560
--accent:  #A89880   /* warm stone */
--card-bg: #EDEBE7
--card-bg-warm: #EFE9E0   /* slightly warmer for quote card — distinct from Tick */
--border:  #D8D4CE
--warn:    #B5754A
--good:    #7A8B6F
--radius:  14px
```
Same family as Break/Still/Tick. Slightly warmer accents than Tick (warm card backgrounds, fewer hard outlines) to feel social rather than clinical. No gamification.

---

## Cross-app integration
- **Still:** morning reflection note → `reflections` table with `tags: ['tide', 'morning-after']` and `mood = session.feeling`. Optional checkbox in morning screen.
- (Not yet wired) **Still habits:** low/no-drink night → `habit_logs`. Spec leaves this for a follow-up; the week summary already surfaces low/no-drink nights as a positive `pill-good`.

## Oura biometric integration
Tide pulls daily Oura snapshots (sleep score, total sleep, HRV balance, resting HR, readiness score, activity score) into `tide_oura_daily` (PK = date) and joins them against sessions/drinks on the **Patterns** screen.

- **PAT storage:** `localStorage['still_oura_pat']` — shared with Still since both apps run on the same `nates123-cmd.github.io` origin. Set in Profile (Oura section).
- **Edge function:** `/functions/v1/smooth-processor` (deployed name) — wraps `api.ouraring.com/v2/usercollection/{path}` with a whitelist of `daily_sleep` / `daily_readiness` / `daily_activity` / etc. Source lives in `still-app/supabase/functions/oura-proxy/index.ts`. **Same function is used by both Still and Tide — do not re-deploy.**
- **Sync cadence:** `syncOura()` runs on boot and from the Profile screen. Throttled to once per 4 hours via `localStorage['tide_oura_last_sync']`. Pulls last 14 days and upserts to `tide_oura_daily` with `Prefer: resolution=merge-duplicates`.
- **Attribution rule:** a session whose `started_at` is ≥ noon attributes to the *next* day's Oura row (the morning that sleep ended). Before noon: same day. See `ouraDateForSession()`.
- **Bucketing:** drinks per night → `{0, 1-2, 3-4, 5+}`. `bucketStats()` averages each Oura metric per bucket. Rendered as horizontal bars per metric card.
- **Narrative:** `patternsNarrative()` ships the joined per-day rows to Claude (sonnet-4-6) with a JSON-only system prompt for a 1–3 pattern, ≤80-word paragraph.

Migration: `migrations/2026-05-13_oura_daily.sql` is the additive migration; `schema.sql` carries the same table for fresh installs.

---

## Deploy workflow
1. Edit `index.html` (and `sw.js` / `manifest.json` if needed)
2. Bump `CACHE_NAME` version in `sw.js` whenever deploying
3. `git add . && git commit -m "..." && git push`
4. GitHub Pages deploys within ~1 minute

---

## Pending / known
- `dev-config.js` must be recreated manually if cloned fresh (gitignored, contains API key). See `dev-config.js.example`.
- Low/no-drink night → Still habit log not wired (v1 deferred)
- ABV-by-percentage input UI — currently exposed as standard-unit chips (½/1/1.5/2), not a free-form % field. Good enough for the social-context use case.
- No edit-drink flow — only undo (×) on the most recent night's drinks
