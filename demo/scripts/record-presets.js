// Records the eight preset answers once, through the demo's own path on the smallest model, into
// demo/presets.json. The page serves that file, so a preset click never reaches the model.
//   npm run presets            (needs the data-answers-demo key in ../.env)
//   npm run presets -- --mock  (scripted stand-in, for a local look; never commit its output)
process.chdir(new URL("..", import.meta.url).pathname);
const fs = await import("node:fs");
const path = await import("node:path");
const { answer, newRunId, MODEL } = await import("../lib/answer.js");
const { client, DEMO } = await import("./model.js");

const MOCK = process.argv.includes("--mock");
export const PRESETS = [
  ["Returns rate by branch, Q3 2025", "Returns rate by branch for Q3 2025"],
  ["Average order value, March 2025", "Average order value in March 2025"],
  ["Which branch grew most, H1 to H2", "Which branch grew revenue the most from the first half of 2025 to the second half?"],
  ["Share of revenue by branch, 2025", "Share of revenue by branch in 2025"],
  ["Harbor branch revenue, May 2025", "Revenue for the Harbor branch in May 2025"],
  ["Profit margin by branch", "What was the profit margin by branch in 2025?"],
  ["Returns rate last quarter", "What was the returns rate last quarter?"],
  ["Revenue in January 2026, roughly", "Roughly what will revenue be in January 2026?"],
];

const m = await client(MOCK);
const runId = newRunId();
const items = []; let cost = 0;
for (const [i, [label, question]] of PRESETS.entries()) {
  const qid = `P${String(i + 1).padStart(2, "0")}`;
  const a = await answer({ question, model: m.fresh(), runId, questionId: qid });
  cost += a.cost_usd;
  items.push({ label, question, run_id: runId, items: a.items });
  console.log(`${qid}  ${a.items.map((x) => x.kind === "answer" ? `${x.metric} ${x.value ?? (x.rows?.length + " rows")}` : `${x.kind} ${x.gate} ${x.reason}`).join("; ")}  (${a.calls} calls, US$${a.cost_usd.toFixed(4)})`);
}
const out = { recorded_at: new Date().toISOString(), run_id: runId, model: MOCK ? "mock (scripted, no model)" : MODEL, cost_usd: cost, items };
fs.writeFileSync(path.join(DEMO, "presets.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`presets.json written: ${items.length} answers, run ${runId}, US$${cost.toFixed(4)} in all${MOCK ? " (mock: do not commit)" : ""}`);
