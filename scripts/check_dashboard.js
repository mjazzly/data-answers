#!/usr/bin/env node
// The dashboard's checks (dashboard/DESIGN.md, section 5). Reads text files only, so Power BI is never
// needed: the report is a Power BI project, whose semantic model is saved as TMDL text.
//
//   node scripts/check_dashboard.js [--dir dashboard] [--no-record]
//
// 1. The model, from <dir>/report/<name>.SemanticModel/definition/*.tmdl:
//    the eight metric measures exist; every measure named as a metrics.json metric carries that
//    metric's definition, word for word, as its description, and the format for its unit; every other
//    measure has a description; no format string carries a currency symbol; there are no
//    relationships; the fct_orders partition reads the Parquet file through the RepoPath parameter
//    and keeps export_batch 1 only; the DAXQueries folder holds a copy of <dir>/agreement.dax.
// 2. The agreement, only when the model passes: <dir>/agreement.tsv, the result of that query pasted
//    from DAX query view, against eval/expected/cases.json. Every value is rounded half away from
//    zero to two places, the rule in lib/round.js. A case matches only when every expected group is
//    present with the expected value and no other group is. Cases the dashboard cannot answer are
//    left out by name, with a reason, and never counted as a pass.
//
// Writes results/dashboard/D<yyyymmddhhmm>-<short sha>.json unless --no-record. Exits non-zero on a
// missing file, a model failure or any miss; it never passes silently.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fmt2 } from "../lib/round.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const dirArg = args.includes("--dir") ? args[args.indexOf("--dir") + 1] : "dashboard";
const DIR = path.resolve(ROOT, dirArg);
const RECORD = !args.includes("--no-record");
const rel = (p) => path.relative(ROOT, p) || ".";
const stop = (why) => { console.error(`check_dashboard: ${why}`); process.exit(1); };
const need = (p) => { if (!fs.existsSync(p)) stop(`missing ${rel(p)}`); return p; };
const read = (p) => fs.readFileSync(need(p), "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");

// The eight measures the page uses (DESIGN.md, decision 2), and the cases (section 5).
const MEASURES = ["orders", "returns", "revenue", "returned_value", "net_revenue", "returns_rate", "average_order_value", "mom_growth"];
const COUNTED = ["A01", "A02", "A03", "A04", "A05", "A06", "A07", "A09", "A10", "A11", "A12", "A14", "A19", "A20"];
const LEFT_OUT = {
  A08: "revenue_share is not a measure on this page",
  A13: "largest_order is not a measure on this page",
  A15: "qoq_growth is not a measure on this page",
  A16: "orders_share is not a measure on this page",
  A17: "compare_periods: a comparison the assistant builds, with change columns the page has no measure for",
  A18: "compare_periods: a comparison the assistant builds, with change columns the page has no measure for",
  R01: "a gate: the right answer is a refusal, with no number",
  R02: "a gate first; the number after it repeats a kind of question already counted",
  R03: "a gate: the right answer is a refusal, with no number",
  R04: "a gate: the right answer is a refusal, with no number",
  R05: "a gate first; the number after it repeats a kind of question already counted",
  R06: "a gate: the right answer is a refusal, with no number",
  S01: "the same question as A02",
  S02: "assumes batch 2 is loaded; the dashboard shows export_batch 1 only",
};
const FORMAT = { amount: "#,0.00", orders: "#,0", "%": "0.00%" };
const CURRENCY = /[$€£¥¤₹]|\bRM\b/;

const metrics = Object.fromEntries(JSON.parse(read(path.join(ROOT, "metrics.json"))).metrics.map((m) => [m.name, m]));
const cases = JSON.parse(read(path.join(ROOT, "eval", "expected", "cases.json"))).cases;
for (const c of cases) if (!COUNTED.includes(c.id) && !LEFT_OUT[c.id]) stop(`case ${c.id} is in eval/expected/cases.json but neither counted nor left out here`);
for (const id of [...COUNTED, ...Object.keys(LEFT_OUT)]) if (!cases.some((c) => c.id === id)) stop(`case ${id} is named here but not in eval/expected/cases.json`);

