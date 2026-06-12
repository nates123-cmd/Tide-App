// Supabase Edge Function: usda-proxy
// Server-side proxy for USDA FoodData Central (FDC). Keeps the FDC API key off
// the client (per the suite pattern) and gives the browser CORS-free access to
// the search + detail endpoints. USDA data is public-domain and clean, so it is
// the TRUSTED nutrition fallback when Open Food Facts returns nothing or fails
// Tide's Atwater sanity check.
//
// Deploy:
//   supabase functions deploy usda-proxy --no-verify-jwt
//
// Secret (one-time):
//   supabase secrets set USDA_FDC_KEY=<your-free-fdc-key>   // get one at https://fdc.nal.usda.gov/api-key-signup.html
//   // TODO: set USDA_FDC_KEY secret
//
// Usage from the client (apikey + Authorization headers required by Supabase):
//   GET {SB_URL}/functions/v1/usda-proxy?q={term}            → search, returns { foods: [...] }
//   GET {SB_URL}/functions/v1/usda-proxy?fdcId={id}          → single food detail

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Max-Age": "86400",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });

// Prefer a real free FDC key (USDA_FDC_KEY secret) for full rate limits. Falls
// back to api.data.gov's shared DEMO_KEY so the proxy works out-of-box for a
// single-user suite (DEMO_KEY: ~30 req/hr, 50/day per IP — enough as an OFF
// fallback that only fires on misses). Set the real key to lift the cap:
//   supabase secrets set USDA_FDC_KEY=<key>   // https://fdc.nal.usda.gov/api-key-signup.html
const FDC_KEY = Deno.env.get("USDA_FDC_KEY") || "DEMO_KEY";
const FDC_BASE = "https://api.nal.usda.gov/fdc/v1";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  if (!FDC_KEY) {
    return json({ error: "USDA_FDC_KEY not configured" }, 503);
  }

  const reqUrl = new URL(req.url);
  const fdcId = reqUrl.searchParams.get("fdcId");
  const q = reqUrl.searchParams.get("q");

  try {
    // --- Single food detail ---
    if (fdcId) {
      const u = new URL(`${FDC_BASE}/food/${encodeURIComponent(fdcId)}`);
      u.searchParams.set("api_key", FDC_KEY);
      const up = await fetch(u.toString());
      if (!up.ok) return json({ error: `Upstream ${up.status}` }, 502);
      return json(await up.json());
    }

    // --- Search ---
    if (q && q.trim().length >= 2) {
      const u = new URL(`${FDC_BASE}/foods/search`);
      u.searchParams.set("api_key", FDC_KEY);
      u.searchParams.set("query", q.trim());
      // Branded + Foundation + SR Legacy cover packaged products and generic whole foods.
      u.searchParams.set("dataType", "Branded,Foundation,SR Legacy,Survey (FNDDS)");
      u.searchParams.set("pageSize", "15");
      const up = await fetch(u.toString());
      if (!up.ok) return json({ error: `Upstream ${up.status}` }, 502);
      const data = await up.json();
      // Pass through the foods array (each item carries foodNutrients + servingSize).
      return json({ foods: data.foods || [] });
    }

    return json({ error: "Missing q or fdcId parameter" }, 400);
  } catch (e) {
    return json({ error: "Fetch failed: " + e.message }, 502);
  }
});
