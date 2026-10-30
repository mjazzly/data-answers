#!/usr/bin/env node
// Loads one more CSV of orders into the table and moves the data version on. Not a tool the model
// can call: new rows arrive through the owner (or the harness, for state case S02), never the chat.
//   node scripts/load_batch.js data/batch_2.csv [--data <folder>]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store } from "../lib/store.js";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith("--"));
const i = argv.indexOf("--data");
const dataDir = i >= 0 ? path.resolve(argv[i + 1]) : process.env.DATA_ANSWERS_DATA || path.join(ROOT, "data");
if (!file) { console.error("usage: node scripts/load_batch.js <csv> [--data <folder>]"); process.exit(2); }
const store = await Store.open(dataDir, process.env.DATA_ANSWERS_RUN_ID || "load");
const r = await store.loadBatch(path.resolve(file));
console.log(`loaded ${path.basename(file)}: ${r.rows_added} rows added; ${r.rows} rows; data version ${r.data_version}`);
await store.close();
