#!/usr/bin/env node
// One source for the vocabulary. metrics.json holds the branch, category, channel, month and quarter
// values; the dbt project lists them twice, in the accepted_values tests on fct_orders and in the
// branch_codes seed. This checks both against metrics.json, reading the accepted values from
// transform/target/manifest.json, which is what dbt actually ran, so no yaml parser is needed.
//
//   node test/vocab.js        (after a dbt build or parse)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../lib/store.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const dims = JSON.parse(read("metrics.json")).dimensions;
const manifest = JSON.parse(read("transform/target/manifest.json"));
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const fails = [];

const accepted = Object.values(manifest.nodes).filter((n) => n.test_metadata?.name === "accepted_values" && n.attached_node === "model.data_answers.fct_orders");
const byColumn = Object.fromEntries(accepted.map((n) => [n.column_name, n.test_metadata.kwargs.values]));
for (const [dim, { column, values }] of Object.entries(dims)) {
  if (!byColumn[column]) fails.push(`fct_orders has no accepted_values test on ${column}`);
  else if (!same(byColumn[column], values)) fails.push(`fct_orders.${column} accepts ${JSON.stringify(byColumn[column])}; metrics.json ${dim} has ${JSON.stringify(values)}`);
}
for (const column of Object.keys(byColumn)) if (!Object.values(dims).some((d) => d.column === column)) fails.push(`fct_orders.${column} has accepted values but metrics.json has no such dimension`);

const branches = parseCsv(read("transform/seeds/branch_codes.csv")).map((r) => r.branch);
if (!same(branches, dims.branch.values)) fails.push(`branch_codes.csv names ${JSON.stringify(branches)}; metrics.json has ${JSON.stringify(dims.branch.values)}`);

if (fails.length) { for (const f of fails) console.error(`vocab: ${f}`); process.exit(1); }
console.log(`vocab: ${accepted.length} accepted_values tests and branch_codes.csv match metrics.json`);
