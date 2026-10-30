#!/usr/bin/env node
// The eval harness. One command asks every question in the case set and records the result.
//
//   node eval/run_eval.js --model claude-opus-5-5 [--effort high] [--label name] [--max-calls 12]
//   node eval/run_eval.js --mock          (no API call: a scripted stand-in makes the known calls; never recorded)
//   node eval/run_eval.js --page-only     (rebuild EXEMPLAR.md from eval/results without running anything)
//
// What a run does:
//   1. Copies data/orders.csv into an empty folder under eval/runs/<label>/data and starts the real
//      tool server (server.js) on it, as the desktop app does, over MCP.
//   2. Asks the twenty-eight questions one at a time, each in a fresh conversation: the skill
//      (skill/SKILL.md) as the only instructions, the server's tools (set_question kept back; the
//      harness calls it itself), and the question as a person would type it. When the model stops
//      at a gate and the case has a fixed answer (eval/answers.txt), sends it and lets the model finish.
//   3. Before the last question, stops the server, loads data/batch_2.csv with scripts/load_batch.js
//      (the model has no load tool), and starts the server again on the same folder.
//   4. Checks every block against eval/expected/cases.json (which the model cannot reach), writes
//      eval/results/<label>.json and the transcript, and rebuilds eval/EXEMPLAR.md.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { loadExpected, loadRun, checkAll, verdict } from "./check.js";
import { writePage } from "./page.js";
import { MockModel } from "./mock.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(here);
const EVAL = path.join(ROOT, "eval");

// ---------- arguments ----------
const argv = process.argv.slice(2);
const arg = (name, dflt = null) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
const flag = (name) => argv.includes(`--${name}`);
const MOCK = flag("mock");
const MODEL = MOCK ? "mock (scripted, no model)" : arg("model", "claude-opus-5-5");
const EFFORT = arg("effort");
const MAX_CALLS = Number(arg("max-calls", 12));   // per question
const CACHE = !flag("no-cache");
const ONLY = arg("only");                          // one case id, for a quick look; never recorded

const skillText = fs.readFileSync(path.join(ROOT, "skill", "SKILL.md"), "utf8");
const skillBody = skillText.replace(/^---[\s\S]*?\n---\n/, "").trim();
const skillVersion = (/Version: (v[\d.]+)/.exec(skillText) || [])[1] || "unknown";
const serverVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

if (flag("page-only")) {
  console.log("page written:", writePage(path.join(EVAL, "results"), path.join(EVAL, "EXEMPLAR.md"), { version: skillVersion }));
  process.exit(0);
}
function apiKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  const envFile = path.join(ROOT, ".env");
  if (fs.existsSync(envFile)) { const m = /^ANTHROPIC_API_KEY\s*=\s*"?([^"\n]+)"?/m.exec(fs.readFileSync(envFile, "utf8")); if (m) return m[1].trim(); }
  console.error("No API key. Put ANTHROPIC_API_KEY=... in .env in this folder (see .env.example), or set it in the environment.");
  process.exit(2);
}

// ---------- the run folder ----------
const now = new Date();
const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString();
const date = local.slice(0, 10);
const RUN_ID = `D${local.slice(0, 16).replace(/[-:T]/g, "")}`;
const modelTag = MOCK ? "mock" : MODEL.replace(/^claude-/, "");
const LABEL = arg("label", `${RUN_ID}-${modelTag}${EFFORT ? "-" + EFFORT : ""}`);
const runDir = path.join(EVAL, MOCK || ONLY ? "runs-mock" : "runs", LABEL);
const dataDir = path.join(runDir, "data");
fs.rmSync(runDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });
fs.copyFileSync(path.join(ROOT, "data", "orders.csv"), path.join(dataDir, "orders.csv"));

// ---------- the tool server ----------
let mcp, tools;
async function startServer() {
  mcp = new Client({ name: "eval-harness", version: "1.0.0" });
  await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "server.js")], env: { ...process.env, DATA_ANSWERS_DATA: dataDir, DATA_ANSWERS_RUN_ID: RUN_ID }, stderr: "ignore" }));
  tools = (await mcp.listTools()).tools.filter((t) => t.name !== "set_question").map((t) => { const { $schema, ...input_schema } = t.inputSchema; return { name: t.name, description: t.description, input_schema }; });
}
async function callTool(name, input) { const r = await mcp.callTool({ name, arguments: input }); return { text: r.content.map((c) => c.text || "").join("\n"), isError: !!r.isError }; }
await startServer();

// ---------- the model ----------
const model = MOCK ? new MockModel() : new Anthropic({ apiKey: apiKey() });
const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
const transcript = [];
let calls = 0;

async function runUntilEnd(messages, budget) {
  while (true) {
    if (budget.calls >= MAX_CALLS) throw new Error(`stopped after ${MAX_CALLS} model calls on one question`);
    budget.calls++; calls++;
    const req = { model: MODEL, max_tokens: 4000, system: skillBody, tools, messages };
    if (EFFORT) req.output_config = { effort: EFFORT };
    if (CACHE) req.cache_control = { type: "ephemeral" };
    const res = MOCK ? await model.create(req) : await model.messages.create(req);
    if (res.usage) {
      tokens.input += res.usage.input_tokens || 0; tokens.output += res.usage.output_tokens || 0;
      tokens.cache_read += res.usage.cache_read_input_tokens || 0; tokens.cache_write += res.usage.cache_creation_input_tokens || 0;
    }
    messages.push({ role: "assistant", content: res.content });
    for (const b of res.content) if (b.type === "text" && b.text.trim()) transcript.push({ who: "model", text: b.text });
    if (res.stop_reason !== "tool_use") return res.stop_reason;
    const results = [];
    for (const b of res.content.filter((x) => x.type === "tool_use")) {
      const out = await callTool(b.name, b.input);
      transcript.push({ who: "tool", name: b.name, input: b.input, result: out.text.slice(0, 3000), is_error: out.isError });
      const status = (/"status": "(\w+)"/.exec(out.text) || [])[1];
      process.stdout.write(`    ${b.name}${b.input?.metric ? " " + b.input.metric : ""}${status && status !== "ANSWER" ? " (" + status + ")" : ""}${out.isError ? " (error)" : ""}\n`);
      results.push({ type: "tool_result", tool_use_id: b.id, content: out.text, is_error: out.isError || undefined });
    }
    messages.push({ role: "user", content: results });
  }
}
async function say(messages, text, budget) { messages.push({ role: "user", content: text }); transcript.push({ who: "person", text }); return runUntilEnd(messages, budget); }
function stoppedOn(id) { return loadRun(dataDir).log.some((l) => l.question_id === id && (l.step === "stop" || l.step === "refuse")); }

