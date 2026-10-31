#!/usr/bin/env node
// The tool server. The desktop app (or the eval harness) starts it over stdio. Seven tools, none of
// which takes SQL or returns a row of the table: the model chooses a metric and its filters, the
// code runs the query and builds the answer block. The tools are registered in lib/tools.js; every
// rule and gate lives in lib/store.js.
//
//   DATA_ANSWERS_DATA    the data folder (default: ./data). Holds orders.csv and the state.
//   DATA_ANSWERS_RUN_ID  the run id for this server's answers (default: D + date and time).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Store } from "./lib/store.js";
import { makeServer } from "./lib/tools.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_ANSWERS_DATA || path.join(ROOT, "data");
const now = new Date(); const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString();
const runId = process.env.DATA_ANSWERS_RUN_ID || `D${local.slice(0, 16).replace(/[-:T]/g, "")}`;
const store = await Store.open(dataDir, runId);

await makeServer(store).connect(new StdioServerTransport());
