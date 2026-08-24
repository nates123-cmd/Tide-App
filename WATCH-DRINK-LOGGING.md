# Watch drink logging

Log a drink from the Apple Watch with one tap. Tide counts the night, works out
the pace and a BAC range, and pings you on Telegram once you hit the threshold
(default: drink 4). No app open, no session to start first.

- Endpoint: `https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/drink-log`
- Source: `supabase/functions/drink-log/index.ts`
- Token: on the Mac at `~/.tide-drink-token` (chmod 600, never committed)

---

## 1. Build the Shortcut — two actions

This is the whole thing. One tap on the watch = one drink. It does not ask what
kind; you decide what counts as a drink.

Duplicate the **capture** shortcut (it already has the URL action wired up),
then **delete the Dictate Text action** and change these fields:

**Action 1 — Get Contents of URL**

| Field | Value |
| --- | --- |
| URL | `https://xsmnfcmtbpeaccnyinkr.supabase.co/functions/v1/drink-log` |
| Method | `POST` |
| Headers | `x-tide-token` → *(paste from `~/.tide-drink-token`)* |
| Request Body | `JSON`, **no fields** |

**Action 2 — Show Notification** → content `Contents of URL`

Name it **Drink**. In the shortcut's settings turn **off** "Show When Run" so it
fires without opening anything, and leave "Show on Apple Watch" on. Add it to a
watch face complication, or the Shortcuts app on the watch.

That's it. Tap it and you get back:

```
Drink 3 logged.
```

…until the fourth drink, where it switches to the full readout and Telegram
gets a copy too.

### Two things it does on its own

**Untyped drinks.** A bare tap logs `standard` — one standard unit, type
unknown. Nothing guesses "beer" on your behalf, so the calorie estimate and the
by-type patterns stay honest about what they don't know. It shows as **Drink**
in the app.

**Double-tap protection.** A complication that seems not to respond gets
pressed again. A repeat tap within 45 seconds answers
`Already logged 3s ago — not double counting.` and writes nothing. An inflated
count is worse than a missed one you can re-tap. Set `TIDE_DRINK_DEDUPE_SEC=0`
to turn it off, or send `force=1` to log anyway.

## 2. Optional: the talking version

If you ever want to say what it was, the endpoint also accepts dictated text —
so a *second* shortcut can be a straight copy of **capture** with only the URL
and header changed, Dictate Text and all:

```
Dictate Text  →  Get Contents of URL (POST, body = File: Dictated Text)  →  Show Notification
```

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

The dictated path skips the double-tap guard when it names a different type,
since saying "whiskey" right after "beer" is a real second drink.

### Or a menu, if you want type without talking

A **Choose from Menu** action (`Beer` / `Wine` / `Cocktail` / `Spirits`) in
front of the URL action, with `Request Body: JSON` and a `type` field per
branch, gives a four-way tap and no dictation.

All three styles coexist — separate shortcuts, same endpoint.

## 3. Two more worth having

Same URL and header, `Request Body: JSON` with one field:

| Shortcut | Field | Does |
| --- | --- | --- |
| **Where am I at** | `action` → `status` | Readout, logs nothing |
| **Undo drink** | `action` → `undo` | Deletes the last one |

`end` exists too, but a session closes itself after 8 quiet hours, so you never
have to remember it.

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
| `bac_peak_safe` | conservative bound — what `clear_in_hours` and the .08 flag use |
| `clear_in_hours` | hours until BAC reaches zero, from the safety bound |
| `pace_status` | `easy` / `moderate` / `fast` |
| `bac_status` | `safe` / `moderate` / `high` / `over` |

## Request options

| Param | Default | Notes |
| --- | --- | --- |
| `type` | `standard` | `beer`, `wine`, `spirits`, `cocktail`, plus aliases (`ipa`, `whiskey`, `martini`…) |
| `units` | per type | Override standard units (cocktail defaults to 1.4) |
| `count` | `1` | Log several at once, capped at 6 |
| `at` | now | ISO timestamp, for backfilling a drink you forgot |
| `action` | `log` | `log` / `status` / `undo` / `end` |
| `force` | off | `1` logs through the double-tap guard and returns the readout below the threshold |
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
| `TIDE_DRINK_DEDUPE_SEC` | `45` (default) — double-tap window; `0` disables |
| `TIDE_BAC_TOLERANCE` | `regular` (default) or `naive` — display band only, never the safety bound |
| `TIDE_BAC_R_SPREAD` | `0.045` (default) — half-width of the `r` band |

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

The band comes from three things that genuinely vary. Measured contribution on
a 5-drink evening: `r` gave ±.0135, elimination ±.0135, absorption ±.0099 —
combined, ±38% of the estimate, too wide to act on. So each is individualised
as far as it honestly can be:

- `r` — **±4.5%**. Watson's published standard error predicts a *random*
  person; height, weight, age and sex are known here, so most of that variance
  is already resolved.
- elimination — **0.016 to 0.0195 %/hr**, the regular-drinker range. Set by
  `TIDE_BAC_TOLERANCE`; `naive` restores 0.0135–0.018.
- absorption — **30 min** fasted to **50 min** with food.

Net effect is a band about a third narrower than the population default. They
are still deliberately not all pushed to their extremes at once: stacking three
worst cases compounds into something that stops saying anything (an early
version produced `.000–.052`, which is not a reading). The midpoint is tuned to
land on published BAC-chart values.

### The tolerance setting, and what it does not mean

Regular drinkers really do clear ethanol faster — ADH and MEOS are
upregulated, so ~0.018–0.020 %/hr against ~0.015 for infrequent drinkers. Real
mechanism, and it genuinely lowers the number.

Tolerance to the *feeling* is a different thing and lowers nothing. Feeling
fine at four drinks is not evidence of a lower BAC.

So the setting only ever moves the **display band**. Every safety number —
"clear by", and whether .08 is mentioned at all — comes from a separate bound
at population-worst-case `r`, slowest elimination, fastest absorption, and
ignores the tolerance setting entirely. Narrowing an estimate on the strength
of a self-report is defensible; deciding whether someone can drive on the
strength of one is not.

**To narrow this properly:** a ~$30 breathalyzer, one night, readings logged
against drink times. That yields a real personal elimination rate and the band
collapses to something genuinely tight rather than merely plausible. Until
then this is still a model of a population that happens to contain you.

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
