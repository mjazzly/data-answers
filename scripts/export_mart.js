#!/usr/bin/env node
// The hand-off from the tested tables to the AI. Reads transform/target/fct_orders.parquet, which the
// post-hook on fct_orders writes, and writes the two CSVs the server loads through the generator's own
// writer, into transform/target/export/. It never writes into data/: CI compares the two files with
// data/orders.csv and data/batch_2.csv byte for byte (transform/DESIGN.md, decision 11).
//
//   node scripts/export_mart.js
//
// Refuses unless transform/target/run_results.json shows a whole dbt build in which every seed, model
// and test passed: the post-hook runs before fct_orders' own tests, so a Parquet file on disk proves
// nothing by itself. The Parquet file is read by this DuckDB; the warehouse file never is.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { amount } from "../lib/round.js";
import { csvText } from "./csv.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(here);
const TARGET = path.join(ROOT, "transform", "target");
const OUT = path.join(TARGET, "export");
const refuse = (why) => { console.error(`export_mart: ${why}; nothing exported`); process.exit(1); };

fs.rmSync(OUT, { recursive: true, force: true });
const resultsPath = path.join(TARGET, "run_results.json");
if (!fs.existsSync(resultsPath)) refuse("no transform/target/run_results.json, so no dbt build has run");
const run = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
if (run.args?.which !== "build" || run.args?.select?.length) refuse(`the last dbt run was not a whole build (${run.args?.which} ${run.args?.select?.join(" ") || ""})`);
const bad = run.results.filter((r) => !["success", "pass"].includes(r.status));
if (bad.length) refuse(`${bad.length} of ${run.results.length} nodes did not pass: ${bad.map((r) => `${r.unique_id} ${r.status}`).join(", ")}`);
if (!run.results.some((r) => r.unique_id === "model.data_answers.fct_orders")) refuse("the last build did not build fct_orders");
const parquet = path.join(TARGET, "fct_orders.parquet");
if (!fs.existsSync(parquet)) refuse("no transform/target/fct_orders.parquet");

const db = await DuckDBInstance.create(":memory:");
const con = await db.connect();
const rows = (await con.runAndReadAll(`SELECT order_id, branch, strftime(order_date, '%Y-%m-%d') AS order_date, month, quarter, category, channel,
  CAST(order_value * 100 AS BIGINT) AS cents, returned, export_batch FROM read_parquet('${parquet.replace(/'/g, "''")}') ORDER BY export_batch, order_id`)).getRowObjects();
con.closeSync?.(); db.closeSync?.();

const HEAD = ["order_id", "branch", "order_date", "month", "quarter", "category", "channel", "order_value", "returned"];
fs.mkdirSync(OUT, { recursive: true });
for (const [batch, file] of [[1, "orders.csv"], [2, "batch_2.csv"]]) {
  const rs = rows.filter((r) => Number(r.export_batch) === batch);
  fs.writeFileSync(path.join(OUT, file), csvText(HEAD, rs.map((r) => [r.order_id, r.branch, r.order_date, r.month, r.quarter, r.category, r.channel, amount(Number(r.cents)), r.returned])));
  console.log(`transform/target/export/${file}: ${rs.length} rows`);
}
