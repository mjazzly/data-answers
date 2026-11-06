// The days the daily record still lacks: every UTC day from the later of the demo's first day and 35 days
// ago, up to yesterday, with no results/demo-<day>.json. Today is never listed: it has not ended. The
// counters live 40 days in Redis, so every day listed can still be read. The record workflow reads the
// list, one day a line.
//   node demo/scripts/missing-days.js [results folder] [today as YYYY-MM-DD, UTC]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const FIRST_DAY = "2026-10-31";   // the demo's first record
export const BACK = 35;
const DAY = 86400e3;
const iso = (t) => new Date(t).toISOString().slice(0, 10);

export function missingDays(have, today = iso(Date.now())) {
  const t = Date.parse(`${today}T00:00:00Z`);
  const from = Math.max(Date.parse(`${FIRST_DAY}T00:00:00Z`), t - BACK * DAY);
  const out = [];
  for (let d = from; d < t; d += DAY) if (!have.has(iso(d))) out.push(iso(d));
  return out;
}

export function recordedDays(dir) {
  if (!fs.existsSync(dir)) return new Set();
  return new Set(fs.readdirSync(dir).map((f) => /^demo-(\d{4}-\d{2}-\d{2})\.json$/.exec(f)?.[1]).filter(Boolean));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [dir = "results", today] = process.argv.slice(2);
  if (today && !/^\d{4}-\d{2}-\d{2}$/.test(today)) { console.error("today must be YYYY-MM-DD"); process.exit(2); }
  for (const d of missingDays(recordedDays(dir), today)) console.log(d);
}
