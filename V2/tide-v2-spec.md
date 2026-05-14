# Tide v2 — Enhancement Spec

**App:** Tide
**Status:** Canonical spec for v2 redesign (post-mockup pass)
**Date:** May 2026
**Reads alongside:** `CLAUDE.md` (v1 project context), `schema.sql` (current data model), `migrations/` (additive history), mockup HTML files in repo

---

## Why v2

v1 Tide is a mindful drinking companion that grew an intake tracker (water/food/supps/caffeine) and an Oura Patterns screen on top. Each piece works, but the home screen is a tab grid that gives you no reason to open the app unless you're about to log something. The Patterns screen is one of the strongest features in the suite and almost no one would know it exists from the home screen.

v2 reframes Tide as the **body signal hub** of the suite. Inputs (food, water, caffeine, supplements, indulgences) and outputs (training, sleep, readiness, body composition) live in one place. The home screen synthesizes both into a daily Pulse — a stat grid + one-line interpretation + one contextual action — so opening Tide always answers a real question: *what is my body telling me, and what should I do about it today?*

This makes Tide the body counterpart to Course's cockpit. Course tells you what to *do*. Tide tells you what shape you're in *to do it*.

### What stays from v1

- The mindful-drinking ritual (intention → pace → end-of-session → morning reflection) — this is the soul of the app and gets **extended**, not replaced
- The warm palette (`#F5F2EE` bg, `#A89880` stone accent) — fits "body signal" better than blue
- The Patterns screen and `bucketStats()` logic — evolves into the weekly digest expanded view
- Direct-to-Claude browser fetch, no build step, single-file PWA, service worker model
- Same Supabase project as Break/Tick/Still, anon key, RLS with `anon all`
- Morning resurfacing logic (6–36hr post-session) — but downgraded from auto-route to a dismissable Pulse home card
- Discreet substance log with user-defined aliases (`tide_other_aliases`)
- Oura sync via shared edge function and shared PAT (`localStorage['still_oura_pat']`)

### What changes

- Home screen replaced: tab grid → Pulse
- Four tabs → five tabs, renamed and regrouped: **Train / Fuel / Sip / Indulge / Stack**
- New: Train tab (workouts + strength log + progress + body composition)
- New: workout template system (Push/Pull/Leg Day with autofill from last session)
- New: recovery activity category (Steam first; sauna/ice bath/stretching later)
- New: BAC estimate in Indulge active sessions
- New: Fuel Library — searchable bank of all logged meals with frequency
- Alcohol + coded substances unified under one Indulge model with shared session/intention/reflection ritual
- Patterns screen evolves into the weekly digest expanded view
- Morning-after reflection changes from auto-route to optional dismissable Pulse card
- Bottom-bar persistent navigation across the app (Train / Fuel / Sip / Indulge / Stack)

---

## Identity

- **Old tagline:** Awareness over restriction. Set an intention, track pace, stay present.
- **New tagline:** Body signal. (Awareness over restriction stays as a sub-value.)

Same warm palette. Same calm, slightly poetic microcopy. Scope widens — Tide now owns the full input/output picture, not just intake.

---

## Visual Direction (locked)

### Palette (unchanged from v1)

```css
--bg:           #F5F2EE   /* warm off-white */
--text:         #1C1C1C
--muted:        #6B6560
--muted-soft:   #8E8884
--accent:       #A89880   /* warm stone */
--accent-deep:  #8C7A60   /* darker stone, for emphasis */
--card-bg:      #EDEBE7
--card-bg-warm: #EFE9E0   /* slightly warmer for emphasis/intention surfaces */
--border:       #D8D4CE
--border-soft:  #E3DFD9
--warn:         #B5754A
--good:         #7A8B6F
--radius:       14px
--radius-sm:    10px
```

### Typography (new in v2)

- **Display font: Fraunces** (serif, variable). Used for brand, stat values, screen titles, card titles, intention text, narrative copy, headlines, large numbers.
- **Body font: Inter**. Used for labels (uppercase, tracked), small metadata, buttons, dropdowns, microcopy.
- All numbers use `font-variant-numeric: tabular-nums` so deltas align cleanly.

### Locked design conventions

