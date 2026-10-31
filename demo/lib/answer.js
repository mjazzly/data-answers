// One visitor question, answered the way the harness answers one: a fresh store on a fresh copy of
// the table, the seven tools over MCP (in memory here, stdio in the harness), the skill as the only
// instructions and the question as typed. Server only. The limits below are tighter than the
// harness's and are the reason a single question has a known worst case.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const MODEL = "claude-haiku-5-5";   // fixed in code: no setting, header or input can change it
export const LIMITS = { maxCalls: 6, maxTokens: 800, maxPromptTokens: 50000, callTimeoutMs: 25000 };

export function coreDir() {
  const tries = [path.join(process.cwd(), "core"), path.join(process.cwd(), "demo", "core")];
  const hit = tries.find((d) => fs.existsSync(path.join(d, "metrics.json")));
  if (!hit) throw new Error("demo/core is missing; run npm run core");
  return hit;
}

// D + the date and minute in Kuala Lumpur time, as the harness writes it, plus four characters so two
// visitors in the same minute never share an id.
export function newRunId() {
  const t = new Date(Date.now() + 8 * 3600e3).toISOString();
  return `D${t.slice(0, 16).replace(/[-:T]/g, "")}-${crypto.randomBytes(2).toString("hex")}`;
}

let modules;
async function load() {
  if (modules) return modules;
  process.env.DATA_ANSWERS_ROOT ??= coreDir();
  const [{ Store }, { makeServer }, { Client }, { InMemoryTransport }] = await Promise.all([
    import("../core/lib/store.js"), import("../core/lib/tools.js"),
    import("@modelcontextprotocol/sdk/client/index.js"), import("@modelcontextprotocol/sdk/inMemory.js"),
  ]);
  const core = coreDir();
  const skill = fs.readFileSync(path.join(core, "skill", "SKILL.md"), "utf8").replace(/^---[\s\S]*?\n---\n/, "").trim();
  const prices = JSON.parse(fs.readFileSync(path.join(core, "eval", "prices.json"), "utf8"))[MODEL];
  if (!prices) throw new Error(`no price for ${MODEL} in eval/prices.json`);
  modules = { Store, makeServer, Client, InMemoryTransport, skill, prices, core };
  return modules;
}

export function costOf(tokens, prices) {
  return (tokens.input * prices.input + tokens.cache_write * prices.cache_write_5m + tokens.cache_read * prices.cache_read + tokens.output * prices.output) / 1e6;
}

// The page never shows text the model wrote. It shows the blocks the code returned, and for a stop or
// a refusal the code's own message, or one of these fixed lines for the two reasons only the model sees.
const FIXED = {
  single_person: "The table holds no person, so this system answers no question about one.",
  estimate: "This system computes from the data it holds and does not estimate or forecast.",
  undefined_metric: "That measure is not one of the twelve defined metrics, so this system cannot compute it.",
  ambiguous_period: "That period is relative and this system has no reference date. Give a year, a month, a quarter or a half, such as Q3 2025.",
  dimension_not_in_table: "The table has branch, month, quarter, category and channel, and nothing else.",
  value_not_in_data: "That value is not in the data.",
};

