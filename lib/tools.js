// The seven tools, registered on an MCP server around one Store. server.js serves them over stdio
// (the desktop app and the harness); the public demo serves the same registration in memory, so
// the model sees the same names, descriptions and schemas wherever it runs.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function makeServer(store) {
  const server = new McpServer({ name: "data-answers", version: "1.1.1" });
  const text = (o) => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o, null, 2) }] });
  const guard = (fn) => async (args) => { try { return text(await fn(args ?? {})); } catch (e) { return { isError: true, content: [{ type: "text", text: `error: ${e.message}` }] }; } };

  server.tool("describe_data", "The table: its dimensions and their accepted values, the period covered, the row count and the data version. No rows. Read this first on every question so branch, category and channel names are spelled as the data spells them.", {}, guard(() => store.describeData()));
  server.tool("list_metrics", "The defined metrics: name, plain definition, unit and the dimensions each allows. Every number the system can give comes from one of these.", {}, guard(() => store.listMetrics()));
  server.tool("describe_metric", "One metric in full: definition, unit, kind, allowed dimensions, filters, period forms and the SQL template the code fills.", { metric: z.string().describe("the metric name as list_metrics gives it") }, guard((a) => store.describeMetric(a.metric)));
  server.tool("run_metric", "Runs one defined metric with filters over one period and returns the answer block (value or rows, metric and definition, filters applied, row count computed over, data version, lineage, run id). Gates in code: an undefined metric is refused with the nearest defined one named; a relative period (last quarter, recently) stops and asks; a dimension or filter the table does not have is refused; a filter value not in the data stops and asks (one value within two edits is accepted and named as a correction); a period outside the data is refused.", {
    metric: z.string().describe("a metric name from list_metrics"),
    dimensions: z.array(z.string()).optional().describe("group the answer by these dimensions (branch, month, quarter, category, channel); empty for one number"),
    filters: z.record(z.union([z.string(), z.array(z.string())])).optional().describe("branch, category or channel: a value or a list of values, spelled as describe_data gives them"),
    period: z.string().describe("explicit: 2025, 2025-03, March 2025, 2025-Q3, Q3 2025, 2025-H1, first half of 2025, 2025-01 to 2025-06. Never a relative phrase; pass the user's words and the code will stop and ask if they are relative"),
  }, guard((a) => store.runMetric(a)));
  server.tool("compare_periods", "Runs one plain metric (orders, revenue, returns, returns_rate, returned_value, net_revenue, average_order_value, largest_order) for two periods by one dimension and returns every group's two values, the change and the change as a percent, ranked by the percent change. Same gates as run_metric.", {
    metric: z.string(), dimension: z.string().describe("branch, category or channel"),
    filters: z.record(z.union([z.string(), z.array(z.string())])).optional(),
    period_a: z.string().describe("the earlier period"), period_b: z.string().describe("the later period"),
  }, guard((a) => store.comparePeriods(a)));
  server.tool("stop", "Records a stop or a refusal for a reason no other tool can see: single_person (the question asks about one named person) or estimate (the question asks for a forecast, a guess or a rough figure). For a metric, dimension, value or period you think is missing, call run_metric instead and let the code decide; if you do refuse here, pass what was asked for in `asked` and the code adds the nearest defined metric to the record and the result. Then say so to the user in one or two sentences and give no number.", {
    reason: z.enum(["undefined_metric", "ambiguous_period", "dimension_not_in_table", "single_person", "value_not_in_data", "estimate"]),
    text: z.string().describe("the question you are asking or the refusal you are giving, in one or two sentences"),
    asked: z.string().optional().describe("what the question asked for, in its words: the metric, dimension or value (for example 'profit margin')"),
  }, guard((a) => store.modelStop(a.reason, a.text, a.asked)));
  server.tool("set_question", "Names the question the next answers belong to (an id and the question text). The harness calls this before each question; in a chat you may call it yourself or leave it, and answers get Q01, Q02 and so on.", {
    question_id: z.string(), text: z.string().optional(),
  }, guard((a) => store.setQuestion(a.question_id, a.text)));

  return server;
}
