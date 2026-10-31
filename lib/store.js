// Every rule and gate, the table, the answer log and the run log. The model reaches this file only
// through the tools in server.js, and no tool here takes SQL or returns a row of the table.
//
// State in the data folder:
//   answers.duckdb   the table (loaded from orders.csv on first start) and a meta table with the data version
//   answers.csv      one line per answer block, append only
//   run_log.csv      one line per step: question, run, refuse, stop, answer, load
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DuckDBInstance } from "@duckdb/node-api";
import { amount, ratePct, average, growthPct, divideHundredths, fmt2 } from "./round.js";
import { makePeriods } from "./period.js";

// DATA_ANSWERS_ROOT is set only by the public demo, whose bundler moves this file away from metrics.json.
const ROOT = process.env.DATA_ANSWERS_ROOT || path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const METRICS = JSON.parse(fs.readFileSync(path.join(ROOT, "metrics.json"), "utf8"));
const DIMS = METRICS.dimensions;
const P = makePeriods(DIMS.month.values);

// ---------- csv helpers ----------
const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export function parseCsv(text) {
  const rows = []; let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0];
  return rows.slice(1).filter((r) => r.length > 1 || r[0] !== "").map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}
const ANSWER_COLS = ["answer_id", "time", "run_id", "question_id", "tool", "metric", "unit", "dimensions", "filters", "period", "period_b", "value", "rows", "rows_over", "data_version", "data_rows", "lineage", "corrections", "signature"];
const LOG_COLS = ["time", "run_id", "question_id", "step", "metric", "gate", "reason", "detail"];

