#!/usr/bin/env node
// A no-key test of scripts/check_dashboard.js, with no Power BI. It writes a stand-in Power BI project
// to a temporary folder: TMDL measures carrying the metrics.json definitions, the RepoPath parameter,
// the batch 1 filter, the DAXQueries copy of dashboard/agreement.dax, and an agreement.tsv whose values
// are computed here, independently, from dashboard/data/fct_orders.parquet with DuckDB as raw doubles,
// the way a DAX query returns them. Then it checks the script passes that project and fails each fault.
//
//   node test/dashboard.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const metrics = Object.fromEntries(JSON.parse(fs.readFileSync(path.join(ROOT, "metrics.json"), "utf8")).metrics.map((m) => [m.name, m]));
const QUERY = fs.readFileSync(path.join(ROOT, "dashboard", "agreement.dax"), "utf8");
const PARQUET = path.join(ROOT, "dashboard", "data", "fct_orders.parquet");

// The fourteen counted cases, each as SQL over batch 1 giving (group, value) as DAX would: fractions
// for percents, unrounded doubles for amounts.
const db = await DuckDBInstance.create(":memory:");
const con = await db.connect();
await con.run(`CREATE TABLE t AS SELECT * FROM read_parquet('${PARQUET.replace(/'/g, "''")}') WHERE export_batch = 1`);
const v = {
  orders: "COUNT(*)::DOUBLE", revenue: "SUM(order_value)::DOUBLE",
  returns_rate: "SUM(CASE WHEN returned THEN 1 ELSE 0 END)::DOUBLE / COUNT(*)",
  average_order_value: "SUM(order_value)::DOUBLE / COUNT(*)",
  net_revenue: "SUM(CASE WHEN returned THEN 0 ELSE order_value END)::DOUBLE",
  returned_value: "SUM(CASE WHEN returned THEN order_value ELSE 0 END)::DOUBLE",
};
const one = (id, m, where = "TRUE") => `SELECT '${id}' AS c, '' AS g, ${v[m]} AS x FROM t WHERE ${where}`;
const by = (id, m, dim, where = "TRUE") => `SELECT '${id}', ${dim}, ${v[m]} FROM t WHERE ${where} GROUP BY ${dim}`;
const sql = [
  one("A01", "orders"), one("A02", "revenue", "month = '2025-03'"), by("A03", "orders", "branch", "quarter = '2025-Q2'"),
  by("A04", "returns_rate", "branch", "quarter = '2025-Q3'"), one("A05", "average_order_value", "month = '2025-03'"),
  by("A06", "revenue", "category"), one("A07", "returns_rate", "channel = 'Online'"),
  `SELECT 'A09', '', (SUM(order_value) FILTER (month = '2025-06') - SUM(order_value) FILTER (month = '2025-05'))::DOUBLE / SUM(order_value) FILTER (month = '2025-05') FROM t`,
  by("A10", "revenue", "month", "branch = 'Riverside'"), one("A11", "net_revenue", "quarter = '2025-Q4'"),
  one("A12", "returned_value", "category = 'Kitchen' AND quarter = '2025-Q1'"), by("A14", "orders", "channel", "month = '2025-08'"),
  one("A19", "revenue", "branch = 'Harbour' AND month = '2025-05'"), one("A20", "returns_rate", "branch = 'Riverside' AND quarter = '2025-Q2'"),
].join(" UNION ALL ") + " ORDER BY 1, 2";
const rows = (await con.runAndReadAll(sql)).getRows();
con.closeSync?.(); db.closeSync?.();
const TSV = ["[case_id]\t[group]\t[value]", ...rows.map(([c, g, x]) => `${c}\t${g}\t${x}`)].join("\r\n") + "\r\n";

const T = "\t";
const measure = (name, expr, format, description) =>
  `${description ? description.split("\n").map((l) => `${T}/// ${l}\n`).join("") : ""}${T}measure ${name} = ${expr}\n${format ? `${T}${T}formatString: ${format}\n` : ""}${T}${T}lineageTag: ${name}\n`;
const FORMATS = { orders: "#,0", returns: "#,0", revenue: "#,0.00", returned_value: "#,0.00", net_revenue: "#,0.00",
  returns_rate: "0.00%;-0.00%;0.00%", average_order_value: "#,0.00", mom_growth: "0.00%" };
