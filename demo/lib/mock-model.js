// Local tests only (DEMO_LOCAL=1 and DEMO_MOCK=1, never on Vercel): a scripted stand-in that makes the
// calls the harness's mock makes for any question in the case set, by its text, and for anything
// else answers in prose without a tool, which the page must turn into the code's refusal.
import fs from "node:fs";
import path from "node:path";
import { MockModel as CaseMock } from "../core/eval/mock.js";

const cases = JSON.parse(fs.readFileSync(path.join(process.cwd(), "core", "eval", "expected", "cases.json"), "utf8")).cases;
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export class MockModel {
  constructor() { this.inner = new CaseMock(); this.c = undefined; }
  async create(req) {
    if (this.c === undefined) {
      const q = norm(typeof req.messages[0].content === "string" ? req.messages[0].content : "");
      this.c = cases.find((c) => norm(c.question) === q) || null;
      if (this.c) this.inner.setCase(this.c);
    }
    const usage = { input_tokens: 200, output_tokens: 150, cache_read_input_tokens: 7000, cache_creation_input_tokens: 0 };
    if (!this.c) return { stop_reason: "end_turn", usage, content: [{ type: "text", text: "Here is a poem instead." }] };
    const r = await this.inner.create(req);
    return { ...r, usage };
  }
}