- **Bottom icon bar persistent nav** — five tabs (Train / Fuel / Sip / Indulge / Stack) always visible at screen bottom. Backdrop blur, dashed-active state, text labels with simple stroke icons. Survives scroll.
- **Solid black action button** — `var(--text)` background, `var(--bg)` text, trailing "→". Used for: Pulse action, End session, Reflect (primary). The single highest-force CTA in the app.
- **Warm-bg card variant** (`--card-bg-warm`) — used for emphasis surfaces: Pulse interpretation, Indulge intention/pace card, Reflection prompt, intention card empty state. Codes as "this is the meaning, not just data."
- **Section markers** (rule + uppercase label + rule) — magazine-style. Used ONLY in the Weekly Digest expanded view. Don't reuse elsewhere.
- **Header pattern** — large Fraunces tab title + uppercase tracked meta sub on left; small text-link affordances ("Patterns", "History", "Goal", "Workouts", etc.) top-right. Standard across all tabs.
- **Italicized emphasis** — Fraunces italic in `--accent-deep` color for the load-bearing phrase inside narrative copy. Used in Pulse interpretation, intention text, digest signals.
- **Tabular numbers everywhere** for stats, deltas, times, weights.

---

## Home Screen — The Pulse (locked)

The home screen is no longer a tab grid. It's the Pulse. Tabs live in the persistent bottom bar.

### Anatomy (top to bottom)

1. **Header** — "Tide" + date, top-right utility links (Patterns, History)
2. **Stat grid hero** — 2×2 grid of four stats:
   - **Readiness** — `tide_oura_daily.readiness_score`, large tabular number, color band dot (green >80, stone 65–80, warn <65)
   - **Sleep** — `total_sleep_min` formatted as h/m, with delta vs 7-day average
   - **HRV** — `hrv_avg`, with delta vs 7-day average
   - **Hydration pace** — current ml from `tide_intake_logs` (category=`water`) vs expected-by-this-hour, expressed as "ahead/behind ___ ml" or "on pace"
3. **Reflection prompt card** *(conditional, see below)*
4. **Pulse card** — interpretation + action
5. **Weekly digest card** — sits below Pulse all week, dims slightly Tuesday → Friday
6. **(Persistent bottom bar holds the tab nav — Train / Fuel / Sip / Indulge / Stack)**

### Pulse generation

- **Source data:** `tide_oura_daily` (readiness, sleep, HRV, activity); today's `tide_intake_logs` (water + caffeine totals); yesterday's `tide_indulge_sessions` + entries (load + reflection); today's `tide_activities` if any; optional second-pass from Tick for yesterday's focus session count
- **Cadence:** Regenerates on first open of the day. Pull-to-refresh forces regenerate
- **Persistence:** Today's Pulse cached in `localStorage['tide_pulse_today']` keyed by date so reload is instant
- **Tone:** Tight, imperative, single sentence. Course's clipped voice. One emphasized phrase in italic `--accent-deep`
- **Confidence floor:** If `tide_oura_daily` is empty for today/yesterday, fall back to whatever stats exist plus a neutral line ("Not enough signal today — log as you go.")
- **Reuses:** `callClaudeJSON()` with structured fallback object, same pattern as v1 quote generation

### Action cascade

The one action is chosen by priority — whichever rule fires first wins:

1. **Recovery override** — readiness <65 and no recovery flag for today → *"Mark a recovery day"*
2. **Hydration deficit** — behind pace by >300ml → *"Log a glass"* → opens Sip → water quick-add
3. **Active session** — there's an unended `tide_indulge_sessions` row → *"Open tonight's session"* → opens Indulge
4. **Caffeine late** — caffeine logged after 2pm → *"Note caffeine time"* (passive ack)
5. **Indulge intention** — Friday/Saturday after 4pm and Indulge active in last 7 days → *"Set tonight's intention"*
6. **Stack unchecked** — past 10am and morning stack incomplete → *"Mark morning stack"*
7. **Training opportunity** — readiness >80 and no workout logged by 4pm → *"Log workout"*
8. **Default** — *"Log what you've had"* (opens last-used tab)

Note: Morning-after reflection is no longer in the cascade — it surfaces as a dismissable card instead (see below).

### Reflection prompt card (new pattern)

Conditional surface — appears between the stat grid and the Pulse card when:
- A `tide_indulge_sessions` row ended 6–36hr ago
- That session has no `tide_reflections` row
- The user hasn't dismissed for this session