const expected = loadExpected(path.join(EVAL, "expected"));
const answers = Object.fromEntries(fs.readFileSync(path.join(EVAL, "answers.txt"), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const cases = ONLY ? expected.cases.filter((c) => c.id === ONLY) : expected.cases;
console.log(`run ${LABEL}: skill ${skillVersion}, server ${serverVersion}, model ${MODEL}${EFFORT ? ", effort " + EFFORT : ""}, ${cases.length} questions`);
let completed = true, error = null;
try {
  for (const c of cases) {
    if (c.load) {
      await mcp.close();
      const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "load_batch.js"), path.join(ROOT, "data", c.load), "--data", dataDir], { encoding: "utf8" });
      if (r.status !== 0) throw new Error(`load_batch failed: ${r.stderr}`);
      console.log(`  (${r.stdout.trim()}; server restarted)`);
      await startServer();
    }
    console.log(`  ${c.id}  ${c.question}`);
    await callTool("set_question", { question_id: c.id, text: c.question });
    if (MOCK) model.setCase(c);
    const messages = [], budget = { calls: 0 };
    transcript.push({ who: "harness", text: `question ${c.id}` });
    await say(messages, c.question, budget);
    if (answers[c.id] && stoppedOn(c.id)) {
      console.log(`    (stopped; sending the fixed answer: ${answers[c.id]})`);
      await say(messages, answers[c.id], budget);
    }
  }
} catch (e) {
  completed = false; error = String(e.message || e);
  console.error("run did not finish:", error);
}
await mcp.close();

// ---------- check and record ----------
const run = loadRun(dataDir);
const checked = checkAll(expected, run);
if (ONLY) for (const id of Object.keys(checked)) if (id !== ONLY) delete checked[id];
const v = verdict(checked);
const totalIn = tokens.input + tokens.cache_read + tokens.cache_write;
const reachedModel = MOCK || totalIn + tokens.output > 0;
if (reachedModel) {
  for (const c of Object.values(checked)) console.log(`${c.match ? "MATCH" : "MISS "} ${c.name}${c.fails.length ? "\n        " + c.fails.join("\n        ") : ""}`);
  if (!ONLY) console.log(`\n${v.answered_exactly} of 20 answered exactly, ${v.refusals_held} of 6 refusals held, state ${v.state_matched} of 2: ${v.passed ? "BAR MET" : "BAR NOT MET"}`);
}
let cost = null;
try {
  const prices = JSON.parse(fs.readFileSync(path.join(EVAL, "prices.json"), "utf8"))[MODEL];
  if (prices) cost = (tokens.input * prices.input + tokens.cache_write * prices.cache_write_5m + tokens.cache_read * prices.cache_read + tokens.output * prices.output) / 1e6;
} catch {}
console.log(`model calls ${calls}; input ${totalIn} (fresh ${tokens.input}, cache write ${tokens.cache_write}, cache read ${tokens.cache_read}), output ${tokens.output}${cost != null ? `; cost US$${cost.toFixed(3)} (US$${(cost / 28).toFixed(4)} a question)` : ""}${CACHE ? "; caching on" : "; caching off"}`);

const record = { label: LABEL, run_id: RUN_ID, date, started_at: local, mode: MOCK ? "mock" : ONLY ? "one question" : "harness", blind: true,
  counted: !MOCK && !ONLY && completed, skill_version: skillVersion, server_version: serverVersion, model: MODEL, effort: EFFORT,
  questions: cases.length, model_calls: calls, tokens, total_input: totalIn, cost_usd: cost, cost_per_question_usd: cost == null ? null : cost / 28, cache: CACHE, completed, error, verdict: v, cases: checked,
  note: !completed ? `Did not finish: ${error}` : undefined };
fs.writeFileSync(path.join(runDir, "transcript.json"), JSON.stringify({ system: "skill/SKILL.md " + skillVersion, transcript }, null, 2));
fs.writeFileSync(path.join(runDir, "result.json"), JSON.stringify(record, null, 2));
if (!MOCK && !ONLY && !reachedModel) {
  console.log(`not recorded: the run never reached the model (${error || "no tokens"}). Details in ${runDir}`);
} else if (!MOCK && !ONLY) {
  fs.mkdirSync(path.join(EVAL, "results"), { recursive: true });
  fs.writeFileSync(path.join(EVAL, "results", `${LABEL}.json`), JSON.stringify(record, null, 2));
  console.log("page written:", writePage(path.join(EVAL, "results"), path.join(EVAL, "EXEMPLAR.md"), { version: skillVersion }));
} else {
  console.log(`${MOCK ? "mock" : "one question"} run: recorded in ${runDir} only; the exemplar page is not touched`);
}
process.exit(v.passed || ONLY ? 0 : 1);
