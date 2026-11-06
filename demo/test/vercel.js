// No key. The build rule in vercel.json: only live builds, and live builds when anything the demo runs
// changed since the last successful deployment, however many commits live moved by. Runs the
// ignoreCommand as Vercel does (exit 0 skips the build, 1 builds) in a throwaway repository, and reads
// cases.yml for the deploy hook that asks Vercel to build live.
//   node test/vercel.js
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DEMO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const v = JSON.parse(fs.readFileSync(path.join(DEMO, "vercel.json"), "utf8"));
let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`  ok    ${name}`); } catch (e) { failed++; console.log(`  FAIL  ${name}\n        ${e.message.split("\n").join("\n        ")}`); } };

console.log("vercel: only live builds, and only when the demo changed");
check("deploymentEnabled is off for every branch but live", () => assert.deepEqual(v.git?.deploymentEnabled, { "*": false, live: true }));

// a throwaway repository shaped like this one, isolated from any git settings on the machine
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "da-vercel-"));
const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
const git = (...a) => execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...a], { cwd: repo, env, encoding: "utf8" }).trim();
const commit = (file, text) => { fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true }); fs.writeFileSync(path.join(repo, file), text); git("add", "-A"); git("commit", "-q", "-m", file); return git("rev-parse", "HEAD"); };
git("init", "-q", "-b", "main");
commit("demo/app.js", "1");
commit("lib/store.js", "1");
const deployed = commit("results/demo-2026-11-01.json", "{}");
const run = (ref, previous) => spawnSync("sh", ["-c", v.ignoreCommand], { cwd: path.join(repo, "demo"), env: { ...env, VERCEL_GIT_COMMIT_REF: ref, VERCEL_GIT_PREVIOUS_SHA: previous }, stdio: "ignore" }).status;

check("branch main is skipped", () => assert.equal(run("main", deployed), 0));
check("branch fix/x is skipped", () => assert.equal(run("fix/x", deployed), 0));
check("live with no previous deployment builds", () => assert.equal(run("live", ""), 1));
check("live with a previous commit outside the clone builds", () => assert.equal(run("live", "0123456789abcdef0123456789abcdef01234567"), 1));
commit("results/demo-2026-11-02.json", "{}");
check("live with only results/ changed is skipped", () => assert.equal(run("live", deployed), 0));
commit("demo/app.js", "2");
commit("results/demo-2026-11-03.json", "{}");
check("live with a demo change two commits back builds (HEAD^ would have skipped it)", () => assert.equal(run("live", deployed), 1));
const shipped = git("rev-parse", "HEAD");
commit("lib/store.js", "2");
check("live with a change in ../lib builds", () => assert.equal(run("live", shipped), 1));

fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5 });   // retries: git can still be writing as it exits

// Vercel made no deployment when the workflow first pushed live, so the workflow asks it to build,
// through the deploy hook, right after moving live and under the same condition.
const steps = fs.readFileSync(path.join(DEMO, "..", ".github", "workflows", "cases.yml"), "utf8").split(/\n      - /);
const step = (name) => steps.findIndex((s) => s.startsWith(`name: ${name}\n`));
const cond = (i) => steps[i].match(/^ {8}if: (.+)$/m)?.[1];
check("the workflow calls the deploy hook right after moving live", () => assert.equal(step("Ask Vercel to build live"), step("Move live to the commit that passed") + 1));
check("the hook runs under the same condition as the move", () => {
  const move = step("Move live to the commit that passed");
  assert.equal(cond(move + 1), cond(move));
  assert.match(cond(move), /^success\(\) && github\.ref == 'refs\/heads\/main' && env\.MEASURE == '0'$/);
});
check("the hook comes only from the secret", () => {
  assert.match(steps[step("Ask Vercel to build live")], /HOOK: \$\{\{ secrets\.VERCEL_DEPLOY_HOOK \}\}/);
  assert.doesNotMatch(steps.join("\n"), /api\.vercel\.com\/v1\/integrations\/deploy/);
});
console.log(failed ? `vercel: ${failed} failed` : "vercel: all passed");
process.exit(failed ? 1 : 0);