**Visual treatment:**
- Warm-bg variant card with **dashed border** (sets it apart as "soft/optional")
- Eyebrow: "LAST NIGHT"
- Italicized Fraunces prompt in `--accent-deep`: *"How did last night land? A quick note now would catch what you'd lose by tonight."*
- Two pill buttons: **Reflect** (solid black, primary) and **Not now** (ghost, dismisses for the day)
- Small × button top-right — dismisses **permanently for this session**

**Dismissal behavior:**
- × → never resurfaces for this session
- "Not now" → hidden today, can resurface tomorrow if still within 36hr window
- "Reflect" → opens reflection sheet (feeling chips + optional note + push-to-Still checkbox)

**Cross-app:** If reflection is submitted with push-to-Still checked, writes to Still's `reflections` table with `tags: ['tide', 'morning-after']` and `mood = session.feeling` (v1 behavior preserved).

### Weekly digest card

- Generated Sunday night, appears Monday morning
- Card sits below Pulse all week
- Headline view: one line, Fraunces, with eyebrow "THIS WEEK"
- Tap to expand → digest expanded view (see Weekly Digest section)

---

## Tab Structure (locked)

Five tabs in the bottom bar: **Train / Fuel / Sip / Indulge / Stack**.

---

### Train

**Owns:** Strength workouts, cardio activities, recovery activities, body composition, progress over time.

#### Header destinations
- **Workouts** — manage templates
- **Progress** — per-exercise charts
- **Body** — weight, measurements, photos (PIN-gated)

#### Today view

Layout when a session is active:

1. **Session summary bar** — workout/template name ("Push · Day 1"), live duration, total volume in kg on the right
2. **Exercise blocks** — each exercise is a card with:
   - Name + set count
   - "Last" reference inline ("Last · 3×8 @ 82.5 kg, May 10")
   - Sets grid: done sets in warm-bg with check, current set with ghost-fill from previous session in italic muted style, upcoming sets via dashed "Start first set" button
   - PR badge (small green pill) on a set that beats the previous best working weight
3. **Auto-pulled activities** — Oura/Apple Health workouts (Zone 2 walks, etc.) appear as their own cards with the source tag in the corner
4. **Recovery activities** — Steam, sauna, etc. Visually distinct: `--card-bg-warm` background, **dashed border**, accent-deep icon. Source tag ("Manual") or device source when integrations arrive
5. **Add row** — outlined buttons: "Add exercise" / "Log activity"
6. **End session** — solid black primary button at bottom

Quick-start row appears at top when no session is active: template chips with last-done timestamps. "Push Day · Last Wed" / "Pull Day · Last Fri" / "Leg Day · 2d ago". Tap to instantiate a session from that template.

#### Workout templates (new system)

- **Workouts** = templates (Push Day, Pull Day, Leg Day). Named ordered lists of exercises with prescribed set counts.
- **Sessions** = instances. When you start a workout, a session is instantiated from the template.
- **Ghost-fill** = each exercise's set fields pre-fill (italic, muted) with values from the most recent session of the *same template*. Tap to accept, type to override.
- **Template-scoped, not exercise-scoped** — Push Day bench autofills from last Push Day, not from whenever bench last appeared in any session.
- **Long-press an exercise name** to see last 3 sessions of that exercise within this template.
- **"Save as template"** on End Session sheet when the current session has no `template_id` — captures the exercise list (not the weights) as a new template.

#### Strength log mechanics

- Set rows: `[set#] [reps] [weight] [check]` — reps first, then weight
- Ghost-fill from last same-template session
- Tapping the check confirms the set with ghost values; tap a field to edit first
- PR detection: working weight beats the previous max recorded weight for that exercise (across all sessions); PR badge appears on the set that hit it

#### Progress sub-screen

- Per-lift cards, each with sparkline of working weight over time
- Filter chips for split (All / Push / Pull / Legs / Core), horizontal scroll
- Sparkline style: line + 12%-opacity area fill, dots at every session point, PR points larger and green-coded
- Card includes: exercise name, current weight, delta + session count + plateau/PR context
- **Recovery activities do not appear in Progress** — they're not training

#### Body sub-screen

