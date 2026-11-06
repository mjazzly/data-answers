# Data Answers, v1.2

A business table holds one row per order: branch, date, category, channel, order value, whether it was returned. People ask questions about it all day ("returns rate by branch for Q3", "which branch grew most", "average order value in March") and each one goes to an analyst who writes a query, checks it and sends a number back. This build answers those questions in a chat, and **every number comes from a metric defined in code**: the model chooses which metric and which filters, the code runs the query, and the answer carries the metric's definition, the filters applied, the row count it was computed over, the data version and a run id. The model never writes SQL and never sees a row. A question that needs a metric nobody has defined is refused with the reason and the nearest defined metric offered.

The model chooses and reads back; the code computes and checks. The six gates are enforced in `lib/store.js`, so the model cannot skip one:

1. **Undefined metric.** Profit, margin, anything not in `metrics.json`. Refused; the nearest defined metric is named.
2. **Ambiguous period.** "Last quarter", "recently", "this year". This system has no reference date. Stops and asks.
3. **Dimension not in the table.** Customer, salesperson, product. Refused; the five dimensions are listed.
4. **A single person's data.** Refused. The table holds no person; the model records the refusal through the `stop` tool.
5. **A filter value not in the data.** A branch that does not exist stops and asks with the accepted values. One value within two edits is accepted and named in the block as a correction ("branch read as Harbour from 'Harbor'").
6. **An estimate.** A forecast, a rough figure, a period outside the data. Refused; the nearest computed metric is offered.

Every answer block also carries a lineage line: the first answer to a question, "same as" an earlier answer to the same question on the same data, or "data changed since" that answer with the rows added.

Synthetic data only. The table in `data/orders.csv` comes from `scripts/make_data.js`, a seeded generator, and the expected answers in `eval/expected/cases.json` come from the same run of it. Every push also rebuilds that table from a messy raw export through tested tables before any question is asked (below, "The tested tables"). Nothing in the data places the business in a country: the branches are place types, amounts carry no currency.

## Files

| Path | What it is |
|---|---|
| `server.js` | The tool server the desktop app (or the harness) runs. Seven tools, none of which takes SQL or returns a row. |
| `lib/store.js` | Every rule and gate, the DuckDB table, the answer block, the lineage, the logs. |
| `lib/period.js` | Reads a period as a person writes it (March 2025, Q3 2025, first half of 2025) and stops on a relative one. |
| `lib/round.js` | The one rounding rule, on integers, shared by the generator and the server. |
| `metrics.json` | The twelve metrics: name, definition, SQL template, unit, allowed dimensions, near words for the nearest-metric line. The dimensions and their accepted values. |
| `scripts/make_data.js` | The truth generator. Writes `data/orders.csv`, `data/batch_2.csv` and every expected answer from one seed. |
| `scripts/load_batch.js` | Loads more rows and moves the data version on. The model has no such tool. |
| `scripts/make_raw.js` | Writes the raw export in `transform/seeds/raw/` from the two clean files, with five kinds of mess and seeded counts. |
| `scripts/export_mart.js` | Writes `fct_orders` back to the two CSVs in `transform/target/export/`, only after a dbt build in which every test passed. |
| `scripts/csv.js` | The one CSV writer, shared by the generator, the raw export and the export from the tested tables. |
| `scripts/record_models.js` | Adds the dbt version and the test counts to the gate's record. |
| `transform/` | The tested tables: a dbt project on DuckDB. Seeds, staging, the mart, the tests, and `DESIGN.md`. |
| `test/vocab.js` | Checks the values the dbt tests accept against the vocabulary in `metrics.json`. |
| `data/` | `orders.csv` and `batch_2.csv`. Once the server has run, also the state: `answers.duckdb`, `answers.csv`, `run_log.csv`. |
| `skill/SKILL.md` | The instructions the model gets, and nothing else. Keep it the same as the copy in your Claude account. |
| `eval/CASES.md` | The case set and the decisions taken before the first run. |
| `eval/expected/cases.json` | The twenty-eight cases with their expected blocks, written by the generator. |
| `eval/run_eval.js` | The harness: one command, every question, blind, recorded. |
| `eval/check.js` | The checker: compares every block's metric, filters, period, values, row count, corrections and lineage with the expected answers, and names a miss by question, field and value. |
| `eval/answers.txt` | The fixed answers the harness gives at the two stops that have one, the same every run. |
| `eval/results/` | One record per counted run: model, calls, tokens, cost, verdict, every case. |
| `eval/EXEMPLAR.md` | The living record, rebuilt from `eval/results/` after every run. |
| `eval/prices.json` | The price table the cost is computed from, with its source and date. |
| `lib/tools.js` | The seven tools, registered once; `server.js` serves them over stdio, the demo in memory. |
| `demo/` | The public demo: one Next.js page on Vercel with every cost and abuse control. See `demo/README.md`. |
| `results/` | One record a day of the demo's questions and cost, written by `.github/workflows/demo-record.yml`. |
| `.github/workflows/cases.yml` | The gate in front of the demo: every push runs the twenty-eight cases through the demo's own path on the smallest model, and only a green run on `main` moves the `live` branch Vercel deploys. See `demo/README.md` and `demo/GATE.md`. |
| `results/ci/` | One record per gate run on `main`, green or red: every case, the verdict, tokens and cost. Measure runs go to `results/ci-measure/`. |

