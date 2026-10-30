#!/usr/bin/env node
// The truth generator. Writes the synthetic order table and, from the same seeded rows, every
// expected answer in the case set, so each expected value is exact and nothing is written by hand.
//
//   node scripts/make_data.js
//
// Writes data/orders.csv (the table the server loads into DuckDB), data/batch_2.csv (the late
// December rows the harness loads for state case S02), and eval/expected/cases.json (the
// twenty-eight cases with their expected blocks). The expected values are computed here in plain
// JavaScript over the rows; the server computes them in SQL. The two share only lib/round.js.
// Synthetic data only. No currency: the business sits in no country.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { amount, ratePct, average, growthPct, divideHundredths, fmt2 } from "../lib/round.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(here);
const DATA = path.join(ROOT, "data");
const EXPECTED = path.join(ROOT, "eval", "expected");
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(EXPECTED, { recursive: true });

// ---------- seeded randomness, so the truth is the same on every machine ----------
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = mulberry32(20261030);
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
function weighted(pairs) { const total = pairs.reduce((s, [, w]) => s + w, 0); let r = rand() * total; for (const [v, w] of pairs) { r -= w; if (r < 0) return v; } return pairs[pairs.length - 1][0]; }

// ---------- the business ----------
// base orders a month, monthly growth, base returns probability. Westgate is the clear grower.
const BRANCHES = [
  ["Central",    60,  0.020, 0.06],
  ["Harbour",    45,  0.040, 0.08],
  ["Riverside",  40, -0.010, 0.05],
  ["Hillside",   30,  0.005, 0.04],
  ["Old Town",   35,  0.010, 0.07],
  ["Westgate",   50,  0.060, 0.09],
  ["Northpoint", 38,  0.030, 0.11],
  ["Airport",    55,  0.000, 0.05],
];
const SEASON = { 1: 0.90, 2: 0.85, 3: 1.00, 4: 1.00, 5: 1.05, 6: 1.00, 7: 1.00, 8: 1.05, 9: 1.00, 10: 1.05, 11: 1.15, 12: 1.30 };
// category -> products with prices in cents; category weights
const CATALOGUE = {
  "Kitchen":       { weight: 45, products: [["Kettle", 8990], ["Toaster", 6500], ["Blender", 12900], ["Rice Cooker", 15900], ["Air Fryer", 29900]] },
  "Cooling":       { weight: 20, products: [["Fan", 14900], ["Air Cooler", 39900]] },
  "Garment Care":  { weight: 20, products: [["Iron", 7500], ["Steamer", 11900]] },
  "Personal Care": { weight: 15, products: [["Hair Dryer", 9900], ["Shaver", 13900]] },
};
const CHANNELS = [["In store", 60], ["Online", 30], ["Phone", 10]];
const RETURN_MULT = { "In store": 1.0, "Online": 1.6, "Phone": 1.2 };
const DAYS = { 1: 31, 2: 28, 3: 31, 4: 30, 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31 };
const mm = (m) => `2025-${String(m).padStart(2, "0")}`;
const qq = (m) => `2025-Q${Math.ceil(m / 3)}`;

function makeOrder(branch, m, retBase) {
  const category = weighted(Object.entries(CATALOGUE).map(([c, v]) => [c, v.weight]));
  const [, price] = CATALOGUE[category].products[Math.floor(rand() * CATALOGUE[category].products.length)];
  const qty = weighted([[1, 55], [2, 30], [3, 10], [4, 5]]);
  const channel = weighted(CHANNELS);
  const day = between(1, DAYS[m]);
  const returned = rand() < Math.min(0.5, retBase * RETURN_MULT[channel]);
  return { branch, order_date: `${mm(m)}-${String(day).padStart(2, "0")}`, month: mm(m), quarter: qq(m), category, channel, cents: price * qty, returned };
}
const rows = [];
for (let m = 1; m <= 12; m++) for (const [branch, base, g, ret] of BRANCHES) {
  const n = Math.round(base * Math.pow(1 + g, m - 1) * SEASON[m] * (0.9 + 0.2 * rand()));
  for (let i = 0; i < n; i++) rows.push(makeOrder(branch, m, ret));
}
rows.sort((a, b) => a.order_date.localeCompare(b.order_date) || a.branch.localeCompare(b.branch));
rows.forEach((r, i) => (r.order_id = `ORD-${String(i + 1).padStart(5, "0")}`));
// the late batch: thirty more December orders from two branches, loaded for state case S02
const batch = [];
for (let i = 0; i < 30; i++) batch.push(makeOrder(i % 2 ? "Westgate" : "Central", 12, 0.07));
batch.sort((a, b) => a.order_date.localeCompare(b.order_date));
batch.forEach((r, i) => (r.order_id = `ORD-${String(rows.length + i + 1).padStart(5, "0")}`));

