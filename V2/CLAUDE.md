# Tide v2 — Claude Code Brief

This is a v2 redesign of an existing app. Don't start from scratch.

## What to read, in order

1. **`tide-v2-spec.md`** — the canonical spec. Read in full before touching code. Locked design decisions, schema deltas, build order.
2. **`CLAUDE.md`** (the v1 one, archived to `_v1/CLAUDE.md`) — context on the existing stack, conventions, deploy workflow. Most of this still applies.
3. **`mockups/`** — visual ground truth for every screen. When implementing a screen, open the corresponding mockup. Match the layout, typography, and color decisions exactly.

## Repo layout

```
index.html              ← the app (single file, no build step)
sw.js                   ← service worker
manifest.json
schema.sql              ← drop+recreate for fresh installs (update for v2)
migrations/             ← additive SQL migrations, run in date order
mockups/                ← v2 screen mockups
tide-v2-spec.md         ← canonical spec
CLAUDE.md               ← this file
_v1/CLAUDE.md           ← previous brief (still useful for stack/deploy context)
```

## How to work

- **No build step.** Plain HTML/CSS/JS in `index.html`. Same constraint as v1.
- **Schema changes ship as additive migrations** under `migrations/YYYY-MM-DD_description.sql`. `schema.sql` is for fresh installs only. Update both.
- **Bump `CACHE_NAME` in `sw.js`** on every deploy. Add new asset paths to `STATIC_ASSETS`.
- **Match the mockups.** Typography, spacing, color, and component anatomy are decided. Don't reinterpret — match. If you can't match a mockup, ask Nate before improvising.
- **Follow build order** in the spec. Chunk 1 (Pulse home + stat grid + bottom nav) is the foundation; chunk 2 (Indulge unification migration) is the highest-risk surface — get it right before touching anything else that depends on indulge sessions.

## Tone for Claude-generated content

Pulse interpretation, weekly digest narrative, planning hints, Fuel "remaining" hint, etc:

- Tight, imperative, single sentence (Pulse). Slightly longer for digest narrative (2–3 sentences).
- One emphasized clause per sentence, italicized in `--accent-deep`.
- Parenthetical context only when it adds signal.
- No "you" softeners ("you might want to..." → "water before the next").
- No invented numbers. If data is missing, fall back to the neutral copy in the spec.

## Things to ask before doing

- Anything not in the spec or mockups
- Apple Health pull (v2.1, not v2.0)
- Schema migrations that drop columns (vs. additive)
- Anything that changes the suite-wide visual grammar
