#!/usr/bin/env node
// The twenty-eight cases through the demo's own path, for CI (.github/workflows/cases.yml). Built from
// scripts/check-demo.js, which stays as it is for Terminal use.
//   node demo/scripts/ci.js --mock                  (no key: the scripted stand-in; proves the path, records nothing)
//   node demo/scripts/ci.js                         (ANTHROPIC_API_KEY from the data-answers-ci workspace; the service's settings)
//   node demo/scripts/ci.js --record results/ci     (as above, and writes the record; the workflow does this on main)
//   node demo/scripts/ci.js --measure 5 [--effort high] [--record results/ci-measure]
//                                                   (N passes, no gate: a per-case tally to choose an effort by)
//   node demo/scripts/ci.js --mock --plant A01,A02,A03
//                                                   (the stand-in with these cases made to miss, to show red offline;
//                                                   one answered miss alone stays green, as the bar allows two)
//
// Each pass runs lib/answer.js, its call and token limits and the smallest model, on a fresh copy of the
// table; sends the two fixed answers as a new question would; loads the batch before S02; and is marked
// by eval/check.js against the bar in harness.json, with every miss printed by case and line. The cases
// share state through the batch, so one cannot be rerun alone: a pass that misses the bar runs once more
// as a whole, and the run is red only if that pass misses too. Exit 0 on green (and always when
// measuring), 1 on red, 2 on a form that is refused. Unlike check-demo.js it never reads ../.env: the key
// must come from the environment, so it can never spend the demo's own.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEMO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(DEMO);
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : null; };
const MOCK = argv.includes("--mock");
const MEASURE = arg("measure") == null ? 0 : Number(arg("measure"));
const EFFORT = arg("effort") || null;
const PLANT = arg("plant") ? arg("plant").split(",") : [];
const recordDir = arg("record") ? path.resolve(arg("record")) : null;   // resolved before the chdir below
const refuse = (why) => { console.error(why); process.exit(2); };
if (!Number.isInteger(MEASURE) || MEASURE < 0) refuse("--measure takes a whole number of passes");
if (MOCK && recordDir) refuse("a mock pass is never recorded");
if (PLANT.length && !MOCK) refuse("--plant is for --mock only");
if (EFFORT && !MEASURE) refuse("--effort is for --measure only; the gate runs the service's own settings");
if (EFFORT && !["low", "medium", "high", "xhigh", "max"].includes(EFFORT)) refuse("--effort must be low, medium, high, xhigh or max");
if (!MOCK && !process.env.ANTHROPIC_API_KEY) refuse("No ANTHROPIC_API_KEY (the data-answers-ci workspace key). Use --mock to run without one.");

