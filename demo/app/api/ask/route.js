// The free-text path, the only route that can reach the model. Every check runs before the call.
import Anthropic from "@anthropic-ai/sdk";
import { checkBotId } from "botid/server";
import { answer, LIMITS } from "../../../lib/answer.js";
import { claim, record, stats, CAPS } from "../../../lib/limits.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const local = process.env.DEMO_LOCAL === "1" && !process.env.VERCEL;   // local tests only; never true on Vercel

async function isHuman() {
  if (local) return process.env.DEMO_LOCAL_BOT !== "BAD-BOT";
  try { const v = await checkBotId(); return !v.isBot; } catch { return false; }
}

function modelClient() {
  if (local && process.env.DEMO_MOCK === "1") return import("../../../lib/mock-model.js").then((m) => new m.MockModel());
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("no key");
  const c = new Anthropic({ apiKey: key, maxRetries: 1, timeout: LIMITS.callTimeoutMs });
  return Promise.resolve({ create: (req) => c.messages.create(req) });
}

const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req) {
  let question;
  try { question = String((await req.json())?.question ?? "").replace(/\s+/g, " ").trim(); } catch { question = ""; }
  const c = await claim(req, question, isHuman);
  if (!c.ok) {
    let s = null; try { s = await stats(); } catch {}
    return json({ ok: false, why: c.why, max_chars: CAPS.maxChars, stats: s }, c.why === "too_long" || c.why === "empty" ? 400 : 429);
  }
  let model;
  try { model = await modelClient(); } catch { await c.release(); return json({ ok: false, why: "closed" }, 503); }
  try {
    const a = await answer({ question, model });
    await record(a.cost_usd);
    return json({ ok: true, question, run_id: a.run_id, model: a.model, cost_usd: a.cost_usd, calls: a.calls, items: a.items, stats: await stats() });
  } catch (e) {
    console.error("ask failed:", e?.status || "", e?.message || e);
    return json({ ok: false, why: "error", stats: await stats().catch(() => null) }, 502);
  }
}
