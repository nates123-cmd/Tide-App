# Tide — QA Testing Plan

Automated QA harness for the **Tide** PWA (mindful-drinking + fuel/intake tracking,
suite app, shared Supabase `xsmnfcmtbpeaccnyinkr`, per-user OTP + RLS).

**Stack under test:** single-file vanilla-JS PWA — `index.html` with one top-level
inline `<script>` (lines ~830–8496, no module wrapper, no build step). Because the
script is a classic (non-module) `<script>`, every top-level `function foo()` /
`let state` is a property of `window`, so the harness calls the **real** app code
directly via Playwright `page.evaluate` — zero re-implementation.

**Harness:** Playwright (`@playwright/test`) + Chromium, static `python3 -m http.server`
on :8214, all non-localhost network aborted (Supabase/Claude/Oura never hit).

---

## NOT covered (gaps / explicit non-goals)

These are real risks this harness does **not** exercise. Listed first, on purpose.

1. **Server round-trips.** Every `sbFetch`/`ouraFetch`/`callClaude` path is network-
   blocked. We do not verify request shape, RLS behavior, `log_date` actually
   persisting, OTP verify/refresh, or merge-duplicates upserts. Pure read/write
   wire format is untested.
2. **Oura ingest end-to-end.** `normalizeOuraRow()` is unit-tested for the
   documented daily_sleep-vs-sleep-endpoint bug, but the live `syncOura()` fetch
   loop, the schema-version forced re-sync, and the proxy contract are not.
3. **Claude estimation flows.** `estimateMealKcal()`, `fuelRemainingHint()`,
   Pulse generation, digest generation — all call Claude; only their cache/
   fallback branches are reachable offline and we don't deeply assert those.
4. **Rendering correctness / visual.** We assert that tab render functions run
   without throwing and emit expected anchor nodes, but not pixel layout,
   the ring arc geometry beyond the math, or CSS-token theming.
5. **Touch gestures.** `attachSwipeActions()` (swipe-to-delete / swipe-right-to-
   reschedule) wires Pointer/touch handlers; we test the handler wiring exists
   but not real multi-touch drag physics or the threshold reveal.
6. **Service worker / offline cache.** sw.js registration is left to run but its
   caching, `CACHE_NAME` bumps, and offline replay are not asserted. NB: unlike
   other suite apps, **Tide has no localStorage `sbFetch` outbox** — writes go
   straight through `sbBearer()`; there is no offline write queue to test.
7. **Body PIN gate crypto.** PIN hashing/storage (`tide_body_pin`) untested.
8. **Cross-app writes** (Tide → Still reflections, Tide → Course goals) untested.
9. **Timezone breadth.** Logical-day tests run in the harness's local tz
   (machine tz). We assert the *algorithm* (UTC-pure addDays, 5am rollover
   offset) but cannot sweep every tz without controlling `TZ`.

---

## Risk ranking (what IS covered, highest first)

### R1 — Calorie / macro aggregation + ring totals (HIGH)
The Fuel ring is the headline number; bad math = user mistrust. Pure functions:
`todayFoodTotals()`, `mealMacros()`, `computeMacroGoals()`, `drinkKcal()`,
`todayAlcoholEntries()`, `todayAlcoholKcal()`, ring `energyTotal = food + alcohol`.
Known sharp edges: template/recipe rows excluded from totals; macros stay
food-only while kcal includes alcohol; dedup of active `state.drinks` against
boot-loaded `state.todayAlcohol`; per-unit kcal table + 100/unit fallback.
→ `calorie-macro.spec.js`

### R2 — Logical-day + date helpers (HIGH)
`todayISO()` (5am local rollover, NOT UTC) and `addDays()` (UTC-pure string math,
must not drift by local offset). Every day-bucketed query/streak/Today filter
depends on these. Classic bug class (DST, month/year boundaries, negative n).
→ `date-helpers.spec.js`

### R3 — Streaks + day grouping (HIGH)
`stackItemStreak()`, `fullStackStreak()`, `hitDayExists()` — consecutive-day
counting back from today/yesterday, required-item opt-in, 60d floor. Off-by-one
and "today not yet logged" edge cases are easy to get wrong.
→ `streaks-grouping.spec.js`

### R4 — BAC / pace estimation (MED-HIGH)
`computeBAC()` (Widmark, sex/age-adjusted r, β decay, never negative),
`computePace()` (per-hour with 15-min floor), `computeBacTrend()` (15-min-ago
delta). Sensitive: incomplete profile → null (must hide column), monotonic
behavior, no negative BAC.
→ `bac-pace.spec.js`

### R5 — Patterns bucketing (MED)
`drinkBucket()` thresholds (0 / 1-2 / 3-4 / 5+), `bucketStats()` averaging
(null bucket when n=0, correct mean otherwise, ignores null metric values).
The v1 Patterns chart / v2 digest evidence depends on this.
→ `bucketing.spec.js`

### R6 — Sip hourly distribution + edit/delete wiring (MED)
`sipBuckets()` 12-bucket-from-6am distribution + now-bucket clamp;
`attachSwipeActions()` exists and wires delete/reschedule on rows (the
"every Today row is tap→edit/delete" convention).
→ `sip-edit.spec.js`

### R7 — Boot / smoke (BASELINE)
Page loads, app `<script>` defines globals without throwing, OTP gate shows when
no session, and the real tab renderers (Fuel/Sip/Stack/Indulge) run without
throwing and emit their headers when a fake session is planted.
→ `smoke.spec.js`

---

## Method notes

- Tests import nothing from the app; they `page.evaluate` the real globals.
- Where a function reads `window.state`, the test seeds `state` fields first,
  then calls the function in the same evaluate, so we exercise real reducers.
- `Date.now()`-dependent functions (pace, BAC, sipBuckets now-bucket) are tested
  for properties that hold regardless of wall-clock, or by feeding timestamps
  relative to `Date.now()` inside the evaluate.
- Real app bugs found are DOCUMENTED here and in the spec's bug section, never
  patched (index.html is not edited by this harness).

## App bugs found

See `BUGS.md` (written only if real defects are found during the run).