const HEAD = ["order_id", "branch", "order_date", "month", "quarter", "category", "channel", "order_value", "returned"];
const csv = (rs) => [HEAD.join(","), ...rs.map((r) => [r.order_id, q(r.branch), r.order_date, r.month, r.quarter, q(r.category), q(r.channel), amount(r.cents), r.returned].join(","))].join("\n") + "\n";
const q = (s) => (/[", ]/.test(s) ? `"${s}"` : s);
fs.writeFileSync(path.join(DATA, "orders.csv"), csv(rows));
fs.writeFileSync(path.join(DATA, "batch_2.csv"), csv(batch));

// ---------- computing the expected answers over the rows ----------
const metrics = JSON.parse(fs.readFileSync(path.join(ROOT, "metrics.json"), "utf8"));
const MONTHS = metrics.dimensions.month.values;
function periodMonths(label) {
  let m;
  if ((m = /^(\d{4})$/.exec(label))) return MONTHS.filter((x) => x.startsWith(m[1]));
  if ((m = /^(\d{4})-(\d{2})$/.exec(label))) return [label];
  if ((m = /^(\d{4})-Q([1-4])$/.exec(label))) return MONTHS.slice((m[2] - 1) * 3, m[2] * 3);
  if ((m = /^(\d{4})-H([12])$/.exec(label))) return MONTHS.slice((m[2] - 1) * 6, m[2] * 6);
  if ((m = /^(\d{4}-\d{2}) to (\d{4}-\d{2})$/.exec(label))) return MONTHS.filter((x) => x >= m[1] && x <= m[2]);
  throw new Error("bad period " + label);
}
const inScope = (r, months, filters) => months.includes(r.month) && Object.entries(filters).every(([k, vs]) => vs.includes(r[k]));
function agg(rs) { return { n: rs.length, cents: rs.reduce((s, r) => s + r.cents, 0), ret: rs.filter((r) => r.returned).length, retCents: rs.filter((r) => r.returned).reduce((s, r) => s + r.cents, 0), max: rs.reduce((s, r) => Math.max(s, r.cents), 0) }; }
function value(metric, a) {
  switch (metric) {
    case "orders": return String(a.n);
    case "revenue": return amount(a.cents);
    case "returns": return String(a.ret);
    case "returns_rate": return ratePct(a.ret, a.n);
    case "returned_value": return amount(a.retCents);
    case "net_revenue": return amount(a.cents - a.retCents);
    case "average_order_value": return average(a.cents, a.n);
    case "largest_order": return amount(a.max);
  }
  throw new Error("no value rule for " + metric);
}
const dimOrder = (dim) => metrics.dimensions[dim].values;
function groupBy(rs, dims) {
  const groups = new Map();
  for (const r of rs) { const k = dims.map((d) => r[d]).join(" | "); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
  const keys = [...groups.keys()].sort((x, y) => { const xa = x.split(" | "), ya = y.split(" | "); for (let i = 0; i < dims.length; i++) { const d = dimOrder(dims[i]).indexOf(xa[i]) - dimOrder(dims[i]).indexOf(ya[i]); if (d) return d; } return 0; });
  return keys.map((k) => ({ key: k, rows: groups.get(k) }));
}

// run_metric as the server will do it, over the given rows
function run(rs, metric, dimensions, filters, period) {
  const def = metrics.metrics.find((x) => x.name === metric);
  const months = periodMonths(period);
  const scope = rs.filter((r) => inScope(r, months, filters));
  const block = { tool: "run_metric", metric, unit: def.unit, dimensions, filters, period };
  if (def.kind === "growth") {
    const idx = def.grain === "month" ? MONTHS.indexOf(period) : ["2025-Q1", "2025-Q2", "2025-Q3", "2025-Q4"].indexOf(period);
    const prev = def.grain === "month" ? MONTHS[idx - 1] : `2025-Q${idx}`;
    const cur = rs.filter((r) => inScope(r, periodMonths(period), filters)), before = rs.filter((r) => inScope(r, periodMonths(prev), filters));
    if (!dimensions.length) { block.value = growthPct(agg(cur).cents, agg(before).cents); block.previous_period = prev; block.rows_over = cur.length + before.length; return block; }
    block.previous_period = prev; block.rows_over = cur.length + before.length;
    block.rows = groupBy([...cur, ...before], dimensions).map((g) => ({ group: g.key, value: growthPct(agg(g.rows.filter((r) => months.includes(r.month))).cents, agg(g.rows.filter((r) => !months.includes(r.month))).cents) }));
    return block;
  }
  if (def.kind === "share") {
    const total = agg(scope);
    block.rows_over = scope.length;
    block.rows = groupBy(scope, dimensions).map((g) => { const a = agg(g.rows); return { group: g.key, value: def.base === "revenue" ? ratePct(a.cents, total.cents) : ratePct(a.n, total.n) }; });
    return block;
  }
  block.rows_over = scope.length;
  if (!dimensions.length) { block.value = value(metric, agg(scope)); return block; }
  block.rows = groupBy(scope, dimensions).map((g) => ({ group: g.key, value: value(metric, agg(g.rows)) }));
  return block;
}
// compare_periods as the server will do it: both values per group, the change and the change as a percent, ranked by the percent change
function compare(rs, metric, dimension, a, b) {
  const def = metrics.metrics.find((x) => x.name === metric);
  const A = run(rs, metric, [dimension], {}, a), B = run(rs, metric, [dimension], {}, b);
  const rowsB = new Map(B.rows.map((r) => [r.group, r.value]));
  const rows = A.rows.map((r) => {
    const va = r.value, vb = rowsB.get(r.group) ?? null;
    const ha = Math.round(Number(va) * 100), hb = Math.round(Number(vb) * 100);
    return { group: r.group, value_a: va, value_b: vb, change: fmt2(hb - ha), change_pct: ha === 0 ? null : fmt2(divideHundredths(hb - ha, ha, 10000)) };
  }).sort((x, y) => Number(y.change_pct) - Number(x.change_pct));
  return { tool: "compare_periods", metric, unit: def.unit, dimension, period_a: a, period_b: b, rows, rows_over: A.rows_over + B.rows_over, top: rows[0].group };
}

const F = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v : [v]]));
const cases = [
  { id: "A01", question: "How many orders did we take in 2025?", expect: run(rows, "orders", [], {}, "2025") },
  { id: "A02", question: "What was revenue in March 2025?", expect: run(rows, "revenue", [], {}, "2025-03") },
  { id: "A03", question: "Orders by branch in Q2 2025", expect: run(rows, "orders", ["branch"], {}, "2025-Q2") },
  { id: "A04", question: "Returns rate by branch for Q3 2025", expect: run(rows, "returns_rate", ["branch"], {}, "2025-Q3") },
  { id: "A05", question: "Average order value in March 2025", expect: run(rows, "average_order_value", [], {}, "2025-03") },
  { id: "A06", question: "Revenue by category for the whole of 2025", expect: run(rows, "revenue", ["category"], {}, "2025") },
  { id: "A07", question: "What is the returns rate for online orders in 2025?", expect: run(rows, "returns_rate", [], F({ channel: "Online" }), "2025") },
  { id: "A08", question: "Share of revenue by branch in 2025", expect: run(rows, "revenue_share", ["branch"], {}, "2025") },
  { id: "A09", question: "Month on month revenue growth for June 2025", expect: run(rows, "mom_growth", [], {}, "2025-06") },
  { id: "A10", question: "Riverside revenue by month in 2025", expect: run(rows, "revenue", ["month"], F({ branch: "Riverside" }), "2025") },
  { id: "A11", question: "Net revenue in Q4 2025", expect: run(rows, "net_revenue", [], {}, "2025-Q4") },
  { id: "A12", question: "Value of Kitchen returns in Q1 2025", expect: run(rows, "returned_value", [], F({ category: "Kitchen" }), "2025-Q1") },
  { id: "A13", question: "Largest single order at the Airport branch in 2025", expect: run(rows, "largest_order", [], F({ branch: "Airport" }), "2025") },
  { id: "A14", question: "Orders by channel in August 2025", expect: run(rows, "orders", ["channel"], {}, "2025-08") },
  { id: "A15", question: "Quarter on quarter revenue growth for Q3 2025", expect: run(rows, "qoq_growth", [], {}, "2025-Q3") },
  { id: "A16", question: "Share of orders by channel in 2025", expect: run(rows, "orders_share", ["channel"], {}, "2025") },
  { id: "A17", question: "Which branch grew revenue the most from the first half of 2025 to the second half?", expect: compare(rows, "revenue", "branch", "2025-H1", "2025-H2") },
  { id: "A18", question: "Compare returns rate by category, Q1 2025 against Q4 2025", expect: compare(rows, "returns_rate", "category", "2025-Q1", "2025-Q4") },
  { id: "A19", question: "Revenue for the Harbor branch in May 2025", expect: { ...run(rows, "revenue", [], F({ branch: "Harbour" }), "2025-05"), corrections: { branch: { from: "Harbor", to: "Harbour" } } } },
  { id: "A20", question: "Returns rate at Riveside for Q2 2025", expect: { ...run(rows, "returns_rate", [], F({ branch: "Riverside" }), "2025-Q2"), corrections: { branch: { from: "Riveside", to: "Riverside" } } } },
  { id: "R01", question: "What was the profit margin by branch in 2025?", gate: "G1", reason: "undefined_metric", nearest: "net_revenue" },
  { id: "R02", question: "What was the returns rate last quarter?", gate: "G2", reason: "ambiguous_period", answer: "Q3 2025", then: run(rows, "returns_rate", [], {}, "2025-Q3") },
  { id: "R03", question: "Revenue by salesperson in 2025", gate: "G3", reason: "dimension_not_in_table" },
  { id: "R04", question: "How much did Sarah Mitchell spend with us in March 2025?", gate: "G4", reason: "single_person" },
  { id: "R05", question: "How many orders did the Lakeside branch take in 2025?", gate: "G5", reason: "value_not_in_data", answer: "Riverside", then: run(rows, "orders", [], F({ branch: "Riverside" }), "2025") },
  { id: "R06", question: "Roughly what will revenue be in January 2026?", gate: "G6", reason: "estimate", nearest: "revenue" },
  { id: "S01", question: "What was revenue in March 2025?", same_as: "A02", state: "same", expect: run(rows, "revenue", [], {}, "2025-03") },
  { id: "S02", question: "How many orders did we take in 2025?", same_as: "A01", state: "changed", load: "batch_2.csv", rows_added: batch.length, expect: run([...rows, ...batch], "orders", [], {}, "2025") },
];
const out = { written: "by scripts/make_data.js from seed 20261030", rows: rows.length, batch_rows: batch.length, data_version_after_batch: 2, cases };
fs.writeFileSync(path.join(EXPECTED, "cases.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`orders.csv: ${rows.length} rows; batch_2.csv: ${batch.length} rows; cases.json: ${cases.length} cases`);
for (const c of cases) {
  const e = c.expect || c.then;
  const v = e ? (e.value != null ? e.value : e.rows ? `${e.rows.length} rows` + (e.top ? `, top ${e.top}` : "") : "") : "";
  console.log(`${c.id}  ${c.gate ? c.gate + " " + c.reason : ""}${e ? ` ${e.metric} ${e.unit}` : ""} ${v}${e?.rows_over != null ? `  (over ${e.rows_over} rows)` : ""}`);
}
