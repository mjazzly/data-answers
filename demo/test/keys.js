// No key. The shared database holds the meeting tracker's mt: keys beside the demo's da: keys, so the
// demo must never touch a key it did not name. This test proves the guard in lib/limits.js:
//   1. every key in KEYS starts with da:
//   2. the store wrapper throws on mt:x and on a bare key, before the client is called
//   3. a da: key passes through unchanged
//   4. no source under demo/ and no workflow lists keys, flushes the database or names an mt: key
//   5. in CI, no Upstash variable is set, and the gate's workflow names none
//   node test/keys.js
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KEYS, guarded } from "../lib/limits.js";

const DEMO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(DEMO);
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`  ok    ${name}`); } catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message}`); } };

console.log("keys: the demo touches da: keys only");

// 1. every key the demo names
const samples = Object.entries(KEYS).map(([k, v]) => [k, typeof v === "function" ? v("2026-11-06", "ip_cap") : v]);
check(`every entry in KEYS (${samples.length}) starts with da:`, () => {
  assert.equal(samples.length, 7);
  for (const [k, key] of samples) assert.ok(key.startsWith("da:"), `${k} gives ${key}`);
});

// 2 and 3. the wrapper, over a fake client that records every call
const calls = [];
const fake = new Proxy({}, { get: (_, op) => (...a) => { calls.push([op, ...a]); return "OK"; } });
const db = guarded(fake);
const ops = { get: [], set: ["1"], incr: [], incrby: [5], decr: [], expire: [60], del: [] };
for (const bad of ["mt:x", "x"]) {
  check(`every command throws on ${bad} and never reaches the client`, () => {
    for (const [op, rest] of Object.entries(ops)) assert.throws(() => db[op](bad, ...rest), /refused: key/, `${op} let ${bad} through`);
    assert.throws(() => db.mget("da:a", bad), /refused: key/, `mget let ${bad} through`);
    assert.throws(() => db.del("da:a", bad), /refused: key/, `del let ${bad} through`);
    assert.equal(calls.length, 0, `the client was called: ${JSON.stringify(calls)}`);
  });
}
check("a da: key passes through unchanged", () => {
  for (const [op, rest] of Object.entries(ops)) assert.equal(db[op]("da:a", ...rest), "OK");
  assert.equal(db.mget("da:a", "da:b"), "OK");
  assert.deepEqual(calls.at(-1), ["mget", "da:a", "da:b"]);
  assert.equal(calls.length, Object.keys(ops).length + 1);
});
check("the wrapper offers no command to list keys or flush the database", () => {
  for (const op of ["keys", "scan", "flushdb", "flushall"]) assert.equal(db[op], undefined, `${op} exists`);
});

// 4. the source scan: the Redis commands as code calls them, and mt: anywhere
const BAD = [/mt:/, /(?<!Object)\.(keys|scan|flushdb|flushall)\s*\(/i, /["'`](KEYS|SCAN|FLUSHDB|FLUSHALL)["'`]/i];
const SKIP = new Set(["node_modules", ".next", "core", "test"]);
function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) yield* files(path.join(dir, e.name)); }
    else if (/\.(js|mjs|cjs|json|yml|yaml)$/.test(e.name)) yield path.join(dir, e.name);
  }
}
const workflows = path.join(REPO, ".github", "workflows");
const scanned = [...files(DEMO), ...(fs.existsSync(workflows) ? [...files(workflows)] : [])];
check(`no source file lists keys, flushes or names an mt: key (${scanned.length} files)`, () => {
  const hits = [];
  for (const f of scanned) fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => { if (BAD.some((r) => r.test(line))) hits.push(`${path.relative(REPO, f)}:${i + 1}: ${line.trim().slice(0, 100)}`); });
  assert.deepEqual(hits, []);
});

// 5. CI never connects to Upstash
check("in CI, no UPSTASH_ or KV_ variable is set", () => {
  if (!process.env.CI) return;
  assert.deepEqual(Object.keys(process.env).filter((k) => /^(UPSTASH_|KV_)/.test(k)), []);
});
const gate = path.join(workflows, "cases.yml");
check("the gate's workflow names no Upstash variable", () => {
  assert.ok(fs.existsSync(gate), ".github/workflows/cases.yml is missing");
  assert.doesNotMatch(fs.readFileSync(gate, "utf8"), /UPSTASH_|KV_/);
});

console.log(failed ? `keys: ${failed} failed` : "keys: all passed");
process.exit(failed ? 1 : 0);
