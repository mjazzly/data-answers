#!/usr/bin/env node
// Adds the tested tables to the gate's record. demo/scripts/ci.js writes the record for the cases; this
// adds a models field to it from the dbt build that ran before them, so demo/ stays unchanged
// (transform/DESIGN.md, decision 12). The workflow runs it after the cases and before the record is
// committed.
//
//   node scripts/record_models.js results/ci [--commit <sha>]
//
// The record changed is the newest one in the folder for the commit (GITHUB_SHA, or HEAD locally).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const dir = argv[0] && !argv[0].startsWith("--") ? path.resolve(argv[0]) : null;
const at = argv.indexOf("--commit");
const commit = at >= 0 ? argv[at + 1] : process.env.GITHUB_SHA || execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const stop = (why) => { console.error(`record_models: ${why}`); process.exit(1); };
if (!dir || !fs.existsSync(dir)) stop("usage: node scripts/record_models.js <record folder> [--commit <sha>]");

const resultsPath = path.join(ROOT, "transform", "target", "run_results.json");
if (!fs.existsSync(resultsPath)) stop("no transform/target/run_results.json: the tested tables did not run");
const run = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
const tests = run.results.filter((r) => /^(test|unit_test)\./.test(r.unique_id));
const pin = fs.readFileSync(path.join(ROOT, "transform", "requirements.txt"), "utf8").match(/^dbt-duckdb==(\S+)/m);

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().reverse();
const file = files.find((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).commit === commit);
if (!file) stop(`no record in ${path.relative(ROOT, dir)} for ${commit.slice(0, 7)}`);
const record = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
record.models = { dbt: run.metadata.dbt_version, adapter: `dbt-duckdb ${pin ? pin[1] : "unknown"}`, tests_run: tests.length, tests_passed: tests.filter((r) => r.status === "pass").length };
fs.writeFileSync(path.join(dir, file), JSON.stringify(record, null, 2) + "\n");
console.log(`record_models: ${path.relative(ROOT, path.join(dir, file))}: ${record.models.tests_passed} of ${record.models.tests_run} tests passed on dbt ${record.models.dbt}`);
