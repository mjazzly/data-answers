// A scripted stand-in for the model, used only to test the harness itself (--mock). For each case it
// makes the calls a careful run would, from the expected file, and asks nothing itself: the harness
// sends the fixed answers as it would to a model. It proves the plumbing (tools, gates, answers,
// lineage, checker, page) and says nothing about a model. Mock runs are never recorded.
export class MockModel {
  constructor() { this.n = 0; this.queue = []; this.phase = 0; }
  setCase(c) { this.case = c; this.phase = 0; }
  plan(c, phase) {
    const e = c.expect || c.then;
    const call = (name, input) => [name, input];
    const period = (p) => (p === "2025-H1" ? "first half of 2025" : p === "2025-H2" ? "second half of 2025" : p);
    const runExp = (x, filters) => x.tool === "compare_periods"
      ? call("compare_periods", { metric: x.metric, dimension: x.dimension, period_a: period(x.period_a), period_b: period(x.period_b) })
      : call("run_metric", { metric: x.metric, dimensions: x.dimensions, filters: filters ?? x.filters, period: period(x.period) });
    const head = phase === 1 ? [call("describe_data", {}), call("list_metrics", {})] : [];
    if (c.id[0] === "A" || c.id[0] === "S") {
      if (phase > 1) return [];
      const f = c.expect.corrections ? Object.fromEntries(Object.entries(c.expect.filters).map(([k, v]) => [k, c.expect.corrections[k] ? [c.expect.corrections[k].from] : v])) : undefined;
      return [...head, runExp(c.expect, f)];
    }
    if (phase === 1) {
      const first = {
        R01: call("run_metric", { metric: "profit_margin", dimensions: ["branch"], period: "2025" }),
        R02: call("run_metric", { metric: "returns_rate", period: "last quarter" }),
        R03: call("run_metric", { metric: "revenue", dimensions: ["salesperson"], period: "2025" }),
        R04: call("stop", { reason: "single_person", text: "The table holds no person, so I cannot answer a question about Sarah Mitchell." }),
        R05: call("run_metric", { metric: "orders", filters: { branch: "Lakeside" }, period: "2025" }),
        R06: call("run_metric", { metric: "revenue", period: "January 2026" }),
      }[c.id];
      return [...head, first];
    }
    if (phase === 2 && c.then) return [runExp(c.then)];
    return [];
  }
  async create(req) {
    const phase = req.messages.filter((m) => m.role === "user" && typeof m.content === "string").length;
    if (phase !== this.phase) { this.phase = phase; this.queue = this.plan(this.case, phase); }
    if (!this.queue.length) return { stop_reason: "end_turn", content: [{ type: "text", text: "Mock: done with this question." }], usage: null };
    const [name, input] = this.queue.shift();
    return { stop_reason: "tool_use", usage: null, content: [{ type: "tool_use", id: `mock_${++this.n}`, name, input }] };
  }
}
