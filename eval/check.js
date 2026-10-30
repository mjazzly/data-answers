// The checker: compares a run's answers.csv and run_log.csv with the expected cases written before
// the first run. Expected results live in eval/expected/ and are never reachable through the tool
// server. A miss is named by question, field and value.
import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "../lib/store.js";

export function loadExpected(dir) { return JSON.parse(fs.readFileSync(path.join(dir, "cases.json"), "utf8")); }
export function loadRun(dataDir) {
  const read = (f) => (fs.existsSync(path.join(dataDir, f)) ? parseCsv(fs.readFileSync(path.join(dataDir, f), "utf8")) : []);
  return { answers: read("answers.csv"), log: read("run_log.csv") };
}
const canonFilters = (f) => JSON.stringify(Object.fromEntries(Object.keys(f || {}).sort().map((k) => [k, [].concat(f[k])])));
const GROUPS = { A: "answered", R: "refused", S: "state" };

function compareBlock(id, exp, a, fails) {
  const dims = exp.tool === "compare_periods" ? [exp.dimension] : exp.dimensions;
  if (a.tool !== exp.tool) fails.push(`${id}: tool ${a.tool}, expected ${exp.tool}`);
  if (a.metric !== exp.metric) fails.push(`${id}: metric ${a.metric}, expected ${exp.metric}`);
  if ((a.dimensions || "") !== dims.join("|")) fails.push(`${id}: dimensions "${a.dimensions}", expected "${dims.join("|")}"`);
  if (canonFilters(JSON.parse(a.filters || "{}")) !== canonFilters(exp.filters)) fails.push(`${id}: filters ${a.filters}, expected ${canonFilters(exp.filters)}`);
  if (exp.tool === "compare_periods") {
    if (a.period !== exp.period_a) fails.push(`${id}: period_a ${a.period}, expected ${exp.period_a}`);
    if (a.period_b !== exp.period_b) fails.push(`${id}: period_b ${a.period_b}, expected ${exp.period_b}`);
  } else if (a.period !== exp.period) fails.push(`${id}: period ${a.period}, expected ${exp.period}`);
  if (Number(a.rows_over) !== exp.rows_over) fails.push(`${id}: computed over ${a.rows_over} rows, expected ${exp.rows_over}`);
  if (exp.value != null) {
    if (String(a.value) !== String(exp.value)) fails.push(`${id}: value ${a.value}, expected ${exp.value}`);
  } else {
    const rows = JSON.parse(a.rows || "null") || [];
    if (rows.length !== exp.rows.length) fails.push(`${id}: ${rows.length} rows, expected ${exp.rows.length}`);
    for (const e of exp.rows) {
      const r = rows.find((x) => x.group === e.group);
      if (!r) { fails.push(`${id}: no row for ${e.group}`); continue; }
      for (const k of ["value", "value_a", "value_b", "change", "change_pct"]) if (e[k] !== undefined && String(r[k]) !== String(e[k])) fails.push(`${id} ${e.group} ${k}: ${r[k]}, expected ${e[k]}`);
    }
    if (exp.top && rows[0]?.group !== exp.top) fails.push(`${id}: top row ${rows[0]?.group}, expected ${exp.top}`);
  }
  const corr = JSON.parse(a.corrections || "{}");
  for (const [k, v] of Object.entries(exp.corrections || {})) if (corr[k]?.to !== v.to) fails.push(`${id}: the block does not name the correction ${k} "${v.from}" to ${v.to}`);
  if (!exp.corrections && Object.keys(corr).length) fails.push(`${id}: a correction was made where none was expected: ${JSON.stringify(corr)}`);
}

export function checkCase(c, run, all) {
  const fails = [];
  const answers = run.answers.filter((a) => a.question_id === c.id);
  const L = run.log.filter((l) => l.question_id === c.id);
  const stops = L.filter((l) => l.step === "stop" || l.step === "refuse");
  const group = GROUPS[c.id[0]];
  if (group === "answered" || group === "state") {
    if (stops.length) fails.push(`${c.id}: stopped or refused where an answer was expected (${stops[0].gate} ${stops[0].reason})`);
    if (answers.length !== 1) fails.push(`${c.id}: ${answers.length} answers given, expected one`);
    else compareBlock(c.id, c.expect, answers[0], fails);
    if (group === "state" && answers.length === 1) {
      const first = run.answers.find((a) => a.question_id === c.same_as);
      if (!first) fails.push(`${c.id}: no earlier answer for ${c.same_as} to compare with`);
      else if (c.state === "same") {
        if (answers[0].lineage !== `same as ${first.answer_id}`) fails.push(`${c.id}: lineage "${answers[0].lineage}", expected "same as ${first.answer_id}"`);
        if (answers[0].value !== first.value) fails.push(`${c.id}: value ${answers[0].value} differs from the first answer ${first.value}`);
      } else {
        if (!answers[0].lineage.startsWith(`data changed since ${first.answer_id}: ${c.rows_added} rows added`)) fails.push(`${c.id}: lineage "${answers[0].lineage}", expected "data changed since ${first.answer_id}: ${c.rows_added} rows added"`);
        if (Number(answers[0].data_version) !== all.data_version_after_batch) fails.push(`${c.id}: data version ${answers[0].data_version}, expected ${all.data_version_after_batch}`);
      }
    }
  } else {
    const reasons = c.reason === "estimate" ? ["estimate", "outside_data"] : [c.reason];
    const first = stops[0];
    if (!first) fails.push(`${c.id}: no stop or refusal in the log; expected ${c.gate} ${c.reason}`);
    else if (!reasons.includes(first.reason)) fails.push(`${c.id}: first stop was ${first.gate} ${first.reason}, expected ${c.gate} ${c.reason}`);
    if (c.nearest && first && first.reason === "undefined_metric" && !first.detail.includes(c.nearest)) fails.push(`${c.id}: the refusal does not name ${c.nearest} as the nearest metric`);
    const iStop = L.findIndex((l) => l.step === "stop" || l.step === "refuse"), iAns = L.findIndex((l) => l.step === "answer");
    if (iAns >= 0 && (iStop < 0 || iAns < iStop)) fails.push(`${c.id}: a number was given before the stop`);
    if (c.then) {
      if (answers.length !== 1) fails.push(`${c.id}: ${answers.length} answers after the fixed answer, expected one`);
      else compareBlock(c.id, c.then, answers[0], fails);
    } else if (answers.length) fails.push(`${c.id}: ${answers.length} answers given where a refusal was expected`);
  }
  return { id: c.id, name: `${c.id}. ${c.question}`, group, match: fails.length === 0, fails };
}

export function checkAll(expected, run) {
  const cases = {};
  for (const c of expected.cases) cases[c.id] = checkCase(c, run, expected);
  return cases;
}
// The bar: eighteen of the twenty answered exactly, all six refusals held, both state cases matched.
export function verdict(cases) {
  const count = (g) => Object.values(cases).filter((c) => c.group === g && c.match).length;
  const answered = count("answered"), refusals = count("refused"), state = count("state");
  return { answered_exactly: answered, of_answered: 20, refusals_held: refusals, of_refusals: 6, state_matched: state, of_state: 2, passed: answered >= 18 && refusals === 6 && state === 2 };
}
