// The model client for the two scripts you run from Terminal. The key comes from ../.env (the same
// file the harness reads) or the environment; --mock uses the scripted stand-in and spends nothing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";

export const DEMO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const REPO = path.dirname(DEMO);

export async function client(mock) {
  if (mock) { const { MockModel } = await import("../lib/mock-model.js"); return { fresh: () => new MockModel() }; }
  let key = process.env.ANTHROPIC_API_KEY;
  const env = path.join(REPO, ".env");
  if (!key && fs.existsSync(env)) key = (/^ANTHROPIC_API_KEY\s*=\s*"?([^"\n]+)"?/m.exec(fs.readFileSync(env, "utf8")) || [])[1]?.trim();
  if (!key) { console.error("No API key. Put the data-answers-demo key in .env in the repo folder as ANTHROPIC_API_KEY=..."); process.exit(2); }
  const c = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 25000 });
  const m = { create: (req) => c.messages.create(req) };
  return { fresh: () => m };
}