function tableText(edit = {}) {
  const ms = Object.keys(FORMATS).map((n) => measure(n, "1", edit.format?.[n] ?? FORMATS[n], edit.description?.[n] ?? metrics[n].definition)).join("\n");
  const filter = edit.filter ?? `Table.SelectRows(Source, each ([export_batch] = 1))`;
  return `table fct_orders\n${T}lineageTag: t\n\n${ms}\n` +
    measure("page_subtitle", '"x"', null, edit.noHelperDescription ? null : "The month and branch shown under the title.") + "\n" +
    `${T}column order_value\n${T}${T}dataType: decimal\n${T}${T}formatString: ${edit.columnFormat ?? "#,0.00"}\n${T}${T}sourceColumn: order_value\n\n` +
    `${T}partition fct_orders = m\n${T}${T}mode: import\n${T}${T}source =\n${T}${T}${T}${T}let\n` +
    `${T}${T}${T}${T}    Source = Parquet.Document(File.Contents(${edit.path ?? 'RepoPath & "\\dashboard\\data\\fct_orders.parquet"'})),\n` +
    `${T}${T}${T}${T}    Kept = ${filter}\n${T}${T}${T}${T}in\n${T}${T}${T}${T}    Kept\n`;
}
function project(edit = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dashboard-test-"));
  const model = path.join(dir, "report", "Branch review.SemanticModel");
  fs.mkdirSync(path.join(model, "definition", "tables"), { recursive: true });
  fs.mkdirSync(path.join(model, "DAXQueries"), { recursive: true });
  fs.writeFileSync(path.join(model, "definition", "tables", "fct_orders.tmdl"), tableText(edit));
  fs.writeFileSync(path.join(model, "definition", "expressions.tmdl"),
    `expression RepoPath = "C:\\repos\\data-answers" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]\n${T}lineageTag: p\n`);
  if (edit.relationship) fs.writeFileSync(path.join(model, "definition", "relationships.tmdl"), `relationship abc\n${T}fromColumn: fct_orders.month\n${T}toColumn: month_axis.month\n`);
  fs.writeFileSync(path.join(model, "DAXQueries", "Agreement.dax"), (edit.query ?? QUERY).replace(/\n/g, "\r\n"));
  fs.writeFileSync(path.join(dir, "agreement.dax"), QUERY);
  if (!edit.noTsv) fs.writeFileSync(path.join(dir, "agreement.tsv"), edit.tsv ?? TSV);
  if (edit.bim) { fs.rmSync(path.join(model, "definition"), { recursive: true }); fs.writeFileSync(path.join(model, "model.bim"), "{}"); }
  return dir;
}

const run = (dir) => spawnSync(process.execPath, [path.join(ROOT, "scripts", "check_dashboard.js"), "--dir", dir, "--no-record"], { encoding: "utf8" });
const formatted = TSV.replace(/^(A07|A20)\t\t(.*)$/gm, (_, c, x) => `${c}\t\t${(Number(x) * 100).toFixed(2)}%`).replace(/^A02\t\t(.*)$/m, (_, x) => `A02\t\t${Number(x).toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
const scenarios = [
  ["the stand-in project passes", {}, 0, "agreement 14 of 14 cases (44 values), 14 left out"],
  ["values shown formatted still pass", { tsv: formatted }, 0, "agreement 14 of 14 cases"],
  ["a measure without its metric's definition", { description: { revenue: "Total sales." } }, 1, "measure revenue: its description"],
  ["a percent measure with an amount format", { format: { mom_growth: "#,0.00" } }, 1, "measure mom_growth: format #,0.00"],
  ["a currency symbol on the column", { columnFormat: "\\$#,0.00;(\\$#,0.00);\\$#,0.00" }, 1, "carries a currency symbol"],
  ["a helper measure without a description", { noHelperDescription: true }, 1, "measure page_subtitle"],
  ["a relationship", { relationship: true }, 1, "relationship(s) in the model"],
  ["both batches loaded", { filter: "Source" }, 1, "keep export_batch 1 only"],
  ["batch 1 or 2", { filter: "Table.SelectRows(Source, each [export_batch] = 1 or [export_batch] = 2)" }, 1, "keep export_batch 1 only"],
  ["a typed drive path", { path: '"C:\\repos\\data-answers\\dashboard\\data\\fct_orders.parquet"' }, 1, "RepoPath parameter"],
  ["an edited query in DAXQueries", { query: QUERY.replace('"2025-03"', '"2025-04"') }, 1, "matches"],
  ["a model saved as model.bim", { bim: true }, 1, "TMDL format"],
  ["no agreement.tsv", { noTsv: true }, 1, "missing"],
  ["one wrong value", { tsv: TSV.replace(/^A02\t\t.*$/m, "A02\t\t97694.6100001") }, 1, "miss A02 revenue: expected 97694.60, got \"97694.61\""],
  ["one group missing", { tsv: TSV.replace(/^A14\tPhone\t.*\r\n/m, "") }, 1, "miss A14 orders Phone"],
  ["a case the query does not ask", { tsv: TSV + "A13\t\t1596\r\n" }, 1, "cases the query does not ask: A13"],
];
let failed = 0;
for (const [name, edit, code, says] of scenarios) {
  const dir = project(edit);
  const r = run(dir);
  const out = r.stdout + r.stderr;
  const ok = r.status === code && out.includes(says);
  if (!ok) { failed++; console.log(`FAIL ${name}: exit ${r.status}, wanted ${code} and "${says}"\n${out}`); }
  else console.log(`ok   ${name}`);
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `dashboard: ${failed} of ${scenarios.length} failed` : `dashboard: ${scenarios.length} of ${scenarios.length} passed`);
process.exit(failed ? 1 : 0);
