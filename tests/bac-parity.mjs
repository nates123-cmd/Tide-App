// Parity check: the app's computeBAC and the edge function's computeBac must
// produce the same numbers for the same night, or the watch and the phone will
// disagree in front of Nate.
//
// Run: node tests/bac-parity.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = path.join(ROOT, "index.html");
const FN = path.join(ROOT, "supabase/functions/drink-log/index.ts");

function slice(src, startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  const j = src.indexOf(endMarker, i);
  if (i < 0 || j < 0) throw new Error("marker not found: " + startMarker);
  return src.slice(i, j);
}

const html = fs.readFileSync(APP, "utf8");
const appSrc = slice(html, "function widmarkR(profile)", "// BAC trend:");
const appMod = await import("data:text/javascript," + encodeURIComponent(appSrc + "\nexport {computeBAC};"));

const ts = fs.readFileSync(FN, "utf8");
const fnSrc = slice(ts, "function widmarkR(profile)", "function computePace");
const fnMod = await import("data:text/javascript," + encodeURIComponent(fnSrc + "\nexport {computeBac};"));

const nate = { age: 29, gender: "male", weight_lb: 214, height_in: 75 };
const now = Date.now();
const mk = (mins) => ({ standard_units: 1, entry_at: new Date(now - mins * 60000).toISOString() });

const cases = {
  "1 drink just now": [mk(0)],
  "3 drinks 30m apart": [mk(60), mk(30), mk(0)],
  "5 drinks 40m apart": [mk(160), mk(120), mk(80), mk(40), mk(0)],
  "8 drinks 30m apart": [0, 1, 2, 3, 4, 5, 6, 7].map((i) => mk(210 - i * 30)),
};

let bad = 0;
for (const [name, drinks] of Object.entries(cases)) {
  const a = appMod.computeBAC(drinks, nate);
  const b = fnMod.computeBac(drinks, nate, new Date(now));
  // appKey|fnKey — the two sides name a few fields differently.
  const keys = ["bac|mid", "low|low", "high|high", "peakHigh|peakHigh", "soberInHours|clearHrs"];
  const diffs = keys.map((k) => {
    const [ak, bk] = k.split("|");
    return { k, app: a[ak], fn: b[bk], d: Math.abs(a[ak] - b[bk]) };
  });
  // The app reads Date.now() internally while the fn takes `now` as an
  // argument, so a few ms of clock drift between the two calls is expected.
  // 1e-5 %BAC is two orders of magnitude below the 3-decimal display.
  const worst = Math.max(...diffs.map((d) => d.d));
  if (worst > 1e-5) { bad++; console.log("MISMATCH", name, diffs); }
  console.log(
    `${name.padEnd(22)} low=${a.low.toFixed(4)} mid=${a.bac.toFixed(4)} high=${a.high.toFixed(4)} peakHigh=${a.peakHigh.toFixed(4)} sober=${a.soberInHours.toFixed(2)}h  maxdiff=${worst.toExponential(1)} ${worst <= 1e-5 ? "OK" : "FAIL"}`,
  );
}
// state.drinks carries a drink_at alias on rows loaded by the v1 path; the app
// must read either key or a resumed session reads as zero drinks.
const aliased = [mk(60), mk(30), mk(0)].map(({ standard_units, entry_at }) => ({ standard_units, drink_at: entry_at }));
const viaAlias = appMod.computeBAC(aliased, nate);
const viaEntry = appMod.computeBAC([mk(60), mk(30), mk(0)], nate);
const aliasOk = viaAlias && Math.abs(viaAlias.bac - viaEntry.bac) < 1e-5;
console.log(`\ndrink_at alias        bac=${viaAlias ? viaAlias.bac.toFixed(4) : "null"} ${aliasOk ? "OK" : "FAIL"}`);
if (!aliasOk) bad++;

console.log(bad === 0 ? "\nALL PARITY CHECKS PASS" : `\n${bad} FAILURES`);
process.exit(bad === 0 ? 0 : 1);
