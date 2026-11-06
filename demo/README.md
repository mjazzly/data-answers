# Data answers, the public demo

One page on Vercel where a visitor asks a question about the synthetic orders table and gets the answer block back: the figure, the metric and its definition, the period, the filters, the rows it was computed over, the data version and the run id. The model call and the metric code run in the server function; the browser never sees a key.

`scripts/copy-core.js` copies the build's own files (`lib/`, `metrics.json`, `data/orders.csv`, `skill/SKILL.md`, `eval/prices.json`) into `demo/core` before every build, byte for byte, so the demo runs exactly what the harness tested. The model sees the same seven tools, registered by `lib/tools.js`, over an in-memory connection instead of stdio.

## What stands between a visitor and the model

In order, in `lib/limits.js` and `app/api/ask/route.js`, before any call:

1. **Kill switch.** Upstash console, CLI tab: `SET da:free_text off` closes free text at once; `DEL da:free_text` opens it. The `FREE_TEXT=off` setting in Vercel does the same but needs a redeploy. **Never run `FLUSHDB` or `FLUSHALL` in the Upstash console: the database is shared.** Another build keeps its state in it under its own prefix. The app itself touches only `da:` keys: `store()` in `lib/limits.js` throws on any other key, and offers no command that lists or flushes keys (`test/keys.js`).
2. **200 characters** at most.
3. **Vercel BotID** (Basic) on the free-text route.
4. **Per-connection cap**, 10 a day (`IP_CAP`). Addresses are kept only as a salted hash.
5. **Daily cap**, 150 a day across everyone (`DAILY_CAP`). The day is the UTC day: it resets at 8:00 AM Kuala Lumpur time.
6. **Monthly budget**, US$15 of counted spend (`APP_BUDGET_USD`), under the Console workspace limit of US$20.

Each cap is claimed with one atomic increment, so two visitors at once cannot both take the last place. If Redis cannot be reached, free text stays closed.

Per question (`lib/answer.js`): the smallest model only, fixed in code; at most 6 model calls and 800 output tokens a call; a prompt over 50,000 tokens ends the question. The page shows only what the code returned, never text the model wrote; a question that reaches no metric goes through the code's own refusal, which names the nearest defined metric.

**Presets** are recorded once by `npm run presets` into `presets.json` and served from it, so a click never reaches the model.

## Worst case a month

150 questions a day for 31 days is 4,650 questions. On the v1.1 harness run a question used about 22,000 input and 550 output tokens: US$0.0014 with cache hits, US$0.0030 with none, so US$14.09 a month with none and US$16.91 with a 20% margin. Every question running to the per-question limits would be US$0.0114, or US$53.01 a month; the app's own US$15 budget closes free text before that, and the Console limit of US$20 stands behind it.

## Settings in Vercel

| Name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | the key from the `data-answers-demo` Console workspace |
| `IP_SALT` | any long random string |
| `DAILY_CAP`, `IP_CAP`, `APP_BUDGET_USD`, `WORKSPACE_LIMIT_USD` | optional; 150, 10, 15 and 20 when unset |
| `FREE_TEXT` | optional; `off` closes free text after a redeploy |
| Upstash Redis | added from the Vercel Marketplace, which sets its own URL and token |

Project root directory: `demo`.

## The gate: production tracks `live`

Vercel production deploys from the `live` branch, and nothing else builds (`vercel.json`). Only the `cases` workflow (`.github/workflows/cases.yml`) moves `live`, only from `main`, and only after the twenty-eight cases passed. Nobody pushes `live` by hand. The design and the reasons are in `GATE.md`.

On every push to any branch, and on dispatch:

1. **No key:** the harness mock, `npm run check -- --mock`, `npm test` (the key guard, the presets against the code, the build rule, the record's day list, the rerun's word, the tier on the page) and `npm run build`.
2. **The twenty-eight cases** through `lib/answer.js` on the smallest model, with the key from the `data-answers-ci` Console workspace (`scripts/ci.js`). Marked by `eval/check.js` against the bar in `harness.json`; every miss is printed by case and line. A pass that misses the bar runs once more as a whole; red only if it misses again.
3. **On `main`:** the record is committed to `results/ci/`, green or red.
4. **On `main` and green:** `live` moves to the commit that passed, and the workflow calls the Vercel deploy hook for `live` (secret `VERCEL_DEPLOY_HOOK`; Vercel made no deployment when the workflow first pushed `live`). Vercel builds it when anything the demo runs changed since its last deployment.

A red run moves nothing: visitors keep the last version that passed. A run that meets the bar only on the rerun is "green after rerun": `live` moves, the record says so with the cases pass 1 missed, and the workflow opens one GitHub issue naming them. A dispatch with `measure` above 0 runs that many passes with no gate (`effort` optional) and records them to `results/ci-measure/`; it never moves `live`. cron-job.org dispatches the gate on `main` every Sunday at 9:41 AM Kuala Lumpur time.

```
node scripts/ci.js --mock                 # the gate's path with the scripted stand-in; no key, nothing recorded
node scripts/ci.js --mock --plant A01,A02,A03   # three cases made to miss: shows red (one alone stays green; the bar allows two)
node scripts/ci.js --mock --plant-first A01,A02,A03   # the same misses in pass 1 only: shows green after rerun
ANTHROPIC_API_KEY=... node scripts/ci.js  # the gate on the smallest model (data-answers-ci key; about US$0.04 a pass)
```

## The record

`.github/workflows/demo-record.yml` reads `/api/stats` every hour. On every run it writes each finished UTC day that has no record yet to `results/demo-YYYY-MM-DD.json`, from the demo's first day (31 Oct 2026) and never more than 35 days back (`scripts/missing-days.js`), so a late or skipped run is caught up by the next. A daily dispatch from cron-job.org at 8:23 AM Kuala Lumpur time stands behind GitHub's own schedule. When this month's counted spend crosses 50% or 75% of the workspace limit it opens one issue, which GitHub emails to the owner. It needs the repository variable `DEMO_URL`. A commit that only adds a record does not rebuild the site (`vercel.json`).

## Run it locally

```
cd demo
npm install
npm run check -- --mock     # the 28 cases through the demo path, scripted stand-in, no API call
npm run check               # the same on the smallest model with the demo key in ../.env (about US$0.04)
npm run presets             # record the eight presets (about US$0.01)
DEMO_LOCAL=1 DEMO_MOCK=1 npm run dev   # the page on localhost with an in-memory counter and the stand-in
```
