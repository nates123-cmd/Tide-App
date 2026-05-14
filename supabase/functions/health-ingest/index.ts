// Supabase Edge Function: health-ingest
// Accepts a batch of HealthKit-style workouts from an iOS Shortcut (or
// Health Auto Export, etc.) and writes them into tide_activities with
// source=apple_health. Dedupes on metadata.external_id so re-running
// the same Shortcut is safe.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });

const SB = Deno.env.get("SUPABASE_URL");
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");

const HK_MAP = {
  Running: { type: "Run", category: "cardio" },
  Walking: { type: "Walk", category: "cardio" },
  Hiking: { type: "Hike", category: "cardio" },
  Cycling: { type: "Bike", category: "cardio" },
  Swimming: { type: "Swim", category: "cardio" },
  Rowing: { type: "Rowing", category: "cardio" },
  Elliptical: { type: "Elliptical", category: "cardio" },
  StairClimbing: { type: "Stair Climber", category: "cardio" },
  StepTraining: { type: "Stair Climber", category: "cardio" },
  HighIntensityIntervalTraining: { type: "HIIT", category: "cardio" },
  FunctionalStrengthTraining: { type: "Strength", category: "strength" },
  TraditionalStrengthTraining: { type: "Strength", category: "strength" },
  CoreTraining: { type: "Core", category: "strength" },
  Yoga: { type: "Yoga", category: "recovery" },
  Pilates: { type: "Pilates", category: "recovery" },
  MindAndBody: { type: "Mindfulness", category: "recovery" },
  FlexibilityTraining: { type: "Stretching", category: "recovery" },
  Cooldown: { type: "Cooldown", category: "recovery" },
  Other: { type: "Workout", category: "cardio" },
};

function normalizeWorkout(w) {
  if (!w || typeof w !== "object") return null;
  const externalId = w.external_id || w.uuid || w.id;
  if (!externalId) return null;
  const rawType = String(w.type || w.workout_type || w.activity || "").replace(/\s+/g, "");
  const mapped = HK_MAP[rawType] || HK_MAP[rawType.replace(/^HKWorkoutActivityType/, "")] || HK_MAP.Other;
  const start = w.start || w.start_date || w.startDate || w.startedAt;
  const end = w.end || w.end_date || w.endDate || w.endedAt;
  const startMs = start ? new Date(start).getTime() : null;
  const endMs = end ? new Date(end).getTime() : null;
  let duration_min = null;
  if (w.duration_min != null && Number.isFinite(Number(w.duration_min))) duration_min = Math.round(Number(w.duration_min));
  else if (Number.isFinite(startMs) && Number.isFinite(endMs)) duration_min = Math.max(1, Math.round((endMs - startMs) / 60000));
  else if (w.duration_sec != null) duration_min = Math.max(1, Math.round(Number(w.duration_sec) / 60));
  const date = Number.isFinite(startMs) ? new Date(startMs).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const logged_at = Number.isFinite(startMs) ? new Date(startMs).toISOString() : new Date().toISOString();
  const metadata = { external_id: externalId, hk_type: rawType || null };
  if (w.distance_m != null) metadata.distance_m = Number(w.distance_m);
  if (w.distance_km != null) metadata.distance_m = Number(w.distance_km) * 1000;
  if (w.distance_mi != null) metadata.distance_m = Number(w.distance_mi) * 1609.34;
  if (w.energy_kcal != null) metadata.energy_kcal = Number(w.energy_kcal);
  if (w.kcal != null) metadata.energy_kcal = Number(w.kcal);
  if (w.avg_hr != null) metadata.avg_hr = Number(w.avg_hr);
  if (w.heart_rate != null) metadata.avg_hr = Number(w.heart_rate);
  return {
    external_id: externalId,
    row: { date, type: mapped.type, category: mapped.category, duration_min, source: "apple_health", logged_at, metadata },
  };
}

async function sbFetch(path, opts = {}) {
  const r = await fetch(`${SB}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  if (r.status === 204) return null;
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const list = Array.isArray(body?.workouts) ? body.workouts : Array.isArray(body) ? body : null;
  if (!list) return json({ error: "expected workouts array" }, 400);
  const normalized = list.map(normalizeWorkout).filter(Boolean);
  if (!normalized.length) return json({ inserted: 0, skipped: 0, ignored: list.length });
  const dates = [...new Set(normalized.map(n => n.row.date))];
  const minDate = dates.slice().sort()[0];
  const maxDate = dates.slice().sort().slice(-1)[0];
  let existing = [];
  try {
    existing = await sbFetch(`/tide_activities?source=eq.apple_health&date=gte.${minDate}&date=lte.${maxDate}&select=metadata`) || [];
  } catch (e) {
    return json({ error: "dedup lookup failed: " + e.message }, 502);
  }
  const seen = new Set(existing.map(r => r?.metadata?.external_id).filter(Boolean));
  const toInsert = normalized.filter(n => !seen.has(n.external_id)).map(n => n.row);
  if (!toInsert.length) return json({ inserted: 0, skipped: normalized.length });
  try {
    await sbFetch("/tide_activities", { method: "POST", body: JSON.stringify(toInsert), headers: { Prefer: "return=minimal" } });
  } catch (e) {
    return json({ error: "insert failed: " + e.message }, 502);
  }
  return json({ inserted: toInsert.length, skipped: normalized.length - toInsert.length });
});
