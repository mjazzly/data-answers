// No key. Each block in presets.json was recorded once and is served without the model, so a change to
// the metrics, the gates or the page's own lines could leave a preset saying something the code no
// longer says. This reruns each preset's tool call through lib/answer.js as it stands, with a scripted
// stand-in that makes that one call, and compares what the page would show with what presets.json holds:
// figure, definition, period, filters, dimensions, row counts, data version, and for a stop or a refusal
// the gate, the reason and the message. Run ids and answer ids differ by design and are not compared.
//   node test/presets.js     (after npm run core; npm test does both)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEMO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(DEMO);
const { answer } = await import("../lib/answer.js");
const presets = JSON.parse(fs.readFileSync(path.join(DEMO, "presets.json"), "utf8"));

// The call that produced each block. For an answer it is read back from the block; when the block names
// a correction, the spelling the call used is read from the note ("branch read as Harbour from "Harbor"").
// For a stop or a refusal the block does not keep the call, so it is written here, one per preset.
const REFUSED = {
  "Profit margin by branch": ["run_metric", { metric: "profit margin", dimensions: ["branch"], period: "2025" }],
  "Returns rate last quarter": ["run_metric", { metric: "returns_rate", period: "last quarter" }],
  "Revenue in January 2026, roughly": ["stop", { reason: "estimate", text: "That asks for a forecast." }],
};
function callOf(p) {
  const b = p.items[0];
  if (b.kind !== "answer") return REFUSED[p.label] || null;
  const filters = structuredClone(b.filters || {});
  for (const m of (b.correction_note || "").matchAll(/(\w+) read as (.+?) from "(.+?)"/g)) filters[m[1]] = [].concat(filters[m[1]]).map((v) => (v === m[2] ? m[3] : v));
  return b.tool === "compare_periods"
    ? ["compare_periods", { metric: b.metric, dimension: b.dimensions[0], filters, period_a: b.period_a, period_b: b.period_b }]
    : ["run_metric", { metric: b.metric, dimensions: b.dimensions, filters, period: b.period }];
}
const scripted = ([name, input]) => {
  let n = 0;
  const usage = { input_tokens: 0, output_tokens: 0 };
  return { create: async () => (n++ ? { stop_reason: "end_turn", usage, content: [{ type: "text", text: "done" }] }
    : { stop_reason: "tool_use", usage, content: [{ type: "tool_use", id: "t1", name, input }] }) };
};

const SKIP = new Set(["answer_id", "sql"]);
function stale(label, recorded, now) {
  const out = [];
  if (recorded.length !== now.length) return [`${label}: ${now.length} blocks now, ${recorded.length} recorded`];
  recorded.forEach((r, i) => {
    for (const k of new Set([...Object.keys(r), ...Object.keys(now[i])])) {
      if (SKIP.has(k)) continue;
      const a = JSON.stringify(r[k] ?? null), b = JSON.stringify(now[i][k] ?? null);
      if (a !== b) out.push(`${label}: ${k} recorded ${a.slice(0, 120)}, now ${b.slice(0, 120)}`);
    }
  });
  return out;
}

console.log(`presets: ${presets.items.length} recorded blocks against the code as it stands`);
let failed = 0;
for (const [i, p] of presets.items.entries()) {
  const call = callOf(p);
  if (!call) { failed++; console.log(`  FAIL  ${p.label}: no call written for this ${p.items[0].kind}`); continue; }
  const a = await answer({ question: p.question, model: scripted(call), questionId: `P${String(i + 1).padStart(2, "0")}` });
  const diff = stale(p.label, p.items, a.items);
  if (diff.length) { failed++; console.log(`  STALE ${p.label}\n        ${diff.join("\n        ")}`); }
  else console.log(`  ok    ${p.label} (${call[0]})`);
}

// The comparison itself must catch a stale block: one copy with its figure moved by 0.01.
const p02 = presets.items.find((p) => p.label.startsWith("Average order value"));
const planted = structuredClone(p02.items);
planted[0].value = (Number(planted[0].value) + 0.01).toFixed(2);
const caught = stale(p02.label, planted, (await answer({ question: p02.question, model: scripted(callOf(p02)) })).items);
try {
  assert.equal(caught.length, 1);
  assert.equal(caught[0], `${p02.label}: value recorded "${planted[0].value}", now "${p02.items[0].value}"`);
  console.log(`  ok    a planted stale figure is caught: ${caught[0]}`);
} catch (e) { failed++; console.log(`  FAIL  the planted stale figure was not caught as expected: ${JSON.stringify(caught)}`); }

console.log(failed ? `presets: ${failed} failed` : `presets: all ${presets.items.length} match`);
process.exit(failed ? 1 : 0);