// ---------- small text tools ----------
function editDistance(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const words = (s) => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
const q1 = (s) => `'${String(s).replace(/'/g, "''")}'`;
const list = (vs) => vs.map(q1).join(", ");

export class Store {
  constructor(dataDir, runId) {
    this.dir = dataDir; this.runId = runId; this.question = null; this.seq = 0;
    fs.mkdirSync(dataDir, { recursive: true });
    this.answersPath = path.join(dataDir, "answers.csv");
    this.logPath = path.join(dataDir, "run_log.csv");
    if (!fs.existsSync(this.answersPath)) fs.writeFileSync(this.answersPath, ANSWER_COLS.join(",") + "\n");
    if (!fs.existsSync(this.logPath)) fs.writeFileSync(this.logPath, LOG_COLS.join(",") + "\n");
  }
  static async open(dataDir, runId) {
    const s = new Store(dataDir, runId);
    s.db = await DuckDBInstance.create(path.join(dataDir, "answers.duckdb"));
    s.con = await s.db.connect();
    const have = await s.rows(`SELECT table_name FROM information_schema.tables WHERE table_name IN ('orders','meta')`);
    if (have.length < 2) {
      const src = path.join(dataDir, "orders.csv");
      if (!fs.existsSync(src)) throw new Error(`no table: ${src} is missing and answers.duckdb holds no orders table`);
      await s.con.run(`CREATE TABLE orders (order_id VARCHAR, branch VARCHAR, order_date DATE, month VARCHAR, quarter VARCHAR, category VARCHAR, channel VARCHAR, order_value DECIMAL(12,2), returned BOOLEAN)`);
      await s.con.run(`INSERT INTO orders SELECT * FROM read_csv(${q1(src)}, header = true, columns = {'order_id':'VARCHAR','branch':'VARCHAR','order_date':'DATE','month':'VARCHAR','quarter':'VARCHAR','category':'VARCHAR','channel':'VARCHAR','order_value':'DECIMAL(12,2)','returned':'BOOLEAN'})`);
      await s.con.run(`CREATE TABLE meta (data_version INTEGER, rows BIGINT, loaded_at VARCHAR, source VARCHAR)`);
      const n = Number((await s.rows(`SELECT COUNT(*) AS n FROM orders`))[0].n);
      await s.con.run(`INSERT INTO meta VALUES (1, ${n}, ${q1(new Date().toISOString())}, 'orders.csv')`);
      s.log("load", { detail: `orders.csv loaded: ${n} rows, data version 1` });
    }
    return s;
  }
  async rows(sql) { const r = await this.con.runAndReadAll(sql); return r.getRowObjects(); }
  async meta() { const m = (await this.rows(`SELECT data_version, rows, loaded_at, source FROM meta ORDER BY data_version DESC LIMIT 1`))[0]; return { data_version: Number(m.data_version), rows: Number(m.rows), loaded_at: m.loaded_at, source: m.source }; }
  async close() { this.con.closeSync?.(); this.db.closeSync?.(); }

  // ---------- logs ----------
  now() { return new Date().toISOString(); }
  log(step, { metric = "", gate = "", reason = "", detail = "" } = {}) {
    fs.appendFileSync(this.logPath, [this.now(), this.runId, this.question?.id || "", step, metric, gate, reason, detail].map(esc).join(",") + "\n");
  }
  setQuestion(id, text) { this.question = { id, text: text || "" }; this.seq = 0; this.log("question", { detail: text || "" }); return { question_id: id, run_id: this.runId }; }
  nextAnswerId() { if (!this.question) this.setQuestion(`Q${String(++this.autoQ || (this.autoQ = 1)).padStart(2, "0")}`); this.seq++; return `${this.runId}-${this.question.id}${this.seq > 1 ? "-" + this.seq : ""}`; }
  refuse(gate, reason, message, extra = {}) { this.log("refuse", { gate, reason, detail: message, metric: extra.metric || "" }); return { status: "REFUSED", gate, reason, message, ...extra }; }
  stopAt(gate, reason, message, extra = {}) { this.log("stop", { gate, reason, detail: message, metric: extra.metric || "" }); return { status: "STOPPED_AT_GATE", gate, reason, question: message, ...extra }; }

  // the model's own stop: a reason it saw before calling a tool (a named person, a request to estimate,
  // or a metric, dimension or value it already knows is missing). The code still does its part: an
  // undefined metric gets the nearest defined one looked up here and written to the log, so the
  // refusal carries it whichever route reached it.
  modelStop(reason, text, asked) {
    const gates = { undefined_metric: "G1", ambiguous_period: "G2", dimension_not_in_table: "G3", single_person: "G4", value_not_in_data: "G5", estimate: "G6" };
    if (!gates[reason]) return { status: "ERROR", message: `reason must be one of ${Object.keys(gates).join(", ")}` };
    const kind = ["ambiguous_period", "value_not_in_data"].includes(reason) ? "stop" : "refuse";
    const extra = {};
    let detail = text || "";
    if (reason === "undefined_metric") {
      const r = this.resolveMetric(asked || this.question?.text || "");
      if (r.metric) { extra.note = `${r.metric.name} is a defined metric; run_metric computes it.`; detail += ` [code: ${extra.note}]`; }
      else if (r.nearest) { const d = METRICS.metrics.find((m) => m.name === r.nearest).definition; extra.nearest = r.nearest; extra.nearest_definition = d; detail += ` [code: nearest defined metric ${r.nearest}: ${d}]`; }
    }
    if (reason === "dimension_not_in_table") { extra.dimensions_available = Object.keys(DIMS); detail += ` [code: the dimensions are ${Object.keys(DIMS).join(", ")}]`; }
    this.log(kind, { gate: gates[reason], reason, detail });
    return { status: kind === "stop" ? "STOPPED_AT_GATE" : "REFUSED", gate: gates[reason], reason, recorded: true, message: text || "", ...extra };
  }

  // ---------- describe ----------
  async describeData() {
    const m = await this.meta();
    return { table: METRICS.table, description: METRICS.description, rows: m.rows, data_version: m.data_version, loaded_at: m.loaded_at,
      period_covered: `${DIMS.month.values[0]} to ${DIMS.month.values.at(-1)}`, period_forms: METRICS.period_forms,
      dimensions: Object.fromEntries(Object.entries(DIMS).map(([k, v]) => [k, v.values])), filters: METRICS.filters,
      not_in_table: METRICS.not_in_table, note: "No tool returns a row of this table. Every number comes from a metric in list_metrics." };
  }
  listMetrics() { return METRICS.metrics.map((m) => ({ name: m.name, definition: m.definition, unit: m.unit, dimensions: m.dimensions, requires_dimension: !!m.requires_dimension })); }
  describeMetric(name) {
    const r = this.resolveMetric(name);
    if (!r.metric) return this.refuse("G1", "undefined_metric", r.message, { nearest: r.nearest });
    const m = r.metric;
    return { name: m.name, definition: m.definition, unit: m.unit, kind: m.kind, dimensions: m.dimensions, requires_dimension: !!m.requires_dimension, filters: METRICS.filters, period_forms: METRICS.period_forms, sql_template: m.sql, note: "The template is filled by the code from the dimension and filter vocabulary and the period only." };
  }
  resolveMetric(name) {
    const key = String(name || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const metric = METRICS.metrics.find((m) => m.name === key);
    if (metric) return { metric };
    const ws = words(String(name || "").replace(/_/g, " "));
    const scored = METRICS.metrics.map((m) => { const vocab = words(m.name.replace(/_/g, " ") + " " + m.near.join(" ")); return { m, score: ws.filter((w) => w.length > 2 && vocab.includes(w)).length }; });
    scored.sort((a, b) => b.score - a.score);
    const nearest = scored[0].score > 0 ? scored[0].m.name : null;
    const nearestLine = nearest ? ` The nearest defined metric is ${nearest}: ${METRICS.metrics.find((m) => m.name === nearest).definition}` : "";
    return { metric: null, nearest, message: `"${name}" is not a defined metric, so this system cannot compute it.${nearestLine} The defined metrics are: ${METRICS.metrics.map((m) => m.name).join(", ")}.` };
  }
  resolveDimension(d) {
    const key = String(d || "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
    for (const name of Object.keys(DIMS)) if (key === name || key === name + "s" || key === name + "es") return { dim: name };
    const alias = { outlet: "branch", store: "branch", site: "branch", location: "branch", shop: "branch", product_category: "category", "product category": "category", sales_channel: "channel", "sales channel": "channel", months: "month", quarters: "quarter" };
    if (alias[key]) return { dim: alias[key] };
    return { dim: null, message: `"${d}" is not a dimension of this table. The table has branch, month, quarter, category and channel, and nothing else; there is no column for ${d}.` };
  }
  resolveValue(dim, v) {
    const vals = DIMS[dim].values;
    const exact = vals.find((x) => x.toLowerCase() === String(v).trim().toLowerCase());
    if (exact) return { value: exact };
    const near = vals.filter((x) => editDistance(x, String(v).trim()) <= 2);
    if (near.length === 1) return { value: near[0], corrected_from: String(v).trim() };
    return { value: null, candidates: near, message: `"${v}" is not a ${dim} in the data${near.length > 1 ? ` and could be ${near.join(" or ")}` : ""}. The ${dim} values are: ${vals.join(", ")}. Which is meant?` };
  }

  // ---------- gates shared by run_metric and compare_periods ----------
  gateInputs({ metric, dimensions = [], filters = {}, periods = [] }, mode) {
    const r = this.resolveMetric(metric);
    if (!r.metric) return { fail: this.refuse("G1", "undefined_metric", r.message, { nearest: r.nearest }) };
    const def = r.metric;
    const dims = [];
    for (const d of Array.isArray(dimensions) ? dimensions : [dimensions]) {
      if (d == null || d === "") continue;
      const rd = this.resolveDimension(d);
      if (!rd.dim) return { fail: this.refuse("G3", "dimension_not_in_table", rd.message, { metric: def.name, dimensions_available: Object.keys(DIMS) }) };
      if (!def.dimensions.includes(rd.dim)) return { fail: this.refuse("rule", "dimension_not_allowed", `${def.name} cannot be grouped by ${rd.dim}; it allows ${def.dimensions.join(", ")}.`, { metric: def.name }) };
      if (!dims.includes(rd.dim)) dims.push(rd.dim);
    }
    if (def.requires_dimension && dims.length !== 1) return { fail: this.refuse("rule", "dimension_required", `${def.name} needs exactly one dimension (${def.dimensions.join(", ")}): its groups are that dimension's values.`, { metric: def.name }) };
    if (mode === "compare" && dims.length !== 1) return { fail: this.refuse("rule", "dimension_required", `compare_periods needs exactly one dimension to compare by.`, { metric: def.name }) };
    const F = {}, corrections = {};
    for (const [k, raw] of Object.entries(filters || {})) {
      if (raw == null || raw === "" || (Array.isArray(raw) && !raw.length)) continue;
      const rd = this.resolveDimension(k);
      if (!rd.dim) return { fail: this.refuse("G3", "dimension_not_in_table", rd.message, { metric: def.name, filters_available: METRICS.filters }) };
      if (!METRICS.filters.includes(rd.dim)) return { fail: this.refuse("rule", "filter_not_allowed", `${rd.dim} is not a filter; give it as the period.`, { metric: def.name }) };
      const out = [];
      for (const v of Array.isArray(raw) ? raw : [raw]) {
        const rv = this.resolveValue(rd.dim, v);
        if (!rv.value) return { fail: this.stopAt("G5", "value_not_in_data", rv.message, { metric: def.name, dimension: rd.dim, accepted: DIMS[rd.dim].values }) };
        if (rv.corrected_from) corrections[rd.dim] = { from: rv.corrected_from, to: rv.value };
        if (!out.includes(rv.value)) out.push(rv.value);
      }
      F[rd.dim] = out;
    }
    const pds = [];
    for (const p of periods) {
      const pp = P.parse(p);
      if (!pp.ok) return { fail: pp.gate === "G6" ? this.refuse("G6", "outside_data", pp.message, { metric: def.name }) : this.stopAt("G2", "ambiguous_period", pp.message, { metric: def.name, period_forms: METRICS.period_forms }) };
      if (def.kind === "growth") {
        const okGrain = def.grain === "month" ? /^\d{4}-\d{2}$/.test(pp.label) : /^\d{4}-Q[1-4]$/.test(pp.label);
        if (!okGrain) return { fail: this.refuse("rule", "period_grain", `${def.name} takes one ${def.grain} as its period (for example ${def.grain === "month" ? "2025-06" : "2025-Q3"}); "${p}" is not one ${def.grain}.`, { metric: def.name }) };
        const prev = def.grain === "month" ? P.previousMonth(pp.label) : P.previousQuarter(pp.label);
        if (!prev) return { fail: this.refuse("rule", "no_previous_period", `${pp.label} is the first ${def.grain} in the data, so there is no ${def.grain} before it to grow from.`, { metric: def.name }) };
        pp.previous = prev;
      }
      pds.push(pp);
    }
    return { def, dims, filters: F, corrections, periods: pds };
  }
  scopeSql(months, filters) {
    const parts = [`month IN (${list(months)})`];
    for (const [k, vs] of Object.entries(filters)) parts.push(`${DIMS[k].column} IN (${list(vs)})`);
    return parts.join(" AND ");
  }
  fillTemplate(def, dims, filters, period) {
    const dimList = dims.length ? dims.map((d) => DIMS[d].column).join(", ") : "";
    const filterSql = Object.entries(filters).map(([k, vs]) => ` AND ${DIMS[k].column} IN (${list(vs)})`).join("");
    return def.sql
      .replace("{dimensions} ", dimList ? dimList + ", " : "").replace("GROUP BY {dimensions} ", dimList ? `GROUP BY ${dimList}, ` : "GROUP BY ")
      .replace("{dimension}", dims[0] ? DIMS[dims[0]].column : "").replace("{dimension}", dims[0] ? DIMS[dims[0]].column : "")
      .replace("{scope}", this.scopeSql(period.months, filters)).replace("{group_by}", dimList ? `GROUP BY ${dimList}` : "")
      .replace("{period_month}", q1(period.label)).replace("{previous_month}", q1(period.previous || ""))
      .replace("{period_quarter}", q1(period.label)).replace("{previous_quarter}", q1(period.previous || ""))
      .replace("{filters}", filterSql).replace(/\s+/g, " ").trim();
  }
  valueOf(def, r) {
    switch (def.kind) {
      case "sum": return def.unit === "amount" ? amount(Number(r.value_cents ?? 0)) : String(Number(r.value_count ?? 0));
      case "ratio": return ratePct(Number(r.numerator), Number(r.denominator));
      case "average": return average(Number(r.numerator), Number(r.denominator));
    }
  }
  orderGroups(rows, dims) {
    const idx = (d, v) => DIMS[d].values.indexOf(v);
    return rows.sort((a, b) => { for (const d of dims) { const c = idx(d, a[DIMS[d].column]) - idx(d, b[DIMS[d].column]); if (c) return c; } return 0; });
  }
  groupKey(r, dims) { return dims.map((d) => r[DIMS[d].column]).join(" | "); }

  // the heart: one metric, the filters, one period, in code
  async compute(def, dims, filters, period) {
    const sql = this.fillTemplate(def, dims, filters, period);
    const out = { sql };
    if (def.kind === "growth") {
      const rs = await this.rows(sql);
      const grain = DIMS[def.grain].column;
      const cur = rs.filter((r) => r[grain] === period.label), prev = rs.filter((r) => r[grain] === period.previous);
      out.rows_over = rs.reduce((s, r) => s + Number(r.rows_over), 0);
      out.previous_period = period.previous;
      const cents = (xs) => xs.reduce((s, r) => s + Number(r.value_cents), 0);
      if (!dims.length) { out.value = growthPct(cents(cur), cents(prev)); return out; }
      const keys = this.orderGroups([...rs], dims).map((r) => this.groupKey(r, dims)).filter((k, i, a) => a.indexOf(k) === i);
      out.rows = keys.map((k) => ({ group: k, value: growthPct(cents(cur.filter((r) => this.groupKey(r, dims) === k)), cents(prev.filter((r) => this.groupKey(r, dims) === k))) }));
      return out;
    }
    if (def.kind === "share") {
      const rs = (await this.rows(sql)).sort((a, b) => DIMS[dims[0]].values.indexOf(a.group_value) - DIMS[dims[0]].values.indexOf(b.group_value));
      const field = def.base === "revenue" ? "value_cents" : "value_count";
      const total = rs.reduce((s, r) => s + Number(r[field]), 0);
      out.rows_over = rs.reduce((s, r) => s + Number(r.rows_over), 0);
      out.rows = rs.map((r) => ({ group: r.group_value, value: ratePct(Number(r[field]), total) }));
      return out;
    }
    const rs = this.orderGroups(await this.rows(sql), dims);
    out.rows_over = rs.reduce((s, r) => s + Number(r.rows_over), 0);
    if (!dims.length) { out.value = rs.length ? this.valueOf(def, rs[0]) : (def.kind === "sum" && def.unit !== "amount" ? "0" : null); return out; }
    out.rows = rs.map((r) => ({ group: this.groupKey(r, dims), value: this.valueOf(def, r) }));
    return out;
  }

  async lineage(signature, meta) {
    const prior = parseCsv(fs.readFileSync(this.answersPath, "utf8")).filter((a) => a.signature === signature);
    if (!prior.length) return { lineage: "first answer to this question" };
    const same = prior.find((a) => Number(a.data_version) === meta.data_version);
    if (same) return { lineage: `same as ${same.answer_id}`, same_as: same.answer_id };
    const last = prior[prior.length - 1];
    const added = meta.rows - Number(last.data_rows);
    return { lineage: `data changed since ${last.answer_id}: ${added} rows added (data version ${last.data_version} to ${meta.data_version})`, changed_since: last.answer_id, rows_added: added };
  }
  async record(block) {
    fs.appendFileSync(this.answersPath, ANSWER_COLS.map((c) => esc(c === "dimensions" ? block.dimensions.join("|") : c === "filters" || c === "corrections" ? JSON.stringify(block[c] || {}) : c === "rows" ? JSON.stringify(block.rows || null) : c === "period" ? (block.period || block.period_a || "") : block[c] ?? "")).join(",") + "\n");
    this.log("answer", { metric: block.metric, detail: `${block.answer_id} ${block.tool} ${block.value != null ? block.value : (block.rows?.length || 0) + " rows"} over ${block.rows_over} rows; ${block.lineage}` });
  }

  async runMetric(args) {
    const g = this.gateInputs({ metric: args.metric, dimensions: args.dimensions, filters: args.filters, periods: [args.period] }, "run");
    if (g.fail) return g.fail;
    const { def, dims, filters, corrections, periods: [period] } = g;
    const c = await this.compute(def, dims, filters, period);
    const meta = await this.meta();
    const signature = JSON.stringify({ tool: "run_metric", metric: def.name, dims, filters, period: period.label });
    const lin = await this.lineage(signature, meta);
    const block = { status: "ANSWER", answer_id: this.nextAnswerId(), run_id: this.runId, question_id: this.question?.id, time: this.now(), tool: "run_metric",
      metric: def.name, definition: def.definition, unit: def.unit, period: period.label, period_note: period.implied_year ? `year ${period.implied_year} implied, the only year in the data` : undefined,
      previous_period: c.previous_period, dimensions: dims, filters, corrections: Object.keys(corrections).length ? corrections : undefined,
      value: c.value, rows: c.rows, rows_over: c.rows_over, data_version: meta.data_version, data_rows: meta.rows, ...lin, sql: c.sql, signature };
    if (Object.keys(corrections).length) block.correction_note = Object.entries(corrections).map(([k, v]) => `${k} read as ${v.to} from "${v.from}"`).join("; ");
    await this.record(block);
    return block;
  }
  async comparePeriods(args) {
    const g = this.gateInputs({ metric: args.metric, dimensions: [args.dimension], filters: args.filters, periods: [args.period_a, args.period_b] }, "compare");
    if (g.fail) return g.fail;
    const { def, dims, filters, corrections, periods: [pa, pb] } = g;
    if (def.kind === "growth" || def.kind === "share") return this.refuse("rule", "not_comparable", `${def.name} is itself a comparison or a share; compare_periods takes a plain metric (orders, revenue, returns, returns_rate, returned_value, net_revenue, average_order_value, largest_order).`, { metric: def.name });
    const A = await this.compute(def, dims, filters, pa), B = await this.compute(def, dims, filters, pb);
    const bv = new Map(B.rows.map((r) => [r.group, r.value]));
    const rows = A.rows.map((r) => { const ha = Math.round(Number(r.value) * 100), hb = bv.has(r.group) ? Math.round(Number(bv.get(r.group)) * 100) : null;
      return { group: r.group, value_a: r.value, value_b: hb == null ? null : bv.get(r.group), change: hb == null ? null : fmt2(hb - ha), change_pct: hb == null || ha === 0 ? null : fmt2(divideHundredths(hb - ha, ha, 10000)) }; })
      .sort((x, y) => Number(y.change_pct ?? -1e9) - Number(x.change_pct ?? -1e9));
    const meta = await this.meta();
    const signature = JSON.stringify({ tool: "compare_periods", metric: def.name, dims, filters, period_a: pa.label, period_b: pb.label });
    const lin = await this.lineage(signature, meta);
    const block = { status: "ANSWER", answer_id: this.nextAnswerId(), run_id: this.runId, question_id: this.question?.id, time: this.now(), tool: "compare_periods",
      metric: def.name, definition: def.definition, unit: def.unit, period_a: pa.label, period_b: pb.label, dimension: dims[0], dimensions: dims, filters, corrections: Object.keys(corrections).length ? corrections : undefined,
      change_note: `change is ${def.unit === "%" ? "in percentage points" : "in " + def.unit}; change_pct is the change as a percent of the first period; rows are ranked by change_pct, highest first`,
      rows, top: rows[0]?.group, rows_over: A.rows_over + B.rows_over, data_version: meta.data_version, data_rows: meta.rows, ...lin, sql: [A.sql, B.sql], signature };
    await this.record(block);
    return block;
  }

  // not a tool: the harness (or a person at the terminal) loads more rows and the data version moves
  async loadBatch(csvPath) {
    const before = await this.meta();
    await this.con.run(`INSERT INTO orders SELECT * FROM read_csv(${q1(csvPath)}, header = true, columns = {'order_id':'VARCHAR','branch':'VARCHAR','order_date':'DATE','month':'VARCHAR','quarter':'VARCHAR','category':'VARCHAR','channel':'VARCHAR','order_value':'DECIMAL(12,2)','returned':'BOOLEAN'})`);
    const n = Number((await this.rows(`SELECT COUNT(*) AS n FROM orders`))[0].n);
    await this.con.run(`INSERT INTO meta VALUES (${before.data_version + 1}, ${n}, ${q1(new Date().toISOString())}, ${q1(path.basename(csvPath))})`);
    this.log("load", { detail: `${path.basename(csvPath)} loaded: ${n - before.rows} rows added, data version ${before.data_version + 1}` });
    return { data_version: before.data_version + 1, rows: n, rows_added: n - before.rows };
  }
}
