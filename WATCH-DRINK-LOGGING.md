# Watch drink logging

Log a drink from the Apple Watch with one tap. Tide counts the night, works out
the pace and a BAC range, and pings you on Telegram once you hit the threshold
(default: drink 4). No app open, no session to start first.

- Endpoint: `https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/drink-log`
- Source: `supabase/functions/drink-log/index.ts`
- Token: on the Mac at `~/.tide-drink-token` (chmod 600, never committed)

---

## 1. Build the Shortcut

Shortcuts app on the **iPhone** → new shortcut → name it **Drink**. Anything you
build on the phone shows up on the watch as long as "Show on Apple Watch" is on
in the shortcut's settings (it is by default).

**Action 1 — Choose from Menu** (skip this if you want a single generic drink)

Prompt: `What?` — menu items: `Beer`, `Wine`, `Cocktail`, `Spirits`

**Action 2 (inside each menu branch) — Get Contents of URL**

| Field | Value |
| --- | --- |
| URL | `https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/drink-log` |
| Method | `POST` |
| Headers | `x-tide-token` → *(paste from `~/.tide-drink-token`)* |
| Request Body | `JSON` |
| JSON field | `type` (Text) → `beer` / `wine` / `cocktail` / `spirits` |

That is the whole thing. The tap logs the drink; Telegram handles the alert.

Put the shortcut on a watch face complication or in the Shortcuts app on the
watch. Double-check "Show on Apple Watch" and turn **off** "Show When Run" so it
fires silently.

### Optional: notification on the watch itself

If you'd rather not depend on Telegram, add two more actions after the URL call:

1. **Get Dictionary Value** → key `notify`
2. **If** *(Dictionary Value)* **is** `1` →
   **Get Dictionary Value** key `text` → **Show Notification**

The endpoint returns `notify: false` below the threshold, so nothing shows for
the first three drinks. Both paths can run at once — belt and braces.

## 2. Two more shortcuts worth having

Same URL and header, different body:

| Shortcut | Body | Does |
| --- | --- | --- |
| **Where am I at** | `{"action":"status"}` | Readout without logging anything |
| **Undo drink** | `{"action":"undo"}` | Deletes the last drink |
| **Done for the night** | `{"action":"end"}` | Closes the session |

`end` is optional — a session closes itself after 8 hours with no drinks, and
the next drink starts a fresh one.

---

## What comes back

```
Drink 4 · BAC ~.023-.049
2.9/hr over 1h30 · just now · 4.4 units. Heading to ~.053-.075 in ~25min.
Impairment range. Clear ~4:49pm.
```

Full JSON response (useful if you want to build something else on it):

| Field | Meaning |
| --- | --- |
| `notify` | whether this crossed the alert threshold |
| `count` / `units` | drinks logged this session / standard units |
| `per_hour` | units per hour since the first drink |
| `min_since_last` | minutes since the previous drink |
| `bac_low` / `bac_mid` / `bac_high` | estimated BAC range **right now** |
| `bac_peak_low` / `bac_peak_high` | where it lands once everything absorbs |
| `clear_in_hours` | hours until BAC reaches zero, from the pessimistic bound |
| `pace_status` | `easy` / `moderate` / `fast` |
| `bac_status` | `safe` / `moderate` / `high` / `over` |

## Request options

| Param | Default | Notes |
| --- | --- | --- |
| `type` | `beer` | `beer`, `wine`, `spirits`, `cocktail`, plus aliases (`ipa`, `whiskey`, `martini`…) |
| `units` | per type | Override standard units (cocktail defaults to 1.4) |
| `at` | now | ISO timestamp, for backfilling a drink you forgot |
| `action` | `log` | `log` / `status` / `undo` / `end` |
| `force` | off | `1` returns the readout even below the threshold |
| `format` | JSON | `text` returns the bare sentence (empty when not notifying) |

Token can also go in the query string (`?t=...`) if a client can't set headers.

## Config

Supabase function secrets, already set:

| Secret | Value |
| --- | --- |
| `TIDE_DRINK_TOKEN` | the shared secret |
| `TIDE_DRINK_USER_ID` | Nate's auth uuid |
| `TIDE_DRINK_ALERT_AT` | `4` — notify from this drink up |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | reused suite-wide, drives the alert |
| `TIDE_SESSION_GAP_H` | `8` (default) — hours of quiet that end a night |

To change the threshold:

```
supabase secrets set TIDE_DRINK_ALERT_AT=5
supabase functions deploy drink-log --no-verify-jwt
```

---

## How the BAC range is worked out

Widmark, with the `r` factor taken from Watson's total-body-water regression
(age + height + weight) instead of the flat 0.68 male constant. Two people at
214 lb can hold very different amounts of water, and water is what dilutes the
alcohol.

The band comes from three things that genuinely vary:

- `r` — ±7%, roughly Watson's standard error
- elimination — 0.0135 to 0.018 %/hr between people
- absorption — 25 min fasted to 60 min with food

Those are deliberately not all pushed to their extremes at once. Stacking three
worst cases compounds into a band so wide it stops saying anything (an early
version produced `.000–.052`, which is not a reading). The midpoint is tuned to
land on published BAC-chart values.

**A drink you just logged is still in your stomach**, so it adds nothing to the
current number. That's why the readout separates "now" from "heading to" — the
alert that fires *because* of drink 4 would otherwise ignore drink 4 entirely.
"Clear by" counts from the peak, not from now, and uses the pessimistic bound.

Awareness only. Not a fitness-to-drive test — nothing here knows what you ate,
and the real spread between people is wider than any model.

The same math lives twice: here and in `computeBAC` in `index.html`. **They must
stay in step**, or the watch and the phone will report different numbers on the
same night. `parity` check: extract both and compare (see the commit that added
this file).

## Sessions

There is no "start the night" step from the watch. The first drink opens a
session; every drink after joins it. After `TIDE_SESSION_GAP_H` hours with no
drinks the session closes at the time of the last drink (not at the time you
noticed), and the next drink starts a new one.

Sessions opened this way carry `note: 'started from watch'` and their entries
carry `notes: 'watch'` — handy for finding them, and for cleaning up test rows.