- **Weight hero** — large Fraunces number, label, delta over chosen window ("−1.8 kg in 8 weeks"), "Log weight" pill in corner
- **Weight trend chart** with range toggle (1M / 3M / 6M / 1Y)
- **Measurements** as a 3×2 grid (Chest / Waist / Hips / Arms / Thighs / Neck), with deltas. Delta color logic respects goal direction (default: cut/recomp, loss = good)
- **Photos section** — PIN-gated. Empty state shows lock icon, "Progress photos are locked", 4-dot PIN pad illustration, "Unlock" button. Until unlocked, photos section shows only the gate; rest of Body remains visible.
- Once unlocked: full-bleed photo viewer, swipe to compare across dates, long-press to hide individual photos

#### Schema

- **`tide_activities`** (renamed from `tide_workouts`): id, date, type, duration_min, perceived_effort, source (`apple_health` | `oura` | `manual`), category (`strength` | `cardio` | `recovery`), template_id (nullable FK), notes
- **`tide_workout_templates`**: id, name, position, created_at
- **`tide_workout_template_exercises`**: id, template_id (FK), exercise_name, set_count, position
- **`tide_strength_sessions`**: id, activity_id (FK to `tide_activities`), exercise, set_number, reps, weight_kg, is_pr, notes
- **`tide_body_metrics`**: id, date, weight_kg, measurements_json (chest/waist/hips/arms/thighs/neck), photo_paths_json
- Photos stored in Supabase Storage with signed URLs, short TTL
- PIN stored hashed in `localStorage` (single device); future iCloud-equivalent persistence TBD

---

### Fuel

**Owns:** Caloric intake, macros, meal logging, goals, meal library.

#### Header destinations
- **Library** — full meal bank
- **Goal** — daily kcal target, macro split

#### Today view

1. **Summary card** — ring + macros, side by side:
   - Ring: 130×130, calorie progress, center shows "X left" in Fraunces with "X / target" below
   - Macros: three stacked rows (Protein / Carbs / Fat), each with label, current/target value, thin progress bar in three different palette tones
2. **Recents row** — horizontal-scroll chips of recent meals (name + kcal). Tap to log immediately with previous macros. Ends with dashed "All in Library ›" chip
3. **Meal input** — single text input, placeholder "Log a meal — or describe it". Solid black "+" submit icon. Italic Fraunces hint underneath: "Describe what you ate — Claude estimates calories and macros."
4. **Today section** — logged meals as cards: name + time, macros inline ("22 P · 28 C · 8 F"), kcal on the right. Tappable to edit.
5. **Remaining hint** — warm-bg card at the bottom with italic accent text: *"~960 kcal left for dinner. Aim for 80g protein to hit your target."* Claude-generated planning nudge.

#### Library

- Search bar at top
- Filter chips (All / Meals / Snacks / Drinks / High protein — inferred filters)
- Sort row: count + dropdown ("Most logged" / "Recently logged" / "A–Z" / "Highest kcal")
- Entries grouped: "Most logged" / "Last 30 days" / "Earlier"
- Each entry: name + frequency badge ("38×"), macros + kcal, "+" button to log immediately
- Tap row → meal detail (edit, delete)
- **Library is derived, not authored** — entries appear automatically when meals are logged via the home input. Deduped by name/macros.

#### Schema

- `tide_intake_logs` (category=`food`) reused — no new table for individual meal logs
- Add `metadata jsonb` to `tide_intake_logs` for kcal + macro breakdowns
- Library is a *view* over `tide_intake_logs` grouped by normalized name + macros, computed client-side

#### Claude estimation flow (out of scope for v2.0 mockup, but spec'd)

- User types meal description → submit → loading state → estimate result appears as a confirmable card with kcal + P/C/F + tap-to-edit fields
- Confirm → logs to `tide_intake_logs` with metadata
- Adjust → user can edit any field before confirming

---

### Sip

**Owns:** Water and caffeine. Both with pace overlays.

#### Layout

1. **Section switcher** at top — segmented control with "Water · 1.4L" / "Caffeine · 220mg". Both totals visible regardless of which is active. Active section gets `--bg` background with subtle shadow.
2. **Hero card** (warm-bg, centered) — large Fraunces number in active unit (ml or mg), subtitle ("of 2,400ml today"), pace pill below ("Behind pace · 420ml" in warn color)
3. **Hourly bars** — 12-hour distribution of today's intake. Past hours with intake = filled accent-deep, past hours without = dim, current hour = filled `--text`, future hours = faint. Time labels (6a / 10a / 2p / 6p / 10p) below.
4. **Add tiles** — 2×2 grid:
   - Water: Small (250ml) / Big (500ml) / Quart (~950ml) / Liter (1000ml)
   - Caffeine: Espresso / Coffee / Cold Brew / Tea (with editable mg defaults)
