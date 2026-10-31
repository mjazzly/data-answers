// Every check that stands between a visitor's free-text question and the model, and the counters the
// footer and the nightly record read. Kept in Upstash Redis (through Vercel's marketplace). Each cap
// is claimed with one atomic increment, so two visitors at once cannot both take the last place.
// If Redis cannot be reached the free-text path stays closed: it fails shut, never open.
import crypto from "node:crypto";
import { Redis } from "@upstash/redis";

const num = (v, d) => (v == null || v === "" || Number.isNaN(Number(v)) ? d : Number(v));
export const CAPS = {
  daily: num(process.env.DAILY_CAP, 150),
  perIp: num(process.env.IP_CAP, 10),
  budgetUsd: num(process.env.APP_BUDGET_USD, 15),        // the app closes free text here
  workspaceUsd: num(process.env.WORKSPACE_LIMIT_USD, 20), // the Console limit, for the alert lines
  maxChars: 200,
};
const MICRO = 1e6;

// ---------- the store: Upstash, or an in-memory stand-in for local tests only ----------
class Memory {
  constructor() { this.m = new Map(); }
  async incr(k) { const v = (Number(this.m.get(k)) || 0) + 1; this.m.set(k, String(v)); return v; }
  async incrby(k, n) { const v = (Number(this.m.get(k)) || 0) + n; this.m.set(k, String(v)); return v; }
  async decr(k) { return this.incrby(k, -1); }
  async get(k) { return this.m.get(k) ?? null; }
  async set(k, v, o = {}) { if (o.nx && this.m.has(k)) return null; this.m.set(k, String(v)); return "OK"; }
  async del(k) { this.m.delete(k); return 1; }
  async mget(...ks) { return ks.map((k) => this.m.get(k) ?? null); }
  async expire() { return 1; }
}
let db;
export function store() {
  if (db) return db;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) db = new Redis({ url, token, automaticDeserialization: false });
  else if (process.env.DEMO_LOCAL === "1" && !process.env.VERCEL) db = globalThis.__daMemory ??= new Memory();
  else throw new Error("no Redis configured");
  return db;
}

// The day is the UTC day, so the daily cap resets at 8:00 AM Kuala Lumpur time.
export const dayKey = (t = new Date()) => t.toISOString().slice(0, 10);
export const monthKey = (t = new Date()) => t.toISOString().slice(0, 7);
const K = {
  kill: "da:free_text",                                   // set to "off" in the Upstash console to close free text at once
  count: (d) => `da:day:${d}:questions`,
  ip: (d, h) => `da:day:${d}:ip:${h}`,
  dayCost: (d) => `da:day:${d}:cost_micro`,
  blocked: (d, why) => `da:day:${d}:blocked:${why}`,
  monthCost: (m) => `da:month:${m}:cost_micro`,
  monthQ: (m) => `da:month:${m}:questions`,
};
export const KEYS = K;

export function ipHash(req) {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  return crypto.createHash("sha256").update(`${process.env.IP_SALT || "data-answers-demo"}|${ip}`).digest("hex").slice(0, 16);
}

export async function freeTextOpen() {
  if (["off", "0", "false"].includes(String(process.env.FREE_TEXT || "").toLowerCase())) return false;
  return (await store().get(K.kill)) !== "off";
}

async function note(why) { const r = store(), d = dayKey(); await r.incr(K.blocked(d, why)); await r.expire(K.blocked(d, why), 40 * 86400); }

// The checks in order. Returns { ok: true, release } or { ok: false, why }.
// release() gives the places back when nothing was sent to the model.
export async function claim(req, question, botCheck) {
  let r;
  try { r = store(); if (!(await freeTextOpen())) return { ok: false, why: "closed" }; }
  catch { return { ok: false, why: "closed" }; }
  if (typeof question !== "string" || !question.trim()) return { ok: false, why: "empty" };
  if (question.length > CAPS.maxChars) return { ok: false, why: "too_long" };
  if (botCheck && !(await botCheck())) { await note("bot"); return { ok: false, why: "bot" }; }
  const d = dayKey(), m = monthKey(), ipKey = K.ip(d, ipHash(req));
  const mine = await r.incr(ipKey); await r.expire(ipKey, 2 * 86400);
  if (mine > CAPS.perIp) { await r.decr(ipKey); await note("ip_cap"); return { ok: false, why: "ip_cap" }; }
  const all = await r.incr(K.count(d)); await r.expire(K.count(d), 40 * 86400);
  if (all > CAPS.daily) { await r.decr(K.count(d)); await r.decr(ipKey); await note("daily_cap"); return { ok: false, why: "daily_cap" }; }
  const spent = Number(await r.get(K.monthCost(m))) / MICRO || 0;
  if (spent >= CAPS.budgetUsd) { await r.decr(K.count(d)); await r.decr(ipKey); await note("budget"); return { ok: false, why: "budget" }; }
  return { ok: true, release: async () => { await r.decr(K.count(d)); await r.decr(ipKey); } };
}

// After the model call: add what it cost to the day and the month.
export async function record(costUsd) {
  const r = store(), d = dayKey(), m = monthKey(), micro = Math.ceil(costUsd * MICRO);
  await r.incrby(K.dayCost(d), micro); await r.expire(K.dayCost(d), 40 * 86400);
  await r.incrby(K.monthCost(m), micro); await r.expire(K.monthCost(m), 70 * 86400);
  await r.incr(K.monthQ(m)); await r.expire(K.monthQ(m), 70 * 86400);
}

export async function stats(day = dayKey()) {
  const r = store(), m = day.slice(0, 7);
  const [q, dc, mc, mq, bot, ipc, dcap, bud, kill] = await r.mget(K.count(day), K.dayCost(day), K.monthCost(m), K.monthQ(m),
    K.blocked(day, "bot"), K.blocked(day, "ip_cap"), K.blocked(day, "daily_cap"), K.blocked(day, "budget"), K.kill);
  const n = (v) => Number(v) || 0;
  const monthCost = n(mc) / MICRO;
  const envOff = ["off", "0", "false"].includes(String(process.env.FREE_TEXT || "").toLowerCase());
  return {
    day, month: m, questions: n(q), daily_cap: CAPS.daily, ip_cap: CAPS.perIp,
    cost_day_usd: n(dc) / MICRO, cost_month_usd: monthCost, month_questions: n(mq),
    app_budget_usd: CAPS.budgetUsd, workspace_limit_usd: CAPS.workspaceUsd,
    share_of_workspace: CAPS.workspaceUsd ? monthCost / CAPS.workspaceUsd : null,
    blocked: { bot: n(bot), ip_cap: n(ipc), daily_cap: n(dcap), budget: n(bud) },
    free_text: envOff || kill === "off" ? "off" : monthCost >= CAPS.budgetUsd ? "budget" : n(q) >= CAPS.daily ? "daily_cap" : "on",
    model: "claude-haiku-5-5",
  };
}
