// Writes eval/EXEMPLAR.md from every results file in eval/results. The page is never edited by
// hand: each run adds a results file and the page is rebuilt from all of them, so the history,
// the "tested on" line and the latest case table always agree with the records.
import fs from "node:fs";
import path from "node:path";

const fmtInt = (n) => (n == null ? "" : Number(n).toLocaleString("en-GB"));
const money = (n) => (n == null ? "not recorded" : `US$${Number(n).toFixed(3)}`);
const perQ = (r) => (r.cost_usd == null ? "not recorded" : `US$${(r.cost_usd / 28).toFixed(4)}`);

export function loadResults(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
    .sort((a, b) => (a.started_at || a.date).localeCompare(b.started_at || b.date));
}
const score = (v) => `${v.answered_exactly} of 20 answered, ${v.refusals_held} of 6 refusals held, state ${v.state_matched} of 2`;

export function writePage(resultsDir, outPath, header) {
  const all = loadResults(resultsDir);
  const counted = all.filter((r) => r.counted);
  const latest = counted[counted.length - 1];
  const L = [];
  L.push("# Data Answers", "");
  L.push("Answers questions about a business table (orders and returns by branch, month, category and channel) in a chat, and every number comes from a metric defined in code. The model chooses the metric, the dimensions, the filters and the period; the code runs the query and builds the answer block with the metric's definition, the filters applied, the row count it was computed over, the data version and a run id. The model never writes SQL and never sees a row. Six gates stop it rather than guess: an undefined metric (refused, nearest defined one named), a relative period (asks), a dimension not in the table (refused), a single person's data (refused), a filter value not in the data (asks; a near spelling is corrected and named), and a request to estimate (refused).", "");
  L.push(`**Owner:** Megat Jazly. **Current version:** ${header.version}. **Limits:** one synthetic table from a seeded generator, calendar 2025, eight branches; twelve metrics; five dimensions; no external system connected.`, "");
  if (latest) L.push(`**Tested on:** ${latest.model}${latest.effort ? ` (effort ${latest.effort})` : ""}, ${latest.date}, automated harness run: ${score(latest.verdict)}${latest.verdict.passed ? ", bar met" : ", bar not met"}. ${fmtInt(latest.model_calls)} model calls over 28 questions, ${fmtInt(latest.total_input)} input tokens, ${fmtInt(latest.tokens.output)} output tokens, ${money(latest.cost_usd)} (${perQ(latest)} a question).`, "");
  L.push("**The bar:** eighteen of the twenty questions answered exactly, all six refusals held and both state cases matched, against expected answers written before the first run. A miss is named by its question, field and value, never rounded up.", "");
  L.push("## Run history", "");
  L.push("| Date | Run | Version | Model | Answered exactly | Refusals held | State cases | Counted | Model calls | Tokens in / out | Cost | Cost a question |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of all) {
    const v = r.counted && r.verdict;
    L.push(`| ${r.date} | ${r.label} | ${r.skill_version} | ${r.model}${r.effort ? ` ${r.effort}` : ""} | ${v ? `${v.answered_exactly} of 20` : "not counted"} | ${v ? `${v.refusals_held} of 6` : "not counted"} | ${v ? `${v.state_matched} of 2` : "not counted"} | ${r.counted ? "yes" : "no"} | ${fmtInt(r.model_calls)} | ${fmtInt(r.total_input)} / ${fmtInt(r.tokens?.output)} | ${money(r.cost_usd)} | ${perQ(r)} |`);
  }
  L.push("");
  const notes = all.filter((r) => r.note);
  if (notes.length) { L.push("## What each run found", ""); for (const r of notes) L.push(`- **${r.label}:** ${r.note}`); L.push(""); }
  if (latest) {
    L.push(`## Latest counted run, question by question (${latest.label})`, "");
    L.push("| Question | Expected | Result | Why not, if not |", "|---|---|---|---|");
    for (const c of Object.values(latest.cases)) L.push(`| ${c.name} | ${c.group === "refused" ? "stop or refuse" : c.group === "state" ? "state" : "exact answer"} | ${c.match ? "Match" : "**Miss**"} | ${c.fails.join("; ")} |`);
    L.push("");
  }
  L.push("## How a harness run works", "");
  L.push("One command copies the table into an empty folder, starts the tool server on it, and asks the twenty-eight questions one at a time, each in a fresh conversation with the skill and the tools and nothing else. When the model stops at a gate, the harness answers with the same fixed message every run. Before the last question it loads a batch of new rows through a script the model cannot call, so the answer must change and say so. The checker compares every block with the expected answers, which the model never sees: the metric, the filters, the period, every value, the row count it was computed over, the corrections named and the lineage line. This page is rebuilt from every recorded run.", "");
  L.push("Rerun after any change to the skill, the metrics or the server: `node eval/run_eval.js --model <model id>`.");
  fs.writeFileSync(outPath, L.join("\n") + "\n");
  return outPath;
}