5. **Today timeline** — chronological list of logs with time + horizontal volume bar + amount. Tap a row to edit.

#### Caffeine specifics

- Last logged time displayed prominently ("last: 2:14pm")
- Soft amber visual when logging after 2pm
- Weekly caffeine total + average time-of-last-cup shown in History

#### Schema

- All reuses `tide_intake_logs` with `category` = `water` | `caffeine`
- v1 caffeine data migrates by staying in same table — only UI moves

---

### Indulge

**Owns:** Alcohol and coded recreational use. Unified session/intention/pace/reflection ritual.

#### Empty state (no active session)

Layout when Indulge is opened and no `tide_indulge_sessions` row is unended:

1. **Header** — "Indulge" + sub
2. **Empty eyebrow** — "SET TONIGHT'S INTENTION"
3. **Prompt** — Fraunces title: "What's tonight for?"
4. **Italic sub** — "Set the shape now and the rest writes itself."
5. **Form card** with four rows:
   - **Intention** — text input with placeholder
   - **Drinks ceiling** — chips: 1-3 / 4-6 / 7-10 / 12+ (v1 thresholds preserved)
   - **Setting** — chips: Out / Home / Event / Travel
   - **With** — text input for who-with
6. **Start session** — solid black primary button
7. **Recent nights** — list of past `tide_indulge_sessions` with date, setting, alcohol count, sleep score, units total

#### Active session view

1. **Header** — "Indulge" + meta ("Fri · with Sam & Jules"). "End" as quiet text link in corner
2. **Fused pace card** (the load-bearing component):
   - Two-stat layout side by side, hairline divider between
   - **Left stat**: "PACE" label, big Fraunces number "3 / 4" (alcohol units), pace detail below ("1.2 / hr")
   - **Right stat**: "BAC · EST" label, big Fraunces number ".06", trend detail below ("peak ~.07, trending down")
   - Status word ("Moderate" / "Fast") floats right below both stats — color-coded (accent-deep for moderate, warn for fast)
   - Hairline rule
   - **Intention** below in italic Fraunces, `--accent-deep` color
   - Meta strip at bottom: elapsed time + time since last entry
3. **Entries section** — chronological list of alcohol + coded entries:
   - Alcohol: warm-bg icon circle with first-letter, name ("Beer"), units ("1 standard"), time on right
   - Coded: dashed border icon with alias letter (T, B, etc.), title = alias, "1 entry" as meta, time on right
   - **Tap any entry → edit** (time always editable; type/units editable until session ends)
4. **Add another** section:
   - Quick chips row: ½ / 1 / 1½ / 2 standard units (logs as same type as last alcohol entry)
   - Below: dashed "+ Type or coded entry" button → opens full sheet for choosing type or logging a coded entry
5. **End session** — solid black primary button → opens end-session sheet (feeling chips + optional note)

#### BAC calculation

- **Widmark formula**, client-side:
  ```
  BAC = (grams_alcohol / (body_weight_kg × r)) × 100 − (β × hours)
  ```
- `r` = 0.68 (male) / 0.55 (female) from profile
- `β` = 0.015 per hour
- `grams_alcohol` = sum of `standard_units × 14` for alcohol entries in current session
- **Label "EST"** is mandatory — Widmark is approximate
- **Trend detection**: compare current BAC to BAC 15min ago to label "trending up/down/holding"
- **Hide BAC column entirely** if profile is incomplete (missing weight or sex)
- **No legal-threshold callouts** — no ".08 limit" markers, no red coloring at any specific value. The "Moderate / Fast" status word handles severity in Tide's own vocabulary

#### Coded substance display

- Aliases only (never real names). Stored in `tide_other_aliases`
- Visually neutral — no icons that telegraph substance type
- Dashed border + neutral bg + muted color distinguishes from alcohol entries
- Aggregated in digest in non-explicit terms ("indulgence above baseline this week")
- Patterns bucketing stays alcohol-only — `bucketStats()` filters `kind = 'alcohol'`. Coded patterns can be a future separate analysis surface

