# Watch drink logging

Log a drink from the Apple Watch with one tap. Tide counts the night, works out
the pace and a BAC range, and pings you on Telegram once you hit the threshold
(default: drink 4). No app open, no session to start first.

- Endpoint: `https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/drink-log`
- Source: `supabase/functions/drink-log/index.ts`
- Token: on the Mac at `~/.tide-drink-token` (chmod 600, never committed)

---

## 1. Build the Shortcut — duplicate the capture one

The existing **capture** shortcut is already the exact shape this needs:

```
Dictate Text  →  Get Contents of URL (POST, body = File: Dictated Text)  →  Show Notification
```

So: **duplicate it, change two fields.**

| Field | Change to |
| --- | --- |
| URL | `https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/drink-log` |
| Header name | `x-tide-token` (was `x-capture-key`) |
| Header value | *(paste from `~/.tide-drink-token`)* |

Leave everything else alone — Dictate Text, `Request Body: File`, the
`Dictated Text` variable, and Show Notification with `Contents of URL` all work
as-is. The endpoint reads the raw dictated text and always answers with one
short line, same contract as `capture`.

Name it **Drink**, put it on a watch face complication, turn off "Show When Run".

### What you can say

| Say | Does |
| --- | --- |
| "beer" / "IPA" / "glass of red" / "martini" / "bourbon" | logs one |
| "two beers" / "couple of beers" / "3 beers" | logs that many |
| "double whiskey" | logs at 2 units |
| "half a beer" / "light pour of wine" | logs at half units |
| "where am I at" / "how many have I had" / "status" | readout, logs nothing |
| "undo" / "scratch that" / "never mind" | deletes the last drink |
| "done for the night" / "calling it" / "heading home" | closes the session |

Anything it doesn't recognise is **refused, not guessed** — it answers
"Didn't catch that" rather than writing a phantom drink into a real record.

Below the alert threshold the notification is a receipt (`Logged beer · drink 2
tonight.`). At the threshold and above it's the full readout, and Telegram gets
a copy.

### If you'd rather tap than talk

Same shortcut, minus the Dictate step. Either delete it and send an empty body
(logs a beer), or set `Request Body: JSON` with a `type` field. A
**Choose from Menu** action in front — `Beer` / `Wine` / `Cocktail` / `Spirits`
— gives you a four-way tap with no dictation.

Both styles can coexist; separate shortcuts, same endpoint.

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
| `heard` | the dictated phrase, when there was one |
| `logged` | how many entries this request wrote |
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
| `count` | `1` | Log several at once, capped at 6 |
| `at` | now | ISO timestamp, for backfilling a drink you forgot |
| `action` | `log` | `log` / `status` / `undo` / `end` |
| `force` | off | `1` returns the readout even below the threshold |
| `format` | see below | `text` for a bare sentence, `json` for the full object |

Token can also go in the query string (`?t=...`) if a client can't set headers.

**Body shapes.** A body starting with `{` is parsed as JSON; anything else is
treated as a dictated phrase. An empty POST body logs a default drink. The
response defaults to plain text for dictated and empty bodies (that's the Show
Notification path) and to JSON when a JSON body was sent — `format` overrides
either way.

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

Early in a night nothing has absorbed yet, so the current range is genuinely
`.000-.000`. That reads as a broken sensor, so the readout leads with the peak
range and the word "soon" until something has actually landed.

Pace is quoted as a rate only once 45 minutes have passed. Before that it says
"3 in 20min" — the count is real, but "9.0/hr" extrapolates an hour of
behaviour from a window too short to contain one.

The same math lives twice: here and in `computeBAC` in `index.html`. **They must
stay in step**, or the watch and the phone will report different numbers on the
same night.

## Tests

```
node tests/bac-parity.mjs    # the two copies of the BAC math agree
node tests/drink-phrase.mjs  # dictation parses, and commands never log a drink
```

The second one matters more than it looks. The stakes are asymmetric: a drink
misheard as a command just makes you say it again, but a command misheard as a
drink writes a phantom entry into a real drinking record. Every command phrase
is asserted not to parse as a log.

## Sessions

There is no "start the night" step from the watch. The first drink opens a
session; every drink after joins it. After `TIDE_SESSION_GAP_H` hours with no
drinks the session closes at the time of the last drink (not at the time you
noticed), and the next drink starts a new one.

Sessions opened this way carry `note: 'started from watch'` and their entries
carry `notes: 'watch'` — handy for finding them, and for cleaning up test rows.
