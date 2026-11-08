#!/usr/bin/env node
// The hand-off from the tested tables to the dashboard (dashboard/DESIGN.md, step 2). Copies
// transform/target/fct_orders.parquet, which the post-hook on fct_orders writes, to
// dashboard/data/fct_orders.parquet, the one file the Power BI report loads. The copy is the whole of
// fct_orders, both export batches; the report keeps export_batch 1 in its own Power Query step.
//
//   node scripts/export_dashboard.js            copy, after a whole passing dbt build
//   node scripts/export_dashboard.js --check    after a whole passing dbt build, the committed file
//                                               must hold exactly the rows of the fresh fct_orders
//
// Both refuse unless the last dbt run was a whole build in which every node passed
// (scripts/build_gate.js, the rule scripts/export_mart.js follows). A refused copy leaves the
// committed file as it was. The check compares rows and column types through DuckDB, not bytes: the
// Parquet writer stamps its own version into the file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { whyNotPassed } from "./build_gate.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TARGET = path.join(ROOT, "transform", "target");
const FRESH = path.join(TARGET, "fct_orders.parquet");
const COMMITTED = path.join(ROOT, "dashboard", "data", "fct_orders.parquet");
const check = process.argv.includes("--check");
const stop = (why) => { console.error(`export_dashboard: ${why}; ${check ? "check failed" : "nothing copied"}`); process.exit(1); };

const why = whyNotPassed(TARGET);
if (why) stop(why);

const db = await DuckDBInstance.create(":memory:");
const con = await db.connect();
const rows = async (sql) => (await con.runAndReadAll(sql)).getRowObjects();
const lit = (p) => `'${p.replace(/'/g, "''")}'`;
const batches = async (file) => (await rows(`SELECT export_batch, COUNT(*) AS n FROM read_parquet(${lit(file)}) GROUP BY 1 ORDER BY 1`))
  .map((r) => `batch ${r.export_batch}: ${r.n} rows`).join(", ");

if (!check) {
  fs.mkdirSync(path.dirname(COMMITTED), { recursive: true });
  fs.copyFileSync(FRESH, COMMITTED);
  console.log(`dashboard/data/fct_orders.parquet: ${await batches(COMMITTED)}`);
} else {
  if (!fs.existsSync(COMMITTED)) stop("no dashboard/data/fct_orders.parquet");
  const fails = [];
  const columns = async (file) => (await rows(`DESCRIBE SELECT * FROM read_parquet(${lit(file)})`)).map((r) => `${r.column_name} ${r.column_type}`);
  const [want, got] = [await columns(FRESH), await columns(COMMITTED)];
  if (want.join(", ") !== got.join(", ")) fails.push(`columns differ: fct_orders has [${want.join(", ")}], the committed file has [${got.join(", ")}]`);
  else {
    const only = async (a, b) => Number((await rows(`SELECT COUNT(*) AS n FROM (SELECT * FROM read_parquet(${lit(a)}) EXCEPT ALL SELECT * FROM read_parquet(${lit(b)}))`))[0].n);
    const [missing, extra] = [await only(FRESH, COMMITTED), await only(COMMITTED, FRESH)];
    if (missing) fails.push(`${missing} rows of the fresh fct_orders are not in the committed file`);
    if (extra) fails.push(`${extra} rows of the committed file are not in the fresh fct_orders`);
  }
  if (fails.length) stop(fails.join("; ") + "; rerun node scripts/export_dashboard.js and commit the file");
  console.log(`export_dashboard: dashboard/data/fct_orders.parquet holds exactly the rows of fct_orders (${await batches(COMMITTED)})`);
}
con.closeSync?.(); db.closeSync?.();
