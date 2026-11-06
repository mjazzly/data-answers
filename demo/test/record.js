// No key. The daily record's catch-up list (scripts/missing-days.js): each finished UTC day from the
// demo's first day, never more than 35 days back, that has no record file yet.
//   node test/record.js
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { missingDays, recordedDays } from "../scripts/missing-days.js";

const span = (a, b) => { const out = []; for (let t = Date.parse(a + "T00:00:00Z"); t <= Date.parse(b + "T00:00:00Z"); t += 86400e3) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
const CASES = [
  ["the gap today", ["2026-10-31", "2026-11-05"], "2026-11-07", ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-06"]],
  ["nothing missing", span("2026-10-31", "2026-11-06"), "2026-11-07", []],
  ["nothing before the first day, nothing for today", [], "2026-10-31", []],
  ["never more than 35 days back", ["2026-10-31"], "2026-12-20", span("2026-11-15", "2026-12-19")],
];

let failed = 0;
console.log("record: the catch-up day list");
for (const [name, have, today, want] of CASES) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "da-record-"));
  for (const d of have) fs.writeFileSync(path.join(dir, `demo-${d}.json`), "{}");
  fs.writeFileSync(path.join(dir, "notes.txt"), "");   // a file that is not a record is ignored
  try { assert.deepEqual(missingDays(recordedDays(dir), today), want); console.log(`  ok    ${name}: ${want.length} days`); }
  catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message.split("\n").join("\n        ")}`); }
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `record: ${failed} failed` : "record: all passed");
process.exit(failed ? 1 : 0);
