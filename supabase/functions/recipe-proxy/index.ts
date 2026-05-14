// Supabase Edge Function: recipe-proxy
// Fetches a recipe URL server-side (CORS-free), extracts any JSON-LD Recipe
// schema blocks, returns a normalized { recipe, title } payload.
//
// Deploy:
//   supabase functions deploy recipe-proxy --no-verify-jwt
//
// Usage from the client:
//   GET {SB_URL}/functions/v1/recipe-proxy?url={encoded-recipe-url}
//   apikey + Authorization headers required by Supabase.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Max-Age': '86400',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });

// Walk a JSON-LD blob in any of the common shapes (single object, array,
// @graph wrapper) and collect every node typed "Recipe".
function collectRecipes(node: any, sink: any[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach((n) => collectRecipes(n, sink));
    return;
  }
  if (typeof node !== 'object') return;
  const t = node['@type'];
  const isRecipe =
    t === 'Recipe' ||
    (Array.isArray(t) && t.includes('Recipe'));
  if (isRecipe) sink.push(node);
  if (node['@graph']) collectRecipes(node['@graph'], sink);
}

function extractServings(r: any): number | null {
  const candidates = [r.recipeYield, r.yield, r['recipe_yield']];
  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === 'number') return c;
    if (typeof c === 'string') {
      const m = c.match(/(\d+)/);
      if (m) return parseInt(m[1], 10);
    }
    if (Array.isArray(c)) {
      for (const item of c) {
        if (typeof item === 'number') return item;
        if (typeof item === 'string') {
          const m = item.match(/(\d+)/);
          if (m) return parseInt(m[1], 10);
        }
      }
    }
  }
  return null;
}

function normalizeIngredients(r: any): string[] {
  const raw = r.recipeIngredient || r.ingredients || [];
  if (!Array.isArray(raw)) return [];
  return raw.map((s: any) => String(s).trim()).filter(Boolean);
}

function normalizeNutrition(r: any): Record<string, string | number> | null {
  const n = r.nutrition;
  if (!n || typeof n !== 'object') return null;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(n)) {
    if (k.startsWith('@')) continue;
    if (v == null) continue;
    out[k] = v as string | number;
  }
  return Object.keys(out).length ? out : null;
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

    const reqUrl = new URL(req.url);
    const target = reqUrl.searchParams.get('url');
    if (!target) return json({ error: 'Missing url parameter' }, 400);

    let parsed: URL;
    try { parsed = new URL(target); }
    catch { return json({ error: 'Bad URL' }, 400); }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return json({ error: 'Only http(s) URLs are allowed' }, 400);
    }

    let html: string;
    try {
      const upstream = await fetch(parsed.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TideRecipeFetcher/1.0)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (!upstream.ok) return json({ error: `Upstream ${upstream.status}` }, 502);
      html = await upstream.text();
    } catch (e) {
      return json({ error: 'Fetch failed: ' + (e as Error).message }, 502);
    }

    // Pull every JSON-LD block; collect Recipe nodes.
    const recipes: any[] = [];
    const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const body = m[1].trim();
      if (!body) continue;
      try {
        const data = JSON.parse(body);
        collectRecipes(data, recipes);
      } catch { /* ignore malformed blocks */ }
    }

    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const pageTitle = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : null;

    if (recipes.length === 0) {
      return json({ recipe: null, title: pageTitle, source_url: parsed.toString() });
    }

    const r = recipes[0];
    return json({
      recipe: {
        name: r.name || pageTitle,
        description: r.description || null,
        servings: extractServings(r),
        ingredients: normalizeIngredients(r),
        nutrition: normalizeNutrition(r),
        url: parsed.toString(),
      },
      title: pageTitle,
      source_url: parsed.toString(),
    });
  },
};
