// The rule every hand-off from the tested tables follows (transform/DESIGN.md; dashboard/DESIGN.md,
// decision 8): a file in transform/target/ counts only when transform/target/run_results.json shows a
// whole dbt build in which every seed, model and test passed, and which built fct_orders. The
// post-hook on fct_orders writes target/fct_orders.parquet before fct_orders' own tests run, so the
// Parquet file on disk proves nothing by itself.
import fs from "node:fs";
import path from "node:path";

// null when the last dbt run in `target` was a whole passing build that left fct_orders.parquet;
// otherwise the reason it was not, in words for the refusal message.
export function whyNotPassed(target) {
  const resultsPath = path.join(target, "run_results.json");
  if (!fs.existsSync(resultsPath)) return "no transform/target/run_results.json, so no dbt build has run";
  const run = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
  if (run.args?.which !== "build" || run.args?.select?.length) return `the last dbt run was not a whole build (${run.args?.which} ${run.args?.select?.join(" ") || ""})`;
  const bad = run.results.filter((r) => !["success", "pass"].includes(r.status));
  if (bad.length) return `${bad.length} of ${run.results.length} nodes did not pass: ${bad.map((r) => `${r.unique_id} ${r.status}`).join(", ")}`;
  if (!run.results.some((r) => r.unique_id === "model.data_answers.fct_orders")) return "the last build did not build fct_orders";
  if (!fs.existsSync(path.join(target, "fct_orders.parquet"))) return "no transform/target/fct_orders.parquet";
  return null;
}