// dataDir and followUp are for scripts/check-demo.js only, which runs the twenty-eight cases through this
// same function on one data folder, as the harness does. The route passes neither.
export async function answer({ question, model, runId = newRunId(), questionId = "Q01", dataDir, followUp }) {
  const m = await load();
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), "da-"));
  if (!fs.existsSync(path.join(dir, "orders.csv"))) fs.copyFileSync(path.join(m.core, "data", "orders.csv"), path.join(dir, "orders.csv"));
  const tokens = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  const results = []; let calls = 0, stopped = null, store, client;
  try {
    store = await m.Store.open(dir, runId);
    const server = m.makeServer(store);
    const [a, b] = m.InMemoryTransport.createLinkedPair();
    client = new m.Client({ name: "data-answers-demo", version: "1.1.1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const tools = (await client.listTools()).tools.filter((t) => t.name !== "set_question")
      .map((t) => { const { $schema, ...input_schema } = t.inputSchema; return { name: t.name, description: t.description, input_schema }; });
    store.setQuestion(questionId, question);

    const messages = [];
    async function turn(text) {
      messages.push({ role: "user", content: text });
      let n = 0;   // the call limit is per question as typed; a follow-up in the check counts as a new one
      while (true) {
        if (n >= LIMITS.maxCalls) { stopped = "max_calls"; return; }
        n++; calls++;
        const res = await model.create({ model: MODEL, max_tokens: LIMITS.maxTokens, system: m.skill, tools, messages, cache_control: { type: "ephemeral" } });
        const u = res.usage || {};
        tokens.input += u.input_tokens || 0; tokens.output += u.output_tokens || 0;
        tokens.cache_read += u.cache_read_input_tokens || 0; tokens.cache_write += u.cache_creation_input_tokens || 0;
        messages.push({ role: "assistant", content: res.content });
        if (res.stop_reason !== "tool_use") return;
        if ((u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) > LIMITS.maxPromptTokens) { stopped = "prompt_size"; return; }
        const out = [];
        for (const t of res.content.filter((x) => x.type === "tool_use")) {
          if (t.name === "set_question") { out.push({ type: "tool_result", tool_use_id: t.id, content: "not available", is_error: true }); continue; }
          const r = await client.callTool({ name: t.name, arguments: t.input });
          const text = r.content.map((c) => c.text || "").join("\n");
          try { const o = JSON.parse(text); if (["ANSWER", "REFUSED", "STOPPED_AT_GATE"].includes(o.status)) results.push({ tool: t.name, input: t.input, ...o }); } catch {}
          out.push({ type: "tool_result", tool_use_id: t.id, content: text, is_error: r.isError || undefined });
        }
        messages.push({ role: "user", content: out });
      }
    }
    await turn(question);
    if (followUp && results.some((r) => r.status !== "ANSWER")) await turn(followUp);

    // A question the model answered without calling a metric (it is not about the table, or it went
    // round the tools) goes through the code's own refusal, which looks for the nearest defined metric.
    if (!results.length) {
      const r = store.modelStop("undefined_metric", "This demo answers questions about the orders table through its defined metrics, and no defined metric answers that question.", question);
      results.push({ tool: "code", ...r });
    }
  } finally {
    try { await client?.close(); } catch {}
    try { await store?.close(); } catch {}
    if (!dataDir) fs.rmSync(dir, { recursive: true, force: true });
  }
  return { run_id: runId, model: MODEL, calls, tokens, cost_usd: costOf(tokens, m.prices), stopped, items: shape(results) };
}

// Only what the card shows: block fields, never the model's prose. The last answer per metric wins
// when the model corrected itself; refusals are kept only when no answer came back.
function shape(results) {
  const answers = results.filter((r) => r.status === "ANSWER");
  const pick = answers.length ? answers.slice(-3) : results.slice(-1);
  return pick.map((r) => {
    if (r.status === "ANSWER") {
      const { status, answer_id, tool, metric, definition, unit, period, period_note, previous_period, period_a, period_b, dimensions, filters, correction_note, value, rows, rows_over, data_version, data_rows, sql, change_note } = r;
      return { kind: "answer", answer_id, tool, metric, definition, unit, period, period_note, previous_period, period_a, period_b, dimensions, filters, correction_note, value, rows, rows_over, data_version, data_rows, sql, change_note };
    }
    const message = r.tool === "stop" ? FIXED[r.reason] : (r.question || r.message);
    return { kind: r.status === "STOPPED_AT_GATE" ? "stop" : "refusal", gate: r.gate, reason: r.reason, message, nearest: r.nearest, nearest_definition: r.nearest_definition, accepted: r.accepted, period_forms: r.period_forms };
  });
}
