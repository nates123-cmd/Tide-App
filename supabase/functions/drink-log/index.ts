// Supabase Edge Function: drink-log
//
// One-tap drink logging from an Apple Watch / iPhone Shortcut, with a
// server-computed readout (count, pace, BAC range, sober-by) returned inline
// and optionally pushed to Telegram once the session crosses an alert
// threshold.
//
// Why server-side: the watch cannot run the PWA. The Shortcut fires a single
// HTTP call and gets back a finished sentence — no app open, no session setup.
//
// Deploy:
//   supabase functions deploy drink-log --no-verify-jwt
//
// Secrets:
//   TIDE_DRINK_TOKEN      required — shared secret the Shortcut sends
//   OWNER_ID              required — whose rows to write (service role bypasses RLS).
//                         Already set suite-wide; TIDE_DRINK_USER_ID overrides it.
//   TIDE_DRINK_ALERT_AT   optional — notify from this drink count up (default 4)
//   TELEGRAM_BOT_TOKEN    optional — already set suite-wide; enables the Telegram echo
//   TELEGRAM_CHAT_ID      optional — already set suite-wide
//   TIDE_SESSION_GAP_H    optional — hours of no drinks that ends a night (default 8)
//
// Usage (Shortcut → Get Contents of URL):
//   POST {SB_URL}/functions/v1/drink-log
//   Header: x-tide-token: <TIDE_DRINK_TOKEN>
//   Body:   {"type":"beer"}
//   or GET  {SB_URL}/functions/v1/drink-log?t=<token>&type=beer&format=text
//
// Actions: log (default) | status | undo | end

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-tide-token",
};

const SB = Deno.env.get("SUPABASE_URL");
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");
const TOKEN = Deno.env.get("TIDE_DRINK_TOKEN") || "";
// OWNER_ID is the suite-wide "this is Nate" secret; TIDE_DRINK_USER_ID exists
// only to point the watch at a different account without touching the rest.
const USER_ID = Deno.env.get("TIDE_DRINK_USER_ID") || Deno.env.get("OWNER_ID") || "";
const ALERT_AT = Number(Deno.env.get("TIDE_DRINK_ALERT_AT") || 4);
const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
const TG_CHAT = Deno.env.get("TELEGRAM_CHAT_ID") || "";
const TZ = Deno.env.get("TIDE_TZ") || "America/New_York";

// A session is "the same night" until this many hours pass with no drink.
const SESSION_GAP_H = Number(Deno.env.get("TIDE_SESSION_GAP_H") || 8);

// A bare tap that repeats within this many seconds is treated as a double-tap,
// not a second drink. A watch complication that seems not to respond gets
// pressed again; an inflated count is worse than a missed one you can retap.
const DEDUPE_SEC = Number(Deno.env.get("TIDE_DRINK_DEDUPE_SEC") || 45);

// Default standard units per drink type — mirrors the app's log-drink presets.
// `standard` is the one-tap default: Nate decides what counts as a drink, and
// the button does not ask. Typing it `beer` would quietly corrupt both the
// calorie estimate and the by-type patterns.
const UNITS = { standard: 1, beer: 1, wine: 1, spirits: 1, cocktail: 1.4, shot: 1 };
// Order matters: parsePhrase takes the FIRST alias it finds in a spoken phrase,
// so the vague ones ("glass", "drink") sit last. Otherwise "a glass of whiskey"
// matches `glass` and logs wine.
const TYPE_ALIASES = {
  standard: "standard",
  beer: "beer", ipa: "beer", lager: "beer", pint: "beer",
  wine: "wine", red: "wine", white: "wine",
  spirits: "spirits", liquor: "spirits", whiskey: "spirits", whisky: "spirits",
  vodka: "spirits", gin: "spirits", tequila: "spirits", shot: "spirits",
  bourbon: "spirits", scotch: "spirits", rum: "spirits", neat: "spirits",
  cocktail: "cocktail", martini: "cocktail", margarita: "cocktail", mixed: "cocktail",
  // vague — last resort only
  glass: "wine", drink: "cocktail",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
// Always a short line, never blank — the string is rendered verbatim in a watch
// notification, and a silent response reads as "did that work?". Same contract
// as the `capture` function: the line names the outcome so a misparse gets
// caught at the wrist instead of quietly landing a phantom drink.
const text = (body, status = 200) =>
  new Response(body + "\n", {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...CORS },
  });

