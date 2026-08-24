// Dictation parser check for the drink-log edge function.
//
// The stakes are asymmetric: a command misread as a drink writes a phantom
// entry into a real drinking record, while a drink misread as a command just
// makes you say it again. So every command phrase must NOT parse as a log.
//
// Run: node tests/drink-phrase.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(ROOT, "supabase/functions/drink-log/index.ts"), "utf8");

function slice(startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  const j = src.indexOf(endMarker, i);
  if (i < 0 || j < 0) throw new Error("marker not found: " + startMarker);
  return src.slice(i, j);
}

const mod = await import(
  "data:text/javascript," +
    encodeURIComponent(
      slice("const TYPE_ALIASES", "const json =") +
        slice("const NUM_WORDS", "Deno.serve") +
        "\nexport { parsePhrase };",
    )
);
const { parsePhrase } = mod;

const cases = [
  // spoken, expected action, expected type, expected count, expected unitScale
  ["beer", "log", "beer", 1, 1],
  ["a beer", "log", "beer", 1, 1],
  ["Beer.", "log", "beer", 1, 1],
  ["two beers", "log", "beer", 2, 1],
  ["couple of beers", "log", "beer", 2, 1],
  ["3 beers", "log", "beer", 3, 1],
  ["glass of wine", "log", "wine", 1, 1],
  ["red wine", "log", "wine", 1, 1],
  ["whiskey", "log", "spirits", 1, 1],
  ["double whiskey", "log", "spirits", 1, 2],
  ["a shot of tequila", "log", "spirits", 1, 1],
  ["martini", "log", "cocktail", 1, 1],
  ["half a beer", "log", "beer", 1, 0.5],
  ["light pour of wine", "log", "wine", 1, 0.5],
  ["ipa", "log", "beer", 1, 1],
  ["bourbon", "log", "spirits", 1, 1],
  // "glass" must not win over a specific spirit later in the sentence
  ["a glass of whiskey", "log", "spirits", 1, 1],
  ["glass of red", "log", "wine", 1, 1],
  ["just a drink", "log", "cocktail", 1, 1],

  // commands must never come back as a log
  ["undo", "undo"],
  ["scratch that", "undo"],
  ["never mind", "undo"],
  ["delete that", "undo"],
  ["status", "status"],
  ["where am i at", "status"],
  ["how many have i had", "status"],
  ["update me", "status"],
  ["end the night", "end"],
  ["done for the night", "end"],
  ["calling it", "end"],
  ["heading home", "end"],

  // nothing recognisable must refuse rather than guess
  ["asdfgh", "unknown"],
  ["the weather is nice", "unknown"],
];

let fail = 0;
for (const [spoken, action, type, count, scale] of cases) {
  const got = parsePhrase(spoken) || {};
  const problems = [];
  if (got.action !== action) problems.push(`action ${got.action} != ${action}`);
  if (type !== undefined && got.type !== type) problems.push(`type ${got.type} != ${type}`);
  if (count !== undefined && got.count !== count) problems.push(`count ${got.count} != ${count}`);
  if (scale !== undefined && got.unitScale !== scale) problems.push(`scale ${got.unitScale} != ${scale}`);
  if (problems.length) { fail++; console.log(`FAIL  "${spoken}" -> ${problems.join(", ")}`); }
  else console.log(`ok    "${spoken}" -> ${action}${got.type ? " " + got.type : ""}${got.count > 1 ? " x" + got.count : ""}${got.unitScale && got.unitScale !== 1 ? " @" + got.unitScale : ""}`);
}

// The asymmetry check, stated directly.
const commandPhrases = cases.filter(([, a]) => a !== "log" && a !== "unknown").map(([s]) => s);
const leaked = commandPhrases.filter((s) => (parsePhrase(s) || {}).action === "log");
if (leaked.length) { fail++; console.log("\nCOMMAND LEAKED INTO A LOG:", leaked); }

console.log(fail === 0 ? "\nALL PHRASE CHECKS PASS" : `\n${fail} FAILURES`);
process.exit(fail === 0 ? 0 : 1);
