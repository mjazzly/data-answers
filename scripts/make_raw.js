#!/usr/bin/env node
// The raw export. Reads the two clean files the generator wrote and writes them back the way a real
// export arrives, with five kinds of mess, so the tested tables have something to find. Seeded, so the
// export and every count below are the same on every machine.
//
//   node scripts/make_raw.js
//
// Writes transform/seeds/raw/raw_orders.csv and transform/seeds/raw/raw_returns.csv, every column as
// text. The clean files are the expected result: the models must rebuild data/orders.csv and
// data/batch_2.csv byte for byte from these two files (transform/DESIGN.md, section 2).
// Synthetic data only.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCsv } from "../lib/store.js";
import { csvText } from "./csv.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(here);
const SEEDS = path.join(ROOT, "transform", "seeds");
const RAW = path.join(SEEDS, "raw");
const read = (f) => parseCsv(fs.readFileSync(f, "utf8"));

// ---------- seeded randomness, as in make_data.js, on a seed of its own ----------
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = mulberry32(20261107);
const between = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
// k distinct items of xs, seeded
function pick(xs, k) {
  const idx = xs.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return new Set(idx.slice(0, k).map((i) => xs[i]));
}

// ---------- the counts, fixed here; the seed picks only which rows ----------
// edgeSpaced: of the respelt values in each column, how many carry a leading or trailing space. Their
// sum over both batches is raw_edge_spaced in transform/dbt_project.yml, which the test
// assert_raw_keeps_edge_spaces checks, so a loader that strips the spaces turns the build red.
const BATCHES = [
  { batch: 1, file: "orders.csv",  orderRepeats: 60, returnRepeats: 23, categoryRespelt: 495, channelRespelt: 495, edgeSpaced: 200 },
  { batch: 2, file: "batch_2.csv", orderRepeats: 2,  returnRepeats: 1,  categoryRespelt: 5,   channelRespelt: 5,   edgeSpaced: 2 },
];

// mess 2: branch arrives as a code, from the reference seed
const CODE = Object.fromEntries(read(path.join(SEEDS, "branch_codes.csv")).map((r) => [r.branch, r.code]));
// mess 3: order time as a text timestamp, a time of day from 08:00:00 to 21:59:59
const two = (n) => String(n).padStart(2, "0");
const clock = () => `${two(between(8, 21))}:${two(between(0, 59))}:${two(between(0, 59))}`;
const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// mess 5: text in mixed case and spacing; every spelling differs from the clean one
const title = (s) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const EDGE = [
  (s) => ` ${title(s)} `,                                           // " Kitchen ", " In Store "
  (s) => `${s.toLowerCase()} `,                                     // "phone "
  (s) => ` ${s}`,                                                   // " Online"
];
const INNER = [
  (s) => s.toLowerCase(),                                           // garment care, online
  (s) => s.toUpperCase(),                                           // GARMENT CARE, ONLINE
  (s) => (s.includes(" ") ? s.replace(" ", "  ") : s.toUpperCase()), // "Personal  Care"
];
const one = (xs) => xs[Math.floor(rand() * xs.length)];
function respell(s, edge) {
  const t = one(edge ? EDGE : INNER)(s);
  if (t === s) throw new Error(`make_raw: respelling ${s} left it unchanged`);
  return t;
}
// which respelt values in a column carry an edge space: a fixed count of them, seeded
const respelt = (rows, k, edgeSpaced) => { const all = pick(rows, k); return { all, edge: pick([...all], edgeSpaced) }; };
// mess 5: an order value of 1,000 or more carries a thousands separator
const separated = (v) => (Number(v) >= 1000 ? v.replace(/^(\d+)(\d{3})\./, "$1,$2.") : v);

const orders = [], events = [];
for (const b of BATCHES) {
  const clean = read(path.join(ROOT, "data", b.file));
  const cat = respelt(clean, b.categoryRespelt, b.edgeSpaced), chan = respelt(clean, b.channelRespelt, b.edgeSpaced);
  const raw = clean.map((r) => {
    if (!CODE[r.branch]) throw new Error(`make_raw: no code for branch ${r.branch} in branch_codes.csv`);
    return {
      order_id: r.order_id, branch_code: CODE[r.branch], ordered_at: `${r.order_date} ${clock()}`,
      category: cat.all.has(r) ? respell(r.category, cat.edge.has(r)) : r.category,
      channel: chan.all.has(r) ? respell(r.channel, chan.edge.has(r)) : r.channel,
      order_value: separated(r.order_value), export_batch: b.batch,
    };
  });
  // mess 4: the export overlaps itself; each repeat is an identical row later in its own batch
  const out = [...raw];
  for (const r of pick(raw, b.orderRepeats)) out.splice(between(out.indexOf(r) + 1, out.length), 0, { ...r });
  orders.push(...out);

  // mess 1: returns arrive as return events, some logged twice with a later time
  const returned = raw.filter((_, i) => clean[i].returned === "true");
  const first = returned.map((r) => ({ order_id: r.order_id, returned_at: `${addDays(r.ordered_at.slice(0, 10), between(1, 30))} ${clock()}`, export_batch: b.batch }));
  const again = [...pick(first, b.returnRepeats)].map((e) => ({ ...e, returned_at: `${addDays(e.returned_at.slice(0, 10), between(1, 3))} ${clock()}` }));
  events.push(...[...first, ...again].sort((x, y) => x.returned_at.localeCompare(y.returned_at) || x.order_id.localeCompare(y.order_id)));
}
events.forEach((e, i) => (e.return_id = `RET-${String(i + 1).padStart(5, "0")}`));

const ORDER_COLS = ["order_id", "branch_code", "ordered_at", "category", "channel", "order_value", "export_batch"];
const RETURN_COLS = ["return_id", "order_id", "returned_at", "export_batch"];
fs.mkdirSync(RAW, { recursive: true });
fs.writeFileSync(path.join(RAW, "raw_orders.csv"), csvText(ORDER_COLS, orders.map((r) => ORDER_COLS.map((c) => r[c]))));
fs.writeFileSync(path.join(RAW, "raw_returns.csv"), csvText(RETURN_COLS, events.map((e) => RETURN_COLS.map((c) => e[c]))));
for (const b of BATCHES) {
  const n = (xs) => xs.filter((x) => x.export_batch === b.batch).length;
  console.log(`batch ${b.batch}: ${n(orders)} raw order rows (${b.orderRepeats} repeats), ${n(events)} return events (${b.returnRepeats} logged twice), ${b.categoryRespelt} categories and ${b.channelRespelt} channels respelt (${b.edgeSpaced} of each with an edge space)`);
}