#### Schema (significant migration)

New unified tables replace v1's split:

- **`tide_indulge_sessions`** ← migrate from `tide_sessions` (same columns: started_at, ended_at, intention, setting, who_with, feeling, note, log_date)
- **`tide_indulge_entries`** ← migrate from `tide_drinks` (with kind=`'alcohol'`) + `tide_other_substances` (with kind=`'coded'`, session_id=NULL)
  - Schema: id, session_id (nullable FK), entry_at, kind (`'alcohol' | 'coded'`), alias_id (nullable FK to `tide_other_aliases`), drink_type (nullable, for alcohol), standard_units (nullable, for alcohol), amount (nullable text, for coded), notes
- **`tide_reflections.session_id`** FK repointed to `tide_indulge_sessions.id`
- **`tide_other_aliases`** unchanged
- `tide_sessions`, `tide_drinks`, `tide_other_substances` retained one release as backup, then dropped in a follow-up migration
- Migration file: `migrations/2026-MM-DD_unify_indulge.sql` — copy-not-move, additive

---

### Stack

**Owns:** Supplements and medications. Morning + evening checklists + as-needed log.

#### Layout

1. **Header** — "Stack" + date. "Manage" header link top-right
2. **Day progress card** — "5 / 8 today" Fraunces left, "6 days · Full-stack streak" right. Streak counts consecutive days hitting 100% of scheduled (morning + evening) items
3. **Three sections**:
   - **Morning** — items + group meta ("5 / 5 taken")
   - **Evening** — items + group meta ("0 / 2 taken")
   - **As needed** — separate row style with "Last: <date>" + "Log" button
4. **Stack items** — card with checkbox, name (Fraunces), dose/notes (Inter muted), per-item streak dot ("● 22d") on the right. Streaks ≥14d get `--good` color treatment
5. **Taken items** — shift to warm-bg, name color dims to muted, checkbox fills with `--text`
6. **As-needed items** — no checkbox; "Log" pill button on the right; meta shows last-taken date

#### Schema

- **`tide_stack_items`** (renamed from `tide_supplements`) — name, dose, schedule (`morning` | `evening` | `as_needed`), category (`supplement` | `medication`), notes, position, active
- **`tide_stack_logs`** — date, stack_item_id (FK), taken_at
- v1 supplements migrate via column additions; rename + new fields via additive migration

---

## Weekly Digest expanded view

The digest is the screen that justifies the v2 redesign. It's the long view — meant to be read like a magazine article.

### Structure (four acts)

1. **The thesis**
   - Eyebrow: "WEEK OF [date range]"
   - Headline (large Fraunces, italic closing clause): *"Three nights under 6h **drove HRV down 12%.**"*
   - Narrative paragraph (muted Fraunces, 2-3 sentences) explaining the thesis
   - 3-cell week meta strip: Avg Readiness / Avg HRV / Stack hit (with deltas vs previous week, color-coded)

2. **The evidence**
   - Section marker (rule + "THE EVIDENCE" + rule)
   - **Lens chips** (horizontal scroll, one active):
     - Drinks × Sleep (the v1 Patterns chart)
     - Caffeine × HRV
     - Hydration × Readiness
     - Train × Recovery
   - Active lens renders as bucketed bar chart with sample size:
     - Bars styled by quality tier (good / muted / accent / warn)
     - Value label INSIDE bar
     - `n=42` on the right showing sample size

3. **Signals**
   - Section marker "SIGNALS"
   - **Wins card** (good-coded markers): 2-3 bulleted signals with italicized emphasis phrases
   - **Drags card** (warn-coded markers): 2-3 bulleted signals with italicized emphasis phrases

4. **The experiment**
   - Section marker "THE EXPERIMENT"
   - **Inverted card** (dark `--text` bg, light text — only other surface besides Pulse action button that uses this treatment)
   - Eyebrow: "TRY THIS WEEK"
   - Suggested experiment in large Fraunces with italic emphasis: *"**No caffeine after 1pm** this week. We'll check whether HRV holds when sessions land late."*
   - Meta: "Tracked daily · result in next Sunday's digest"
   - Two buttons: **Commit** (primary, light bg) and **Pick another** (ghost) — Commit pushes to Course as a goal/intention

