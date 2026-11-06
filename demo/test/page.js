// No key. The page names the tier ("smallest model"), never the model: no model name in the code that
// renders the page, no model field rendered, and nothing a preset shows carries one. The records,
// presets.json's own "model" field and /api/stats keep the name; only what a visitor reads changes.
//   node test/page.js
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEMO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NAMES = /claude|haiku|opus|sonnet|fable/i;
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`  ok    ${name}`); } catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message.split("\n").join("\n        ")}`); } };
// the page's own files, comments left out (a comment never reaches the visitor)
const PAGE = ["Demo.js", "page.js", "layout.js", "sprite.js"].map((f) => path.join(DEMO, "app", f));
const code = (f) => fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ .*$/gm, "");

console.log("page: the tier, never the model");
for (const f of PAGE) check(`${path.basename(f)} names no model`, () => assert.doesNotMatch(code(f), NAMES));
check("no model field is rendered", () => { for (const f of PAGE) assert.doesNotMatch(code(f), /\{\s*[\w.?]*\.model\s*\}/, path.basename(f)); });
check("the answer line names the tier for a preset and for a live answer", () => {
  const demo = code(PAGE[0]);
  assert.match(demo, /Recorded answer, run <b>\{result\.run_id\}<\/b>, smallest model, /);
  assert.match(demo, /Answered now, run <b>\{result\.run_id\}<\/b>, smallest model, /);
});
check("what a preset shows names no model (presets.json keeps its own model field)", () => {
  const { model, ...shown } = JSON.parse(fs.readFileSync(path.join(DEMO, "presets.json"), "utf8"));
  assert.match(model, NAMES);
  assert.doesNotMatch(JSON.stringify(shown), NAMES);
});

console.log(failed ? `page: ${failed} failed` : "page: all passed");
process.exit(failed ? 1 : 0);