## Run it

Needs Node 20 or later.

```
npm install
node scripts/make_data.js         # regenerates data/ and eval/expected from the seed (already committed)
node eval/run_eval.js --mock      # proves the plumbing with a scripted stand-in; no API call; never recorded
```

### Rerun every question with one command (the harness)

```
node eval/run_eval.js --model claude-haiku-5-5
node eval/run_eval.js --model claude-opus-5-5 --effort high
```

It copies the table into an empty folder under `eval/runs/`, starts this server on it, and asks the twenty-eight questions one at a time, each in a fresh conversation with the skill and the tools and nothing else. When the model stops at a gate that has a fixed answer, it sends the answer from `eval/answers.txt`. Before the last question it stops the server, loads `data/batch_2.csv` through `scripts/load_batch.js` and starts the server again, so the answer must change and say so. Then it checks every block against `eval/expected/cases.json`, writes `eval/results/<label>.json` with the tokens and the cost, and rebuilds `eval/EXEMPLAR.md`. The `data/` folder in this repo is never touched.

It needs an Anthropic API key in a file called `.env` in this folder (see `.env.example`). Use a dedicated key with a low spend limit and delete it when you are done.

- `--model` picks the model, so the same questions can be run on a smaller tier to see whether it still passes.
- `--effort high` sets the effort level where the model offers one.
- `--only A17` asks one question and shows the calls; never recorded.
- `--page-only` rebuilds the page from the recorded runs.
- `--max-calls` caps the model calls on one question (default 12).

### Connect it to the Claude desktop app

1. In Terminal, run `which node` and copy the path it prints.
2. Claude desktop app, Settings, Developer, Edit Config. Add this inside `"mcpServers"` (replace both paths with yours):

```json
"data-answers": {
  "command": "/path/from/which/node",
  "args": ["/path/to/data-answers/server.js"]
}
```

3. Quit and reopen the desktop app. In a new chat, the tools menu should list `data-answers` with seven tools. Add the skill from `skill/SKILL.md` to your account and ask a question about the table.

### Start again from an empty answer log

Delete `data/answers.duckdb`, `data/answers.csv` and `data/run_log.csv`. The server rebuilds the table from `data/orders.csv` on its next start.

## The tested tables

`data/orders.csv` is the table the metrics read, and it is rebuilt on every push from a raw export through tested tables. A model here is one SQL query that builds one table; a test is a query that must return nothing. dbt runs both in order and stops the build when a test fails. The design, every test and its expected outcome are in `transform/DESIGN.md`.

| Layer | Tables | What it does |
|---|---|---|
| Raw | seeds `raw_orders`, `raw_returns`, `branch_codes`, all text | The export as it arrives, two batches marked by `export_batch` |
| Staging | `stg_orders`, `stg_returns` | Trims, maps, casts, removes repeats, derives the date parts; one row per order and one per returned order |
| Mart | `fct_orders` | One row per order in the exact columns, types and order of `data/orders.csv`, plus `export_batch` |

The raw export carries five kinds of mess: returns as a separate file of events, some logged twice; branch as a code; order time as a text timestamp; rows the export repeats; category, channel and order value in inconsistent text. There are 37 tests: 7 unit tests on fixed rows and 30 data tests on the export, including three that reconcile rows, order value and returns with the raw files. Then the export from `fct_orders` must equal the two committed CSVs byte for byte.

The raw tables land as dbt seeds so the build needs nothing but the repo. A real project lands raw tables with a loader and reads them as sources.

Rebuild it (needs Python 3.12 and uv):

```
uv venv --python 3.12 transform/.venv
uv pip install --python transform/.venv -r transform/requirements.txt
source transform/.venv/bin/activate
node scripts/make_raw.js                  # the raw export (already committed)
cd transform && dbt build && cd ..        # every seed, model and test
node scripts/export_mart.js               # fct_orders back to transform/target/export/
cmp data/orders.csv transform/target/export/orders.csv && cmp data/batch_2.csv transform/target/export/batch_2.csv
node test/vocab.js
```

**The late returns limit.** A return for a batch 2 order sits in batch 2 only. `scripts/load_batch.js` appends rows and never updates an earlier one, so a late return for a batch 1 order could not be shown. The test `assert_returns_in_order_batch` turns red on one rather than hiding it.

## Limits

One synthetic table of one calendar year; twelve metrics; five dimensions; one data folder; no chart, no export, no external system connected. A question that needs two metrics combined (revenue per returned order, say) is two blocks, never a computed third number.