### Generation rules

- **Cadence:** Sunday night batch, available Monday morning
- **Source data:** Tide tables, `tide_oura_daily`, optional Tick reads, optional Still pattern reads
- **Lens selection:** Default lens is the one with the most interesting signal that week (largest delta or correlation). Other lenses accessible via chips
- **Experiment generation:** Claude generates 3-5 candidate experiments; primary is shown; "Pick another" cycles through

### Schema

- **`tide_digests`**: week_start, headline, narrative, week_meta_json, wins_json, drags_json, evidence_lenses_json, experiment_text, generated_at
- Existing `tide_oura_daily` powers most stats; existing `bucketStats()` logic extends across lens types

---

## Cross-App Integration (v2)

Tide becomes the most-connected app in the suite.

| Direction | Connection | Trigger |
|---|---|---|
| Tide → Course | Readiness + recovery state feeds Course's Morning Pulse | Daily, on Course open |
| Tide → Course | "Commit" experiment from digest creates a goal in Course | On experiment commit |
| Tide → Still | Morning-after reflection submitted with push-to-Still checked writes to Still | On reflection submit |
| Tide → Still | Weekly digest patterns surface in Still's pattern analysis | Weekly |
| Tide ← Oura | Readiness, sleep, HRV, activity via `tide_oura_daily` | Via shared edge function, throttled 4hr (v1 infrastructure preserved) |
| Tide ← Tick | Yesterday's focus session count/quality factored into Pulse interpretation | Daily, optional second pass |
| Tide ↔ Apple Health | Workouts + body weight + HRV pull/push (v2.1) | Continuous |

Course's Morning Pulse reads from Tide's previous-day Pulse and current readiness. If Tide says "recovery day," Course's Morning Pulse tone softens.

---

## Data Model Summary

### Tables preserved (no change)
- `tide_intake_logs` (water, food, caffeine, supplement check-offs) — gets `metadata jsonb` added
- `tide_other_aliases` (alias key for coded substances)
- `tide_dismissed_quotes` (quote rotation bias)
- `tide_oura_daily` (Oura snapshots)

### Tables renamed/restructured
- `tide_sessions` → `tide_indulge_sessions` (column shape preserved)
- `tide_drinks` + `tide_other_substances` → `tide_indulge_entries` (unified)
- `tide_reflections.session_id` FK repointed to `tide_indulge_sessions.id`
- `tide_supplements` → `tide_stack_items` (extended fields: category, schedule enum)

### Tables added
- `tide_activities` (workouts + cardio + recovery, with category field)
- `tide_workout_templates` (Push/Pull/Leg Day templates)
- `tide_workout_template_exercises` (exercise lists per template)
- `tide_strength_sessions` (set-level strength log, FK to tide_activities)
- `tide_body_metrics` (weight + measurements + photos)
- `tide_stack_logs` (checkbox event log)
- `tide_digests` (weekly digest cache)
- `tide_pulses` (optional — only if past Pulses get referenced; default: localStorage only)

### Tables retired (one-release-later cleanup)
- `tide_sessions`, `tide_drinks`, `tide_other_substances`

All schema changes ship as additive migrations under `migrations/` in date order. `schema.sql` updated for fresh installs (drop+recreate). RLS `anon all` policies on all new tables.

---

## Build Order

Logical sequence. Each chunk is deployable on its own.

