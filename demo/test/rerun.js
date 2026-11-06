// No key. The gate's word for a run, and what it hands the workflow: "green", "green after rerun" (pass 1
// missed the bar, the rerun met it) or "red", with the cases pass 1 missed. Runs scripts/ci.js with the
// scripted stand-in and a GITHUB_OUTPUT file, as the workflow does, then reads cases.yml for the issue.
//   node test/rerun.js
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEMO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`  ok    ${name}`); } catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message.split("\n").join("\n        ")}`); } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "da-rerun-"));
const env = { ...process.env };
delete env.ANTHROPIC_API_KEY;   // the stand-in only; never the real model
function ci(...args) {
  const out = path.join(tmp, `out-${Math.random().toString(36).slice(2)}`);
  fs.writeFileSync(out, "");
  const r = spawnSync(process.execPath, [path.join(DEMO, "scripts", "ci.js"), ...args], { env: { ...env, GITHUB_OUTPUT: out }, encoding: "utf8" });
  const text = fs.readFileSync(out, "utf8");
  const single = Object.fromEntries([...text.matchAll(/^(status|pass1_misses)=(.*)$/gm)].map((m) => [m[1], m[2]]));
  const list = text.match(/^pass1_list<<(\S+)\n([\s\S]*?)\n?\1$/m)?.[2] ?? null;
  return { code: r.status, stdout: r.stdout, ...single, list };
}

console.log("rerun: green, green after rerun, red, and the issue");
const g = ci("--mock");
check("a clean pass is green, exit 0, no pass 1 misses", () => {
  assert.equal(g.code, 0); assert.equal(g.status, "green"); assert.equal(g.pass1_misses, ""); assert.equal(g.list.trim(), "");
});
const ga = ci("--mock", "--plant-first", "A01,A02,A03");
check("misses in pass 1 only: green after rerun, exit 0", () => { assert.equal(ga.code, 0); assert.equal(ga.status, "green after rerun"); });
check("green after rerun names the pass 1 misses by case", () => {
  assert.equal(ga.pass1_misses, "A01 A02 A03 S01 S02");   // the state cases compare with A01 and A02
  assert.match(ga.list, /^- A01\. How many orders did we take in 2025\? \(metric \w+, expected orders\)$/m);
  assert.equal(ga.list.split("\n").length, 5);
  assert.match(ga.stdout, /^pass 1 missed: A01 A02 A03 S01 S02$/m);
});
const r = ci("--mock", "--plant", "A01,A02,A03");
check("misses in both passes: red, exit 1, pass 1 misses named", () => {
  assert.equal(r.code, 1); assert.equal(r.status, "red"); assert.equal(r.pass1_misses, "A01 A02 A03 S01 S02");
});
check("--plant-first without --mock is refused", () => assert.equal(ci("--plant-first", "A01").code, 2));
check("--plant-first with --measure is refused", () => assert.equal(ci("--mock", "--measure", "2", "--plant-first", "A01").code, 2));

const yml = fs.readFileSync(path.join(DEMO, "..", ".github", "workflows", "cases.yml"), "utf8");
const steps = yml.split(/\n      - /);
const issue = steps.find((s) => s.startsWith("name: Open an issue for a green after rerun\n")) || "";
check("the workflow may open issues", () => assert.match(yml, /^permissions:\n  contents: write\n  issues: write$/m));
check("the issue opens on main, gate mode, green after rerun only", () => {
  const cond = issue.match(/^ {8}if: (.+)$/m)?.[1];
  assert.equal(cond, "always() && github.ref == 'refs/heads/main' && env.MEASURE == '0' && steps.cases.outcome == 'success' && steps.cases.outputs.status == 'green after rerun'");
});
check("one issue a commit: the title names the commit and the misses, and an existing one is not repeated", () => {
  assert.match(issue, /title="Gate green only after rerun on \$\{GITHUB_SHA::7\}: pass 1 missed \$MISSES"/);
  assert.match(issue, /gh issue list --state all --search "\\"\$title\\" in:title"/);
});
check("the issue step comes last, so it can never hold live back", () => assert.equal(steps.at(-1), issue));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `rerun: ${failed} failed` : "rerun: all passed");
process.exit(failed ? 1 : 0);