// ---------------------------------------------------------------------------
// Dictation parsing
// ---------------------------------------------------------------------------
// The watch shortcut is a copy of the `capture` one: Dictate Text -> POST the
// raw text as the body -> Show Notification with the response. So the body
// arrives as a spoken phrase, not JSON. No LLM here — the vocabulary is four
// drinks and four commands, and a round trip to a model would add a second of
// latency and a failure mode to a button pressed in a bar.
const NUM_WORDS = {
  a: 1, an: 1, one: 1, two: 2, couple: 2, three: 3, four: 4, five: 5, six: 6,
};

function parsePhrase(input) {
  const s = String(input).toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;

  // Commands first, and deliberately phrase-level rather than keyword-level.
  // A bare "done" or "check" is too easy to say in passing; mistaking one for a
  // command is recoverable, but mistaking a command for a drink is not.
  if (/\b(undo|scratch that|delete that|remove that|never ?mind|my mistake|didn't have|didnt have)\b/.test(s)) {
    return { action: "undo" };
  }
  if (/\b(end (the )?(session|night)|done for the night|call(ing)? it|that's it|thats it|heading home|wrap(ping)? up|last call)\b/.test(s)) {
    return { action: "end" };
  }
  if (/\b(status|where am i|how many|how am i|how'?s it going|hows it going|check in|read out|readout|update me)\b/.test(s)) {
    return { action: "status" };
  }

  // Drink type: first alias that appears as a whole word or a plural of one.
  // Resolved to the canonical type here so there is one layer of truth.
  let type = null;
  for (const [alias, canonical] of Object.entries(TYPE_ALIASES)) {
    if (new RegExp(`\\b${alias}s?\\b`).test(s)) { type = canonical; break; }
  }
  if (!type) return { action: "unknown" };

  // "two beers" -> two entries. Count is the headline number, so folding this
  // into units would undercount the night.
  let count = 1;
  const numMatch = s.match(/\b(\d+|a|an|one|two|couple|three|four|five|six)\b(?=[^.]*\b\w*(?:beer|wine|spirit|liquor|whiskey|vodka|gin|tequila|shot|cocktail|drink|glass|pint|martini))/);
  if (numMatch) count = Number(numMatch[1]) || NUM_WORDS[numMatch[1]] || 1;
  count = Math.min(6, Math.max(1, count));

  // Pour size modifiers.
  let unitScale = 1;
  if (/\b(double|stiff|heavy)\b/.test(s)) unitScale = 2;
  else if (/\b(half|light|small|splash)\b/.test(s)) unitScale = 0.5;

  return { action: "log", type, count, unitScale };
}

async function sbFetch(path, opts = {}) {
  const r = await fetch(`${SB}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: opts.method === "POST" ? "return=representation" : (opts.method === "PATCH" ? "return=representation" : ""),
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  if (r.status === 204) return null;
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

// --- local (NY) calendar helpers -------------------------------------------
// The function runs in UTC; log_date has to match what the app writes from the
// phone, otherwise a 9pm drink lands on tomorrow's Fuel ring.
function localDate(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function localTime(d) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true })
    .format(d).replace(/\s/g, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// BAC — Widmark with a Watson body-water r factor and an explicit uncertainty
// band. A point estimate reads as precision the model does not have; a range is
// the honest shape. Awareness only, never a fitness-to-drive test.
// ---------------------------------------------------------------------------
//
// r (Widmark factor) = total body water / (0.806 L/kg * body mass). Watson's
// TBW regression uses age + height + weight, so it beats the flat 0.68/0.55
// male/female constants. The band is +/-7% on r (roughly Watson's reported SE),
// crossed with an elimination rate of 0.0135-0.018 %/hr and an absorption time
// of 25 min (fasted) to 60 min (with food). Those three are deliberately NOT
// pushed to their individual extremes: stacking three worst cases compounds
// into a band so wide it stops meaning anything (a .000-.052 read is not a
// read). Tuned so the midpoint lands on published BAC-chart values.
function widmarkR(profile) {
  const kg = Number(profile.weight_lb) * 0.453592;
  const cm = Number(profile.height_in) * 2.54;
  const age = Number(profile.age);
  const female = String(profile.gender || "").toLowerCase().startsWith("f");
  if (!kg || !cm || !age) return female ? 0.55 : 0.68; // fall back to the classic constants
  const tbw = female
    ? -2.097 + 0.1069 * cm + 0.2466 * kg
    : 2.447 - 0.09516 * age + 0.1074 * cm + 0.3362 * kg;
  const r = tbw / (0.806 * kg);
  // Clamp to physiologically plausible territory so a bad profile row can't
  // produce a scary or a flattering nonsense number.
  return Math.min(0.85, Math.max(0.40, r));
}

// Grams of ethanol absorbed into blood by `nowMs`, given a linear absorption
// ramp of `absorbMin` from the moment each drink was logged.
function absorbedGrams(drinks, nowMs, absorbMin) {
  return drinks.reduce((sum, d) => {
    const g = (Number(d.standard_units) || 1) * 14;
    const mins = (nowMs - new Date(d.entry_at).getTime()) / 60000;
    const frac = Math.max(0, Math.min(1, mins / absorbMin));
    return sum + g * frac;
  }, 0);
}

function computeBac(drinks, profile, now = new Date()) {
  if (!drinks.length || !profile) return null;
  const nowMs = now.getTime();
  const kg = Number(profile.weight_lb) * 0.453592;
  if (!kg) return null;
  const bodyG = kg * 1000;
  const r = widmarkR(profile);
  const rLow = r * 0.93;   // less body water -> higher BAC
  const rHigh = r * 1.07;
  const firstMs = new Date(drinks[0].entry_at).getTime();
  const hrs = Math.max(0, (nowMs - firstMs) / 3600000);

  // High bound: fast absorption, small r, slow elimination.
  const high = Math.max(0, (absorbedGrams(drinks, nowMs, 25) / (bodyG * rLow)) * 100 - 0.0135 * hrs);
  // Low bound: slow absorption, large r, fast elimination.
  const low = Math.max(0, (absorbedGrams(drinks, nowMs, 60) / (bodyG * rHigh)) * 100 - 0.018 * hrs);
  // Central: the headline number.
  const mid = Math.max(0, (absorbedGrams(drinks, nowMs, 40) / (bodyG * r)) * 100 - 0.0155 * hrs);

  // Peak still to come. The drink you just logged contributes ~nothing to the
  // current number (it is still in your stomach), so a readout fired at the
  // moment of logging would otherwise ignore the very drink that triggered it.
  // Peak is evaluated at the time the last drink finishes absorbing.
  const totalG = drinks.reduce((s, d) => s + (Number(d.standard_units) || 1) * 14, 0);
  const lastMs = new Date(drinks[drinks.length - 1].entry_at).getTime();
  const peakMs = Math.max(nowMs, lastMs + 25 * 60000);
  const peakHrs = (peakMs - firstMs) / 3600000;
  const minsToPeak = Math.max(0, Math.round((peakMs - nowMs) / 60000));
  const peak = Math.max(0, (totalG / (bodyG * r)) * 100 - 0.0155 * peakHrs);
  const peakHigh = Math.max(high, (totalG / (bodyG * rLow)) * 100 - 0.0135 * peakHrs);
  const peakLow = Math.max(low, (totalG / (bodyG * rHigh)) * 100 - 0.018 * peakHrs);

  // Sober-by counts from the peak, not from now, and uses the pessimistic
  // bound — the number should never flatter.
  const clearHrs = minsToPeak / 60 + peakHigh / 0.0135;
  const under08Hrs = peakHigh > 0.08 ? minsToPeak / 60 + (peakHigh - 0.08) / 0.0135 : 0;
  let status = "safe";
  if (peakHigh >= 0.08) status = "over";
  else if (peakHigh >= 0.05) status = "high";
  else if (peakHigh >= 0.02) status = "moderate";
  return { low, mid, high, peak, peakHigh, peakLow, minsToPeak, r, clearHrs, under08Hrs, status };
}

function computePace(drinks, now = new Date()) {
  if (!drinks.length) return { perHour: 0, total: 0, minSinceLast: null, elapsedHr: 0, status: "none" };
  const nowMs = now.getTime();
  const firstMs = new Date(drinks[0].entry_at).getTime();
  const lastMs = new Date(drinks[drinks.length - 1].entry_at).getTime();
  const rawHr = (nowMs - firstMs) / 3600000;
  const elapsedHr = Math.max(rawHr, 0.25);
  const total = drinks.reduce((s, d) => s + (Number(d.standard_units) || 1), 0);
  const perHour = total / elapsedHr;
  // Three drinks in twenty minutes is a real thing to say; "9.0/hr" is not —
  // it extrapolates an hour of behaviour from a window too short to contain
  // one. Below 45 minutes the readout quotes the raw count instead.
  const settled = rawHr >= 0.75;
  let status = "easy";
  if (perHour >= 2.5) status = "fast";
  else if (perHour >= 1.5) status = "moderate";
  // `now` is captured before the insert, and a multi-drink batch spaces its
  // rows by a millisecond each, so the last drink can sit fractionally in the
  // future. Floor at zero rather than reporting "last -1min ago".
  const minSinceLast = Math.max(0, Math.floor((nowMs - lastMs) / 60000));
  return { perHour, total, minSinceLast, elapsedHr, rawHr, settled, status };
}

const bacStr = (n) => n.toFixed(3).replace(/^0/, "");
function fmtMins(m) {
  if (m == null) return "";
  if (m < 60) return `${m}min`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`;
}
const fmtHrs = (h) => fmtMins(Math.round(h * 60));

// One readout, two shapes: a short title for a watch banner and a body line.
function buildReadout(drinks, profile, now = new Date()) {
  const pace = computePace(drinks, now);
  const bac = computeBac(drinks, profile, now);
  const n = drinks.length;
  const unitStr = Math.abs(pace.total - n) < 0.05 ? "" : ` · ${pace.total.toFixed(1)} units`;

  // Early in a session nothing has absorbed, so the current range is .000-.000
  // and reads as a broken sensor. Lead with where the night is landing instead.
  const stillLanding = !!bac && bac.high < 0.005 && bac.peakHigh >= 0.005;
  let title;
  if (!bac) title = `Drink ${n}${unitStr}`;
  else if (stillLanding) title = `Drink ${n} · BAC ~${bacStr(bac.peakLow)}-${bacStr(bac.peakHigh)} soon`;
  else title = `Drink ${n} · BAC ~${bacStr(bac.low)}-${bacStr(bac.high)}`;

  const bits = [];
  // One drink in, a rate is an artefact of the elapsed-time floor rather than a
  // pace. Under 45 minutes, quote what actually happened.
  if (n >= 2) {
    bits.push(pace.settled
      ? `${pace.perHour.toFixed(1)}/hr over ${fmtHrs(pace.elapsedHr)}`
      : `${n} in ${fmtHrs(pace.elapsedHr)}`);
  }
  bits.push(pace.minSinceLast === 0 ? "just now" : `last ${fmtMins(pace.minSinceLast)} ago`);
  if (unitStr) bits.push(`${pace.total.toFixed(1)} units`);
  let body = bits.join(" · ") + ".";

  if (bac) {
    // The just-logged drink has not absorbed yet, so say where it lands —
    // unless the title already carried the peak.
    if (!stillLanding && bac.peakHigh > bac.high + 0.004) {
      body += ` Heading to ~${bacStr(bac.peakLow)}-${bacStr(bac.peakHigh)}`;
      body += bac.minsToPeak > 2 ? ` in ~${fmtMins(bac.minsToPeak)}.` : ".";
    } else if (stillLanding && bac.minsToPeak > 2) {
      body += ` Landing in ~${fmtMins(bac.minsToPeak)}.`;
    }
    const clearAt = new Date(now.getTime() + bac.clearHrs * 3600000);
    if (bac.status === "over") {
      const okAt = new Date(now.getTime() + bac.under08Hrs * 3600000);
      body += ` Over .08 territory — under it ~${localTime(okAt)}, clear ~${localTime(clearAt)}.`;
    } else if (bac.status === "high") {
      body += ` Impairment range. Clear ~${localTime(clearAt)}.`;
    } else if (bac.peakHigh >= 0.005) {
      body += ` Clear ~${localTime(clearAt)}.`;
    }
  }
  return { title, body, line: `${title}\n${body}`, pace, bac, count: n, units: pace.total };
}

// Flatten the readout into a Shortcut-friendly shape (no nested objects that
// "Get Dictionary Value" would have to walk).
function strip(r) {
  return {
    title: r.title,
    body: r.body,
    text: r.line,
    count: r.count,
    units: Number(r.units.toFixed(2)),
    per_hour: Number(r.pace.perHour.toFixed(2)),
    min_since_last: r.pace.minSinceLast,
    pace_status: r.pace.status,
    bac_low: r.bac ? Number(r.bac.low.toFixed(4)) : null,
    bac_mid: r.bac ? Number(r.bac.mid.toFixed(4)) : null,
    bac_high: r.bac ? Number(r.bac.high.toFixed(4)) : null,
    bac_peak: r.bac ? Number(r.bac.peak.toFixed(4)) : null,
    bac_peak_low: r.bac ? Number(r.bac.peakLow.toFixed(4)) : null,
    bac_peak_high: r.bac ? Number(r.bac.peakHigh.toFixed(4)) : null,
    bac_status: r.bac ? r.bac.status : null,
    clear_in_hours: r.bac ? Number(r.bac.clearHrs.toFixed(2)) : null,
  };
}

async function telegram(msg) {
  if (!TG_TOKEN || !TG_CHAT) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT, text: msg }),
    });
    return r.ok;
  } catch { return false; }
}