1. **Pulse home + stat grid + bottom nav bar** — biggest UX unlock, low schema cost. Read existing `tide_oura_daily`, write Pulse generator using existing `callClaudeJSON()` pattern. Bottom-bar nav replaces v1 tab strip across the app. Old Oura status bar removed.
2. **Indulge unification migration** — schema migration first, then code refactor to use `tide_indulge_sessions` + `tide_indulge_entries`. Existing v1 alcohol flows keep working; coded substance UI moves into the new unified surface. Add BAC calc. Risk: this touches the most beloved part of the app — test thoroughly.
3. **Reflection prompt card** — replace v1's auto-route to morning screen with the dismissable Pulse card. Reuse v1 reflection sheet under the hood.
4. **Tab rename + Sip/Stack restructure** — Water becomes Sip (absorbs caffeine UI from Drinks card). Supps becomes Stack. UI restructure + field additions to `tide_stack_items`.
5. **Fuel UX upgrade** — kcal/macro estimation, quick-add, recents, ring + macro bar summary. Library screen with search/filter/sort. Schema: add `metadata jsonb` to `tide_intake_logs`.
6. **Train tab v1** — Today view + manual quick-add + Oura/Apple Health activity import. Recovery category (Steam). New `tide_activities` table.
7. **Workout templates** — `tide_workout_templates` + `tide_workout_template_exercises` schema. Workouts management screen. Quick-start row on Train Today empty state.
8. **Strength log + ghost-fill** — `tide_strength_sessions`. Template-scoped autofill. PR detection.
9. **Progress sub-screen** — per-lift sparklines, filter chips, plateau detection.
10. **Body sub-screen** — weight + measurements + photos with PIN gate. Supabase Storage setup.
11. **Weekly digest evolution** — promote Patterns screen to digest, add thesis + signals + experiment sections, lens chips. `tide_digests` table.
12. **Cross-app: Tide → Course** — Course reads Tide's daily Pulse to soften its own pulse on recovery days. Digest experiments push to Course as goals.
13. **Apple Health pull** (deferred — v2.1) — Workouts and weight auto-import.
14. **Cleanup migration** — Drop `tide_sessions`, `tide_drinks`, `tide_other_substances` after one release of confidence.

Bump `CACHE_NAME` in `sw.js` on every deploy. New PNG assets need to be added to `STATIC_ASSETS`.

---

## Open Questions / Spec Notes

- **Apple Health pull mechanism.** PWA can't read HealthKit directly. Options: (a) Shortcuts deeplink that writes to Supabase on schedule, (b) defer to v2.1 and ship Train with Oura + manual only. **Decision: ship v2.0 without Apple Health pull. v2.1 to follow.**
- **`tide_pulses` server-side storage.** Worth persisting past Pulses so the digest can reference yesterday's interpretation? **Decision: localStorage only for v2.0; add server-side if digest needs it.**
- **Body photo privacy beyond PIN.** Signed URLs with short TTL is the floor. PIN-gating the section entirely is the v2 choice. **Decision: PIN + signed URLs; per-photo hide affordance via long-press.**
- **Pulse generation cost.** One Claude call per day per device on first open. Negligible cost-wise. **Decision: cache aggressively, regenerate only on explicit pull-to-refresh.**
- **Strength log templates.** Hard-code the five-day split or build via Workouts screen? **Decision: data-driven via Workouts screen. Pre-seed with empty Push/Pull/Leg if helpful, but no hardcoded templates.**
- **Sunday digest experiment commitment.** Soft prompt in Tide or push to Course? **Decision: "Commit" button pushes to Course as a goal. "Pick another" cycles candidates.**
- **Coded substance frequency analysis.** Patterns currently buckets alcohol drinks per night. Coded substance frequency stays unaggregated for v2.0. Revisit if requested.
- **Tag-as-recipe.** "Recipe" tag on Library entries (multi-ingredient prep) — Claude infers during estimation. Doesn't change behavior in v2.0 but enables future recipe filter.
- **Edit a logged entry.** All entries (water, caffeine, food, alcohol, coded, strength sets) support tap-to-edit. Time editable always; type/units editable until parent session ends (where applicable).

---

## Mockups (committed alongside spec)

In repo order:
- `pulse-home.html` — three states (high readiness / recovery override / mid-day correction)
- `train-today.html` — strength session in progress with PR, Oura cardio, Steam recovery card
- `train-progress-body.html` — Progress (per-lift sparklines) + Body (weight + measurements + PIN gate)
- `fuel-home.html` — mid-afternoon with lunch logged
- `fuel-library.html` — full meal bank with search/filter
- `sip-stack.html` — Sip water section + Stack with streaks
- `indulge-active.html` — mid-pace with BAC and intention fused
- `indulge-empty-reflection.html` — Indulge empty state (inline form) + Reflection prompt on Pulse home
- `weekly-digest.html` — expanded digest view

Plus archived exploration files:
- `action-button-variations.html` — solid black locked
- `tab-strip-variations.html` — bottom icon bar locked
- `indulge-intention-variations.html` (A/B/C/D) + `indulge-intention-v2.html` (E/F) — F (fused with pace) locked

---

*Spec ready for Claude Code handoff. Mockups committed. Build order locked. Migrations to ship date-ordered under `migrations/`.*