execFileSync(process.execPath, [path.join(DEMO, "scripts", "copy-core.js")], { stdio: "ignore" });
process.chdir(DEMO);
const { answer, newRunId, MODEL, LIMITS } = await import("../lib/answer.js");
const { loadExpected, loadRun, checkAll, verdict } = await import("../../eval/check.js");
const { Store } = await import("../../lib/store.js");
const harness = JSON.parse(fs.readFileSync(path.join(REPO, "harness.json"), "utf8"));
const expected = loadExpected(path.join(REPO, "eval", "expected"));
const fixed = Object.fromEntries(fs.readFileSync(path.join(REPO, "eval", "answers.txt"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const version = JSON.parse(fs.readFileSync(path.join(DEMO, "package.json"), "utf8")).version;
for (const id of PLANT) if (!expected.cases.some((c) => c.id === id)) refuse(`--plant takes case ids, such as A01,A02,A03; ${id} is not one`);

async function model() {
  if (MOCK) { const { MockModel } = await import("../lib/mock-model.js"); return { fresh: () => new MockModel() }; }
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const c = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 3, timeout: LIMITS.callTimeoutMs });
  const m = { create: (req) => c.messages.create(req) };
  return { fresh: () => m };
}
// The planted miss: the stand-in's metric calls for the planted cases ask for the wrong metric. A refusal
// case planted this way gets an answer where it should have been refused.
const planted = (inner) => ({ create: async (req) => {
  const r = await inner.create(req);
  return { ...r, content: r.content.map((b) => (b.type === "tool_use" && ["run_metric", "compare_periods"].includes(b.name)
    ? { ...b, input: { ...b.input, metric: b.input.metric === "revenue" ? "orders" : "revenue" } } : b)) };
} });

async function pass(label, m, work) {
  const dir = path.join(work, label, "data");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(REPO, "data", "orders.csv"), path.join(dir, "orders.csv"));
  const runId = newRunId();
  const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  let cost = 0, calls = 0, maxed = 0;
  for (const c of expected.cases) {
    if (c.load) { const s = await Store.open(dir, runId); const r = await s.loadBatch(path.join(REPO, "data", c.load)); await s.close(); console.log(`    (batch loaded: ${r.rows_added} rows, data version ${r.data_version})`); }
    const fresh = PLANT.includes(c.id) ? planted(m.fresh()) : m.fresh();
    const a = await answer({ question: c.question, model: fresh, runId, questionId: c.id, dataDir: dir, followUp: fixed[c.id], effort: EFFORT || undefined });
    for (const k of Object.keys(tokens)) tokens[k] += a.tokens[k];
    cost += a.cost_usd; calls += a.calls; if (a.stopped) maxed++;
    console.log(`    ${c.id}  ${a.calls} calls${a.stopped ? " (" + a.stopped + ")" : ""}${PLANT.includes(c.id) ? " (planted miss)" : ""}`);
  }
  const cases = checkAll(expected, loadRun(dir));
  for (const c of Object.values(cases)) if (!c.match) console.log(`  MISS ${c.name}\n          ${c.fails.join("\n          ")}`);
  const v = verdict(cases);
  console.log(`  ${v.answered_exactly} of 20 answered exactly, ${v.refusals_held} of 6 refusals held, state ${v.state_matched} of 2: ${v.passed ? "BAR MET" : "BAR NOT MET"}`);
  console.log(`  model calls ${calls}; ${maxed} questions hit a limit; cost US$${cost.toFixed(4)}`);
  return { label, gating: !MEASURE, run_id: runId, model_calls: calls, questions_at_a_limit: maxed, tokens, cost_usd: Number(cost.toFixed(6)), verdict: v, cases };
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), "da-ci-"));
const startedAt = new Date().toISOString();
const m = await model();
const who = MOCK ? "scripted stand-in (mock)" : `model ${MODEL}, effort ${EFFORT ? `${EFFORT} (measure override)` : "unset (the service's)"}`;
console.log(`demo CI path ${version}: ${who}; ${LIMITS.maxCalls} calls and ${LIMITS.maxTokens} output tokens a question${PLANT.length ? `; planted misses in ${PLANT.join(" ")}` : ""}`);
const passes = [];
let green = null;
try {
  if (MEASURE) {
    console.log(`measure: ${MEASURE} passes, no gate`);
    for (let i = 1; i <= MEASURE; i++) { console.log(`pass ${i} of ${MEASURE}`); passes.push(await pass(`m${i}`, m, work)); }
    console.log(`\nper case, ${MEASURE} passes:`);
    for (const c of expected.cases) console.log(`  ${c.id}  ${passes.filter((p) => p.cases[c.id].match).length} of ${MEASURE} matched`);
    console.log(`passes meeting the bar: ${passes.filter((p) => p.verdict.passed).length} of ${MEASURE}`);
  } else {
    console.log(`bar: ${harness.bar}\npass 1 (gating)`);
    passes.push(await pass("gate-1", m, work));
    if (!passes[0].verdict.passed) {
      console.log("pass 1 missed the bar; running the whole pass once more to tell a break from noise\npass 2 (gating)");
      passes.push(await pass("gate-2", m, work));
    }
    green = passes.at(-1).verdict.passed;
  }
} finally { fs.rmSync(work, { recursive: true, force: true }); }
const total = (k) => passes.reduce((a, p) => a + p[k], 0);
console.log(`\n${MEASURE ? "MEASURED" : green ? "GREEN" : "RED"}: ${passes.length} pass${passes.length > 1 ? "es" : ""}; model calls ${total("model_calls")}; cost US$${total("cost_usd").toFixed(4)}`);

if (recordDir) {
  const sha = (process.env.GITHUB_SHA || "local").slice(0, 7);
  const label = `${MEASURE ? "M" : "C"}${startedAt.slice(0, 16).replace(/[-:T]/g, "")}-${sha}${EFFORT ? `-${EFFORT}` : ""}`;
  const record = { label, started_at: startedAt, commit: process.env.GITHUB_SHA || null, ref: process.env.GITHUB_REF || null,
    workflow_run: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
    trigger: process.env.GITHUB_EVENT_NAME || "local", mode: MEASURE ? "measure" : "gate", demo_version: version, model: MODEL, effort: EFFORT,
    limits: LIMITS, bar: harness.bar, green, model_calls: total("model_calls"), cost_usd: Number(total("cost_usd").toFixed(6)), passes };
  fs.mkdirSync(recordDir, { recursive: true });
  fs.writeFileSync(path.join(recordDir, `${label}.json`), JSON.stringify(record, null, 2) + "\n");
  console.log(`record written: ${path.relative(REPO, path.join(recordDir, `${label}.json`))}`);
}
process.exit(MEASURE ? 0 : green ? 0 : 1);
