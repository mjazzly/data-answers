// Runs the twenty-eight cases through the demo's own path (lib/answer.js, its call and token limits,
// the smallest model) on one data folder, sends the two fixed answers as a new question would, loads
// the batch before S02, and checks every block with the build's own checker. It proves the demo's
// tighter limits break no case. Recorded in eval/runs-demo/, never in eval/results/.
//   npm run check              (needs the data-answers-demo key in ../.env; about US$0.04)
//   npm run check -- --mock    (scripted stand-in, no API call)
process.chdir(new URL("..", import.meta.url).pathname);
const fs = await import("node:fs");
const path = await import("node:path");
const { answer, newRunId, MODEL, LIMITS } = await import("../lib/answer.js");
const { client, REPO } = await import("./model.js");
const { loadExpected, loadRun, checkAll, verdict } = await import("../../eval/check.js");
const { Store } = await import("../../lib/store.js");

const MOCK = process.argv.includes("--mock");
const runId = newRunId();
const dir = path.join(REPO, "eval", "runs-demo", `${runId}-${MOCK ? "mock" : "haiku-5-5"}`, "data");
fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(path.join(REPO, "data", "orders.csv"), path.join(dir, "orders.csv"));
const expected = loadExpected(path.join(REPO, "eval", "expected"));
const fixed = Object.fromEntries(fs.readFileSync(path.join(REPO, "eval", "answers.txt"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const m = await client(MOCK);
const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
let cost = 0, calls = 0, maxed = 0;
console.log(`demo check ${runId}: ${MOCK ? "mock" : MODEL}, ${LIMITS.maxCalls} calls and ${LIMITS.maxTokens} output tokens a question`);
for (const c of expected.cases) {
  if (c.load) { const s = await Store.open(dir, runId); const r = await s.loadBatch(path.join(REPO, "data", c.load)); await s.close(); console.log(`  (batch loaded: ${r.rows_added} rows, data version ${r.data_version})`); }
  const a = await answer({ question: c.question, model: m.fresh(), runId, questionId: c.id, dataDir: dir, followUp: fixed[c.id] });
  for (const k of Object.keys(tokens)) tokens[k] += a.tokens[k];
  cost += a.cost_usd; calls += a.calls; if (a.stopped) maxed++;
  console.log(`  ${c.id}  ${a.calls} calls${a.stopped ? " (" + a.stopped + ")" : ""}  ${c.question}`);
}
const checked = checkAll(expected, loadRun(dir));
for (const c of Object.values(checked)) if (!c.match) console.log(`MISS ${c.name}\n        ${c.fails.join("\n        ")}`);
const v = verdict(checked);
console.log(`\n${v.answered_exactly} of 20 answered exactly, ${v.refusals_held} of 6 refusals held, state ${v.state_matched} of 2: ${v.passed ? "BAR MET" : "BAR NOT MET"}`);
console.log(`model calls ${calls}; ${maxed} questions hit a limit; cost US$${cost.toFixed(4)} (US$${(cost / 28).toFixed(4)} a question)`);
fs.writeFileSync(path.join(path.dirname(dir), "result.json"), JSON.stringify({ run_id: runId, mode: MOCK ? "mock" : "demo path", model: MOCK ? "mock" : MODEL, limits: LIMITS, model_calls: calls, questions_at_a_limit: maxed, tokens, cost_usd: cost, verdict: v, cases: checked }, null, 2));
process.exit(v.passed ? 0 : 1);