// --- session resolution -----------------------------------------------------
// Reuse the open session unless the last drink is more than SESSION_GAP_H old,
// in which case close it out honestly (ended_at = last drink) and start fresh.
// Without this an interrupted session stays open forever and every future
// drink inflates the same count.
async function resolveSession(now, { createIfMissing }) {
  const open = await sbFetch(
    `/tide_indulge_sessions?user_id=eq.${USER_ID}&ended_at=is.null&order=started_at.desc&limit=1`,
  ) || [];
  let session = open[0] || null;

  if (session) {
    const entries = await sbFetch(
      `/tide_indulge_entries?session_id=eq.${session.id}&kind=eq.alcohol&order=entry_at.asc`,
    ) || [];
    const lastMs = entries.length
      ? new Date(entries[entries.length - 1].entry_at).getTime()
      : new Date(session.started_at).getTime();
    const gapH = (now.getTime() - lastMs) / 3600000;
    if (gapH <= SESSION_GAP_H) return { session, entries, resumed: true };

    // Stale — close it at the last real drink, not now.
    const durationMin = Math.max(0, Math.round((lastMs - new Date(session.started_at).getTime()) / 60000));
    await sbFetch(`/tide_indulge_sessions?id=eq.${session.id}`, {
      method: "PATCH",
      body: JSON.stringify({ ended_at: new Date(lastMs).toISOString(), duration_min: durationMin }),
    });
    session = null;
  }

  if (!session && createIfMissing) {
    const rows = await sbFetch("/tide_indulge_sessions", {
      method: "POST",
      body: JSON.stringify({
        user_id: USER_ID,
        started_at: now.toISOString(),
        log_date: localDate(now),
        note: "started from watch",
      }),
    });
    return { session: rows[0], entries: [], resumed: false };
  }
  return { session, entries: [], resumed: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url = new URL(req.url);
  let body = {};
  let phrase = "";
  if (req.method === "POST") {
    // Shortcuts sends "Request Body: File" as raw bytes with no useful
    // content-type, so sniff the payload rather than trusting the header.
    const raw = (await req.text()).trim();
    if (raw.startsWith("{")) {
      try { body = JSON.parse(raw); } catch { phrase = raw; }
    } else if (raw) {
      phrase = raw;
    }
  }
  const spoken = phrase ? parsePhrase(phrase) : null;
  const param = (k) => body[k] ?? url.searchParams.get(k) ?? (spoken ? spoken[k] : null) ?? null;

  const supplied = req.headers.get("x-tide-token") || param("t") || param("token") || "";
  if (!TOKEN || supplied !== TOKEN) return json({ error: "unauthorized" }, 401);
  if (!USER_ID) return json({ error: "TIDE_DRINK_USER_ID not configured" }, 503);

  // A dictated or empty body means a Shortcut wired straight into Show
  // Notification, so answer in prose unless JSON was explicitly asked for.
  const fmt = String(param("format") || "").toLowerCase();
  const wantsText = fmt === "text" || (fmt !== "json" && req.method === "POST" && !Object.keys(body).length);
  const now = new Date();

  if (spoken && spoken.action === "unknown") {
    const msg = `Didn't catch "${phrase.slice(0, 40)}" — say beer, wine, spirits, cocktail, status, or undo.`;
    return wantsText ? text(msg, 400) : json({ error: msg, heard: phrase }, 400);
  }

  const action = String(param("action") || "log").toLowerCase();

  try {
    const profiles = await sbFetch(`/tide_profile?user_id=eq.${USER_ID}&limit=1`) || [];
    const profile = profiles[0] || null;

    // --- end -----------------------------------------------------------------
    if (action === "end") {
      const { session, entries } = await resolveSession(now, { createIfMissing: false });
      if (!session) return wantsText ? text("No session open.") : json({ ok: true, message: "no session open" });
      await sbFetch(`/tide_indulge_sessions?id=eq.${session.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ended_at: now.toISOString(),
          duration_min: Math.max(0, Math.round((now.getTime() - new Date(session.started_at).getTime()) / 60000)),
        }),
      });
      const r = entries.length ? buildReadout(entries, profile, now) : null;
      const msg = r ? `Session closed. ${r.count} drinks. ${r.body}` : "Session closed.";
      return wantsText ? text(msg) : json({ ok: true, ended: true, message: msg });
    }

    // --- undo ----------------------------------------------------------------
    if (action === "undo") {
      const { session, entries } = await resolveSession(now, { createIfMissing: false });
      if (!session || !entries.length) {
        return wantsText ? text("Nothing to undo.") : json({ ok: true, message: "nothing to undo" });
      }
      const last = entries[entries.length - 1];
      await sbFetch(`/tide_indulge_entries?id=eq.${last.id}`, { method: "DELETE" });
      const rest = entries.slice(0, -1);
      const r = rest.length ? buildReadout(rest, profile, now) : null;
      const msg = r ? `Removed. ${r.line}` : "Removed. Back to zero.";
      return wantsText ? text(msg) : json({ ok: true, undone: true, message: msg, count: rest.length });
    }

    // --- status (read-only readout, always answers) ---------------------------
    if (action === "status") {
      const { session, entries } = await resolveSession(now, { createIfMissing: false });
      if (!session || !entries.length) {
        return wantsText ? text("No drinks logged.") : json({ ok: true, count: 0, message: "no drinks logged" });
      }
      const r = buildReadout(entries, profile, now);
      return wantsText ? text(r.line) : json({ ok: true, notify: true, ...strip(r) });
    }

    // --- log -----------------------------------------------------------------
    // No type given means the one-tap button: log a standard drink rather than
    // guessing one, so "what was I drinking" stays an honest unknown.
    const rawType = String(param("type") || param("drink_type") || "standard").toLowerCase().trim();
    const drinkType = TYPE_ALIASES[rawType] || "standard";
    const baseUnits = Number(param("units")) > 0
      ? Number(param("units"))
      : (UNITS[rawType] ?? UNITS[drinkType] ?? 1);
    const units = Number((baseUnits * (Number(param("unitScale")) || 1)).toFixed(2));
    const count = Math.min(6, Math.max(1, Number(param("count")) || 1));
    const at = param("at") ? new Date(param("at")) : now;
    const entryAt = isNaN(at.getTime()) ? now : at;

    const { session, entries: existing } = await resolveSession(now, { createIfMissing: true });

    // Double-tap guard. Only for a plain single log of the same type — an
    // explicit count, a backdated `at`, or force=1 all mean "I meant it".
    const forcedLog = ["1", "true", "yes"].includes(String(param("force") || "").toLowerCase());
    const explicitCount = Number(param("count")) > 1;
    if (!forcedLog && !explicitCount && !param("at") && DEDUPE_SEC > 0 && existing.length) {
      const prev = existing[existing.length - 1];
      const agoSec = (now.getTime() - new Date(prev.entry_at).getTime()) / 1000;
      if (agoSec >= 0 && agoSec < DEDUPE_SEC && prev.drink_type === drinkType) {
        const r0 = buildReadout(existing, profile, now);
        const msg = `Already logged ${Math.round(agoSec)}s ago — not double counting. Still drink ${r0.count} tonight.`;
        if (wantsText) return text(msg);
        return json({ ok: true, duplicate: true, logged: 0, message: msg, notify: false, ...strip(r0) });
      }
    }

    // "two beers" is two rows, not one double — count is the headline number.
    const rows = Array.from({ length: count }, (_, i) => ({
      user_id: USER_ID,
      session_id: session.id,
      kind: "alcohol",
      drink_type: drinkType,
      standard_units: units,
      // Distinct timestamps keep entry ordering stable and stop a catch-up
      // batch from reading as an instantaneous spike.
      entry_at: new Date(entryAt.getTime() + i).toISOString(),
      log_date: localDate(entryAt),
      notes: "watch",
    }));
    const inserted = await sbFetch("/tide_indulge_entries", {
      method: "POST",
      body: JSON.stringify(rows),
    });

    const entries = await sbFetch(
      `/tide_indulge_entries?session_id=eq.${session.id}&kind=eq.alcohol&order=entry_at.asc`,
    ) || [];
    const r = buildReadout(entries, profile, now);

    // Notify from the threshold up, every drink — the point of the alert is the
    // back half of the night, where the count and the pace stop being obvious.
    // `force=1` gets the readout on demand at any count.
    const notify = forcedLog || r.count >= ALERT_AT;

    let telegramSent = false;
    if (notify) telegramSent = await telegram(r.line);

    if (wantsText) {
      // Below the threshold this is a receipt, not an alert: confirm what
      // landed and stop. The full readout is what the threshold is for.
      if (notify) return text(r.line);
      const unitNote = units !== (UNITS[drinkType] ?? 1) ? ` at ${units} units` : "";
      // The one-tap button did not ask what it was, so the receipt should not
      // pretend to name it: "Drink 3 logged." is the whole story.
      if (drinkType === "standard" && count === 1) return text(`Drink ${r.count} logged${unitNote}.`);
      const what = count > 1 ? `${count} × ${drinkType}` : drinkType;
      return text(`Logged ${what}${unitNote} · drink ${r.count} tonight.`);
    }
    return json({
      ok: true,
      notify,
      telegram_sent: telegramSent,
      alert_at: ALERT_AT,
      logged: count,
      heard: phrase || null,
      entry_id: inserted?.[0]?.id ?? null,
      drink_type: drinkType,
      session_id: session.id,
      profile_missing: !profile,
      ...strip(r),
    });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 502);
  }
});
