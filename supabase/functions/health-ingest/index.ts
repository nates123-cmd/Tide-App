// Supabase Edge Function: health-ingest
// Accepts a batch of HealthKit-style workouts from an iOS Shortcut (or
// Health Auto Export, etc.) and writes them into tide_activities with
// source='apple_health'. Dedupes on metadata.external_id so re-running
// the same Shortcut is safe.
//
// Deploy via Supabase dashboard (uncheck "Verify JWT") or:
//   supabase functions deploy health-ingest --no-verify-jwt
//
// Expected POST body (any/all fields per workout):
//   {
//     "workouts": [
//       {
//         "external_id": "UUID-from-HealthKit",   // required for dedup
//         "type": "Running",                       // HKWorkoutActivityType name
//         "start": "2026-05-14T07:12:00Z",         // ISO 8601
//         "end":   "2026-05-14T07:54:00Z",         // ISO 8601
//         "duration_min": 42,                      // optional, derived if missing
//         "distance_m": 6800,                      // optional
//         "energy_kcal": 380,                      // optional
//         "avg_hr": 152                            // optional
//       }
//     ]
//   }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Max-Age': '86400',
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY');

// Map HealthKit workout-activity-type names → friendly type + Tide category.
// Strength-coded types route into category='strength'; recovery-shaped types
// (yoga / mind-body) route into 'recovery'; everything else is 'cardio'.
const HK_MAP = {
  Running:              { type: 'Run',                 category: 'cardio'   },
  Walking:              { type: 'Walk',                category: 'cardio'   },
  Hiking:               { type: 'Hike',                category: 'cardio'   },
  Cycling:              { type: 'Bike',                category: 'cardio'   },
  Swimming:             { type: 'Swim',                category: 'cardio'   },
  Rowing:               { type: 'Rowing',              category: 'cardio'   },
  Elliptical:           { type: 'Elliptical',          category: 'cardio'   },
  StairClimbing:        { type: 'Stair Climber',       category: 'cardio'   },
  StepTraining:         { type: 'Stair Climber',       category: 'cardio'   },
  HighIntensityIntervalTraining: { type: 'HIIT',       category: 'cardio'   },
  FunctionalStrengthTraining:    { type: 'Strength',    category: 'strength' },
  TraditionalStrengthTraining:   { type: 'Strength',    category: 'strength' },
  CoreTraining:         { type: 'Core',                category: 'strength' },
  Yoga:                 { type: 'Yoga',                category: 'recovery' },
  Pilates:              { type: 'Pilates',             category: 'recovery' },
  MindAndBody:          { type: 'Mindfulness',         category: 'recovery' },
  FlexibilityTraining:  { type: 'Stretching',          category: 'recovery' },
  Cooldown:             { type: 'Cooldown',            category: 'recovery' },
  Other:                { type: 'Workout',             category: 'cardio'   },
};

function normalizeWorkout(w) {
  if (!w || typeof w !== 'object') return null;
  const externalId = w.external_id || w.uuid || w.id;
  if (!externalId) return null;

  const rawType = String(w.type || w.workout_type || w.activity || '').replace(/\s+/g, '');
  const mapped = HK_MAP[rawType] || HK_MAP[rawType.replace(/^HKWorkoutActivityType/, '')] || HK_MAP.Other;

  const start = w.start || w.start_date || w.startDate || w.startedAt;
  const end   = w.end   || w.end_date   || w.endDate   || w.endedAt;
  const startMs = start ? new Date(start).getTime() : null;
  const endMs   = end   ? new Date(end).getTime()   : null;

  let duration_min = null;
  if (w.duration_min != null && Number.isFinite(Number(w.duration_min))) {
    duration_min = Math.round(Number(w.duration_min));
  } else if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
    duration_min = Math.max(1, Math.round((endMs - startMs) / 60000));
  } else if (w.duration_sec != null) {
    duration_min = Math.max(1, Math.round(Number(w.duration_sec) / 60));
  }

  const date = Number.isFinite(startMs)
    ? new Date(startMs).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const logged_at = Number.isFinite(startMs) ? new Date(startMs).toISOString() : new Date().toISOString();

  // Strength metadata follows the existing chunk-6 shape; cardio + recovery
  // get distance/energy/HR in metadata for the activity card meta line.
  const metadata = {
    external_id: externalId,
    hk_type: rawType || null,
  };
  if (w.distance_m  != null) metadata.distance_m  = Number(w.distance_m);
  if (w.distance_km != null) metadata.distance_m  = Number(w.distance_km) * 1000;
  if (w.distance_mi != null) metadata.distance_m  = Number(w.distance_mi) * 1609.34;
  if (w.energy_kcal != null) metadata.energy_kcal = Number(w.energy_kcal);
  if (w.kcal        != null) metadata.energy_kcal = Number(w.kcal);
  if (w.avg_hr      != null) metadata.avg_hr      = Number(w.avg_hr);
  if (w.heart_rate  != null) metadata.avg_hr      = Number(w.heart_rate);

  return {
    external_id: externalId,
    row: {
      date,
      type: mapped.type,
      category: mapped.category,
      duration_min,
      source: 'apple_health',
      logged_at,
      metadata,
    },
  };
}

async function sbFetch(path, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const r = await fetch(url, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`Supabase ${r.status}: ${txt}`);
  }
  if (r.status === 204) return null;
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Server not configured' }, 500);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: 'Bad JSON body' }, 400); }

  const list = Array.isArray(body?.workouts) ? body.workouts : Array.isArray(body) ? body : null;
  if (!list) return json({ error: 'Expected { workouts: [...] } or [...]' }, 400);

  const normalized = list.map(normalizeWorkout).filter(Boolean);
  if (!normalized.length) return json({ inserted: 0, skipped: 0, ignored: list.length });

  // Dedupe pass: find which external_ids already exist for source=apple_health
  // in the date range we're touching.
  const ids = [...new Set(normalized.map(n => n.external_id))];
  const dates = [...new Set(normalized.map(n => n.row.date))];
  const minDate = dates.slice().sort()[0];
  const maxDate = dates.slice().sort().slice(-1)[0];
  let existing = [];
  try {
    existing = await sbFetch(
      `/tide_activities?source=eq.apple_health` +
      `&date=gte.${minDate}&date=lte.${maxDate}` +
      `&select=metadata`
    ) || [];
  } catch (e) {
    return json({ error: 'Dedup lookup failed: ' + e.message }, 502);
  }
  const seen = new Set(
    existing
      .map(r => r?.metadata?.external_id)
      .filter(Boolean)
  );

  const toInsert = normalized.filter(n => !seen.has(n.external_id)).map(n => n.row);
  if (!toInsert.length) return json({ inserted: 0, skipped: normalized.length });

  try {
    await sbFetch('/tide_activities', {
      method: 'POST',
      body: JSON.stringify(toInsert),
      headers: { Prefer: 'return=minimal' },
    });
  } catch (e) {
    return json({ error: 'Insert failed: ' + e.message }, 502);
  }

  return json({ inserted: toInsert.length, skipped: normalized.length - toInsert.length });
});