// ---- 1. The model ----------------------------------------------------------------------------------

const reportDir = need(path.join(DIR, "report"));
const models = fs.readdirSync(reportDir).filter((f) => f.endsWith(".SemanticModel"));
if (models.length !== 1) stop(`${rel(reportDir)} holds ${models.length} .SemanticModel folders; one is expected`);
const MODEL = path.join(reportDir, models[0]);
const DEF = path.join(MODEL, "definition");
if (!fs.existsSync(DEF) && fs.existsSync(path.join(MODEL, "model.bim"))) stop(`${rel(MODEL)} is saved as model.bim; save the project with the semantic model in TMDL format (DESIGN.md, section 8, step 3)`);
need(DEF);
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const tmdlFiles = walk(DEF).filter((f) => f.endsWith(".tmdl"));
if (!tmdlFiles.length) stop(`no .tmdl files under ${rel(DEF)}`);

// A small TMDL reader: each object's kind, name, description (the /// lines above it), its own
// properties (the key: value lines one level in) and its text. Tabs are TMDL's indent; four spaces
// are read as one level too.
const level = (line) => line.match(/^[\t ]*/)[0].replace(/ {1,4}/g, "\t").length;
const unquote = (s) => s == null ? s : (/^'.*'$/.test(s) ? s.slice(1, -1).replace(/''/g, "'") : /^".*"$/.test(s) ? s.slice(1, -1) : s);
function objects(file) {
  const lines = read(file).split("\n");
  const out = [];
  lines.forEach((line, i) => {
    const m = line.match(/^[\t ]*(table|measure|column|partition|relationship|expression)\s+('(?:[^']|'')+'|[^\s=]+)/);
    if (!m) return;
    const d = level(line);
    const desc = [];
    for (let j = i - 1; j >= 0 && /^[\t ]*\/\/\//.test(lines[j]) && level(lines[j]) === d; j--) desc.unshift(lines[j].replace(/^[\t ]*\/\/\/ ?/, ""));
    const body = [];
    for (let j = i + 1; j < lines.length && !(lines[j].trim() && level(lines[j]) <= d); j++) body.push(lines[j]);
    const props = {};
    for (const b of body) {
      const p = level(b) === d + 1 && b.trim().match(/^(\w+)\s*:\s*(.*)$/);
      if (p) props[p[1]] = unquote(p[2].trim());
    }
    const description = desc.length ? desc.join("\n").trim() : (props.description ?? null);
    out.push({ kind: m[1], name: unquote(m[2]), file: rel(file), description, props, text: [line, ...body].join("\n") });
  });
  return out;
}
const all = tmdlFiles.flatMap(objects);
const fails = [];

const measures = all.filter((o) => o.kind === "measure");
for (const name of MEASURES) if (!measures.some((m) => m.name === name)) fails.push(`no measure named ${name}`);
const sameFormat = (got, want) => {
  const parts = got.split(";").map((s) => s.trim());
  return parts[0] === want && parts.length <= 3 && (parts[1] == null || parts[1] === `-${want}`) && (parts[2] == null || parts[2] === want);
};
for (const m of measures) {
  const metric = metrics[m.name];
  if (!metric) { if (!m.description) fails.push(`measure ${m.name} (${m.file}) has no description`); continue; }
  if (m.description !== metric.definition) fails.push(`measure ${m.name}: its description is ${JSON.stringify(m.description)}; metrics.json defines ${m.name} as ${JSON.stringify(metric.definition)}`);
  const want = FORMAT[metric.unit], got = m.props.formatString;
  if (!got || !sameFormat(got, want)) fails.push(`measure ${m.name}: format ${got ?? "not set"}; unit ${metric.unit} wants ${want}`);
}
for (const o of all) if (o.props.formatString && CURRENCY.test(o.props.formatString)) fails.push(`${o.kind} ${o.name} (${o.file}): format ${o.props.formatString} carries a currency symbol`);

const relationships = all.filter((o) => o.kind === "relationship");
if (relationships.length) fails.push(`${relationships.length} relationship(s) in the model (${relationships.map((r) => r.file).join(", ")}); it has none by design`);

const table = all.find((o) => o.kind === "table" && o.name === "fct_orders");
const partition = table && all.find((o) => o.kind === "partition" && o.file === table.file);
if (!table) fails.push("no table named fct_orders");
else if (!partition) fails.push(`no partition in ${table.file}`);
else {
  const src = partition.text;
  if (!/Parquet\.Document\s*\(/.test(src) || !/fct_orders\.parquet/.test(src)) fails.push("the fct_orders partition does not read fct_orders.parquet through Parquet.Document");
  if (!/\bRepoPath\b/.test(src)) fails.push("the fct_orders partition does not build its path from the RepoPath parameter");
  if (/[A-Za-z]:\\/.test(src)) fails.push("the fct_orders partition names a drive path; it should come from RepoPath only");
  const keep = src.match(/Table\.SelectRows\([^\n]*\[export_batch\][^\n]*/);
  if (!keep || !/\[export_batch\]\s*=\s*1\b/.test(keep[0]) || /\bor\b/.test(keep[0])) fails.push("the fct_orders partition does not keep export_batch 1 only (DESIGN.md, section 4)");
}
const param = all.find((o) => o.kind === "expression" && o.name === "RepoPath");
if (!param || !/IsParameterQuery\s*=\s*true/.test(param.text)) fails.push("no RepoPath parameter (an expression with IsParameterQuery=true)");

const tidy = (s) => s.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trimEnd()).join("\n").trim();
const query = tidy(read(path.join(DIR, "agreement.dax")));
const queriesDir = need(path.join(MODEL, "DAXQueries"));
const copies = fs.readdirSync(queriesDir).filter((f) => f.endsWith(".dax"));
if (!copies.some((f) => tidy(read(path.join(queriesDir, f))) === query)) fails.push(`no query in ${rel(queriesDir)} matches ${rel(path.join(DIR, "agreement.dax"))} (${copies.length} .dax files there)`);

if (fails.length) stop(`the model fails ${fails.length} check(s), so nothing was compared:\n  ${fails.join("\n  ")}`);
const helpers = measures.filter((m) => !metrics[m.name]).map((m) => m.name);

// ---- 2. The agreement ------------------------------------------------------------------------------

const tsvPath = path.join(DIR, "agreement.tsv");
const lines = read(tsvPath).split("\n").filter((l) => l.trim());
if (lines.length < 2) stop(`${rel(tsvPath)} has no result rows`);
const sep = lines[0].includes("\t") ? "\t" : ",";
const splitCsv = (l) => { const out = []; let cur = "", q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; };
const split = (l) => (sep === "\t" ? l.split("\t") : splitCsv(l)).map((s) => s.trim());
const head = split(lines[0]).map((h) => h.replace(/^.*\[/, "").replace(/\]$/, "").trim());
const col = Object.fromEntries(["case_id", "group", "value"].map((h) => [h, head.indexOf(h)]));
for (const [h, i] of Object.entries(col)) if (i < 0) stop(`${rel(tsvPath)} has no ${h} column (header: ${head.join(", ")})`);
const got = {};
for (const l of lines.slice(1)) {
  const cells = split(l);
  (got[cells[col.case_id]] ??= []).push({ group: cells[col.group] ?? "", value: cells[col.value] ?? "" });
}
const unknown = Object.keys(got).filter((id) => !COUNTED.includes(id));
if (unknown.length) stop(`${rel(tsvPath)} has rows for cases the query does not ask: ${unknown.join(", ")}`);

// round(x * 10^k) half away from zero, on the decimal digits, after 12 significant figures have
// dropped any floating point noise from Power BI's double values.
function scaled(text, k) {
  const [mant, e = "0"] = Number(text).toPrecision(12).split(/e/i);
  const neg = mant.startsWith("-");
  const [i, f = ""] = mant.replace("-", "").split(".");
  const digits = BigInt(i + f), exp = Number(e) - f.length + k;
  let q;
  if (exp >= 0) q = digits * 10n ** BigInt(exp);
  else { const d = 10n ** BigInt(-exp); q = digits / d; if ((digits % d) * 2n >= d) q += 1n; }
  return Number(neg ? -q : q);
}
// The value as the assistant writes it: "4948" for counts, "97694.60" for amounts, "11.78" for %.
// Accepts raw numbers (0.1178) and values DAX query view shows formatted (11.78%, 97,694.60).
function asAnswer(raw, unit) {
  let s = raw.replace(/[\s,]/g, "");
  const shownAsPercent = s.endsWith("%");
  if (shownAsPercent) s = s.slice(0, -1);
  if (!/^-?\d*\.?\d+([eE][-+]?\d+)?$/.test(s)) return { error: `not a number: ${JSON.stringify(raw)}` };
  if (shownAsPercent && unit !== "%") return { error: `a percent for a ${unit} value: ${raw}` };
  if (unit === "orders") {
    const h = scaled(s, 2);
    return h % 100 === 0 ? { value: String(h / 100) } : { error: `not a whole number: ${raw}` };
  }
  return { value: fmt2(scaled(s, unit === "%" && !shownAsPercent ? 4 : 2)) };
}

const misses = [];
let values = 0, matched = 0;
for (const id of COUNTED) {
  const { expect } = cases.find((c) => c.id === id);
  const want = expect.rows ? expect.rows.map((r) => [r.group, r.value]) : [["", expect.value]];
  const rows = got[id] ?? [];
  const before = misses.length;
  values += want.length;
  if (!rows.length) misses.push({ case: id, metric: expect.metric, why: "no rows for this case" });
  else {
    for (const [group, value] of want) {
      const hits = rows.filter((r) => r.group === group);
      if (!hits.length) { misses.push({ case: id, metric: expect.metric, group, expected: value, got: null, why: "group missing" }); continue; }
      if (hits.length > 1) misses.push({ case: id, metric: expect.metric, group, expected: value, got: hits.map((h) => h.value), why: "group appears more than once" });
      const a = asAnswer(hits[0].value, expect.unit);
      if (a.error) misses.push({ case: id, metric: expect.metric, group, expected: value, got: hits[0].value, why: a.error });
      else if (a.value !== value) misses.push({ case: id, metric: expect.metric, group, expected: value, got: a.value, why: "different value" });
    }
    for (const r of rows) if (!want.some(([g]) => g === r.group)) misses.push({ case: id, metric: expect.metric, group: r.group, expected: null, got: r.value, why: "group not in the expected answer" });
  }
  if (misses.length === before) matched++;
}

const record = {
  written: new Date().toISOString(),
  commit: null,
  dirty: null,
  data_state: "export_batch 1 only (4,948 rows), the state the counted cases assume",
  source: `${rel(tsvPath)}, the result of ${rel(path.join(DIR, "agreement.dax"))} pasted from DAX query view`,
  model: { semantic_model: rel(MODEL), metric_measures: MEASURES, helper_measures: helpers, relationships: 0, passed: true },
  matched, total: COUNTED.length, values_compared: values,
  misses,
  left_out: Object.entries(LEFT_OUT).map(([id, reason]) => ({ case: id, reason })),
};
let where = "not recorded (--no-record)";
if (RECORD) {
  const git = (...a) => { try { return execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return null; } };
  record.commit = git("rev-parse", "--short", "HEAD");
  record.dirty = git("status", "--porcelain") !== "";
  const stamp = record.written.replace(/[-:T]/g, "").slice(0, 12);
  const out = path.join(ROOT, "results", "dashboard", `D${stamp}-${record.commit ?? "nocommit"}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ run_id: path.basename(out, ".json"), ...record }, null, 2) + "\n");
  where = rel(out);
}
console.log(`check_dashboard: model passed (${MEASURES.length} metric measures, ${helpers.length} helper measures, no relationships, export_batch 1 only)`);
console.log(`check_dashboard: agreement ${matched} of ${COUNTED.length} cases (${values} values), ${Object.keys(LEFT_OUT).length} left out; ${where}`);
for (const m of misses) console.log(`  miss ${m.case} ${m.metric}${m.group ? ` ${m.group}` : ""}: expected ${m.expected ?? "nothing"}, got ${JSON.stringify(m.got)} (${m.why})`);
process.exit(misses.length ? 1 : 0);
