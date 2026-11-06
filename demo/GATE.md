# The deploy gate, design note

Status: for approval. Nothing is built. Read on 6 Nov 2026 from `origin/main` (`ffc2727`) and `origin/demo` (`ee443df`).

Today any push to `demo` reaches `https://data-answers.vercel.app` with nothing checked. After this build, every change to `main` runs the 28 cases through the demo's own code path on the smallest model, and only a green run moves the `live` branch that Vercel deploys from. CI (continuous integration) is a check that runs on every change, on GitHub's machines, before the change can reach the live service.

## 1. Decisions

Recommendation first in each. Megat marks each one.

| # | Decision | Recommended | Alternative |
|---|---|---|---|
| 1 | Where the gate sits | `main` to `live`, `demo` frozen, as WORK-08 | `demo` to `live` |
| 2 | Which pass gates | The demo's own path (`demo/lib/answer.js`, its 6 calls and 800 output tokens a question): what a visitor reaches. The scorecard keeps running the harness path | The root harness through the MCP server |
| 3 | Effort | Gate on the service's settings (effort unset). After the first green push, `measure 5` at the default and `measure 5` at `high`. Keep the lowest setting that met the bar in five of five; if both did, keep the default. A change goes through the gate as its own commit | Pick an effort now |
| 4 | CI key | New workspace `data-answers-ci`, US$5 a month, so CI spend never counts against the demo's budget lines | The demo's own key |
| 5 | Builds | `live` only | Previews from every branch too |
| 6 | The record gap | Catch-up writes plus a daily cron-job.org dispatch; backfills 1 to 4 Nov | Leave the job as it is |
| 7 | The site | One "How it runs" line on WORK-03 and a link to `results/ci/`, pill unchanged ("Deployed · v1.1") | A new entry |

Four more, found while reading the code and Vercel's docs:

| # | Decision | Recommended | Alternative |
|---|---|---|---|
| 8 | A second guard on the branch | The `ignoreCommand` also skips any build whose branch is not `live` (`VERCEL_GIT_COMMIT_REF`). Vercel matches `deploymentEnabled` keys with minimatch, where `*` does not cross a `/`, so a branch such as `fix/x` would match no rule and fall back to deploying. The docs do not say otherwise either way; this guard makes it not matter | `deploymentEnabled` alone, as WORK-08 |
| 9 | Node on the runner | 26, matching the Vercel project's Node setting (26.x, seen 6 Nov 2026), with `actions/checkout@v5` and `actions/setup-node@v5`. Node 20 passed end of life in April 2026; the Mac runs 24.18 for the offline tests | 20, as WORK-08 |
| 10 | Where the catch-up starts | A fixed first day, `2026-10-31` (the demo's first record), and never more than 35 days back, so no file is written for a day before the demo existed. A dispatch writes finished days only; today's partial day is no longer written | 35 days back only, which would write 26 empty files for October; or keep writing today on dispatch |
| 11 | How the key scan reads | It looks for the Redis commands as code uses them (`.keys(` other than `Object.keys(`, `.scan(`, `.flushdb(`, `.flushall(`, the quoted names `"KEYS"`, `"SCAN"`, `"FLUSHDB"`, `"FLUSHALL"`) and for `mt:` anywhere, in `.js`, `.mjs`, `.json` and `.yml` files. A bare-word scan for `KEYS` would hit `export const KEYS` in `lib/limits.js`, the export test 1 below reads | Rename the export and scan bare words |

## 2. The workflow, `.github/workflows/cases.yml`

Runs on every push to any branch (`paths-ignore: results/**`) and on dispatch. Concurrency per ref, never cancelled. Commits and pushes made with the workflow's own token start no new run.

| Step | Key | Who or what does it | What runs | What can stop it |
|---|---|---|---|---|
| 1. Tests with no key | none | GitHub runner | `npm ci` at the root and in `demo/`; root `npm run mock`; `demo/` `npm run check -- --mock`; `demo/` `npm test` (the four tests in section 6); `next build` in `demo/` | any failure: the run is red, nothing below runs |
| 2. The 28 cases | `ANTHROPIC_API_KEY`, workspace `data-answers-ci` | `node demo/scripts/ci.js` | The 28 cases through `demo/lib/answer.js` on the smallest model; the two fixed answers sent as a new question would; the batch loaded before S02; marked by `eval/check.js` against the bar in `harness.json`; every miss printed by case and line; one whole rerun before red | the bar not met on the pass and again on the rerun (exit 1); no key, or the workspace limit reached (the calls fail, so red) |
| 3. Keep the record | the workflow's own token | on `main` only, green or red | record to `results/ci/`, commit `[ci] 28 cases for <sha7>: green` or `red`, `git pull --rebase origin main`, push | a step-2 crash before a record exists (nothing to keep) |
| 4. Move `live` | the workflow's own token | on `main` and green only | `git push origin "$GITHUB_SHA:refs/heads/live"`: the commit that passed, not the record commit | any red or failed step above; any branch other than `main`; measure mode |
| 5. Ask Vercel to build `live` | `VERCEL_DEPLOY_HOOK` | on `main` and green only, under step 4's own condition | `curl -fsS -X POST` to the deploy hook for `live`; the build rule in `vercel.json` still decides whether anything builds | no secret, or the hook refused: the run fails with the reason, `live` has moved, and production keeps serving its current deployment until the next call |

**Measure mode.** Dispatch inputs `measure` (passes, default `0`) and `effort` (blank, `low`, `medium`, `high`, `xhigh`, `max`). With `measure` above 0: N passes, no gate, no rerun, a per-case tally (`A01 5 of 5 matched` and so on) and the count of passes that met the bar; the record goes to `results/ci-measure/` on `main`; step 4 never runs. `effort` without `measure` is refused. A mock pass is never recorded.

**`demo/scripts/ci.js`.** Built from `check-demo.js`, which stays as it is for Terminal use.

| Form | Does |
|---|---|
| `node demo/scripts/ci.js --mock` | the scripted stand-in; proves the path; records nothing |
| `node demo/scripts/ci.js` | the gate on the smallest model at the service's settings |
| `... --record results/ci` | as above and writes the record (the workflow does this on `main`) |
| `... --measure 5 [--effort high] [--record results/ci-measure]` | measure mode |
| `... --mock --plant A01,A02,A03` | the stand-in with those cases made to miss, to show red offline; refused without `--mock` |

Exit 0 on green (and always in measure mode), 1 on red, 2 on a refused form. Each pass runs on a fresh temporary data folder. The record, named `C<UTC minute>-<sha7>.json` (`M...-<effort>` for measure), holds: label, start time, commit, ref, the workflow run's link, trigger, mode, model, effort, limits, bar, green, and per pass the run id, model calls, questions at a limit, tokens, cost, verdict and every case, as `check-demo.js` writes today.

**Effort.** `answer()` in `demo/lib/answer.js` gains an optional `effort`. When unset, the request to the model is exactly today's. When set, it adds `output_config: { effort }`, as `hosted/lib/runner.js` does. The route never passes it; only `ci.js --measure` does. `MODEL` and `LIMITS` are unchanged.

**The record, `.github/workflows/demo-record.yml`.** The hourly alert lines stay as they are. The daily step becomes a catch-up on every run: list each UTC day from the later of `2026-10-31` and 35 days ago up to yesterday that has no `results/demo-<day>.json`, read each from `/api/stats?day=`, one file per day, one commit, `git pull --rebase` before the push (the `[ci]` record can land on `main` in between). The day list comes from a small script, `demo/scripts/missing-days.js`, so it can be tested. The first run backfills 1 to 4 Nov. The counters live 40 days in Redis, so those days can still be read.

**Weekly rerun.** cron-job.org calls the `cases` dispatch endpoint for `main` every Sunday at 9:41 AM Kuala Lumpur time (01:41 UTC Sunday); the scorecard's run is at 9:17 AM. A second job dispatches `demo record` daily at 8:23 AM (00:23 UTC), behind GitHub's own schedule. One fine-grained token serves both.

## 3. Vercel, `demo/vercel.json`

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": { "deploymentEnabled": { "*": false, "live": true } },
  "ignoreCommand": "[ \"$VERCEL_GIT_COMMIT_REF\" = live ] || exit 0; [ -n \"$VERCEL_GIT_PREVIOUS_SHA\" ] || exit 1; git diff --quiet \"$VERCEL_GIT_PREVIOUS_SHA\" HEAD -- . ../lib ../metrics.json ../skill ../data/orders.csv ../eval/prices.json && exit 0 || exit 1"
}
```

Checked against Vercel's docs on 6 Nov 2026:

- `git.deploymentEnabled` is the current key (`github.enabled` is the deprecated one). Keys use minimatch; "if a branch matches multiple rules and at least one rule is `true`, a deployment will occur", so `live` builds and every branch without a `/` does not. Decision 8 covers the rest.
- `VERCEL_GIT_PREVIOUS_SHA` is "the git SHA of the last successful deployment for the project and branch", empty on a branch's first deployment, and exposed only when an Ignored Build Step is set. It replaces `HEAD^`: `live` can move several commits at once, and `HEAD^` would skip a build whose demo change sits in an earlier commit.
- Exit 0 skips the build; 1 builds. Vercel clones 10 commits deep, so an older previous SHA makes `git diff` fail; `&& exit 0 || exit 1` turns every failure, and the empty variable on the first `live` build, into a build. That is the safe side.
- The variables reach the command only when the project's "Enable access to System Environment Variables" box is on (Vercel's older name: "Automatically expose System Environment Variables"). If it were off, the branch guard would skip every build and production would keep serving its current deployment, which is safe but would stall. Megat looks at that box in step 3; it is not changed.

The path list is the one the file has today, unchanged.

## 4. The branch change, in order

1. `git fetch origin`. Fast-forward local `main` to `origin/main` (`ffc2727`; it is one record commit behind). Create the local branch `gate` from it.
2. Merge `origin/demo` into `gate` with a merge commit (`--no-ff`), so `ee443df`, the commit production serves today, is inside every later `live`. The merge is clean: since their common commit `a22196c`, `demo` changes only `demo/app/layout.js`, which `main` never touched.
3. The build commits on `gate` (step 2 of the brief), local only. The first adds `GATE-BRIEF.md` to `.gitignore`.
4. Megat's setup, one item at a time (section 5). Then one of two orders, depending on whether Vercel accepts `live` as the production branch before the branch exists.

   **Order A, Vercel accepts `live` now.**
   1. Megat moves production from `demo` to `live`. Production keeps serving the current deployment until `live` first builds.
   2. On "push": `git push origin gate:main`. The run on `main` goes green, `live` is created at that commit, and Vercel builds it as production (first `live` deployment, so the previous SHA is empty and it builds).
   3. Check by effect: the production deployment's branch is `live`, `/api/stats` answers, the header shows the name mark and the Back link, a preset answers.

   **Order B, Vercel refuses `live` until it exists.**
   1. Production stays on `demo` for now.
   2. On "push": `git push origin gate:main`. `main`'s own `vercel.json` turns off its deployment, so nothing changes for visitors. The run goes green and creates `live`; Vercel builds it as a preview (`live` is allowed, and production still tracks `demo`).
   3. Megat moves production from `demo` to `live`, then promotes that `live` deployment to production in Vercel. If Vercel rebuilds it on promotion with the production settings, that build is the one checked.
   4. Check by effect, as in A3.

   **Taken: Order B.** On 6 Nov 2026 Vercel refused `live` with the message: Branch "live" not found in the connected Git repository; production stayed on `demo` until the first green run created `live`.

   **What happened.** Run 42215955939 on `8d90b30` went green (20 of 20, 6 of 6, state 2 of 2, US$0.0401, no rerun), committed its record and created `live`. Vercel made no deployment for `live` at all, not even a cancelled one. Vercel's docs do not say why; the likely causes are the pusher (the workflow's own token) or a commit Vercel had already received on `main`, where deployments are off. Megat moved production to `live` (it saved once the branch existed) and created a deployment of `live` from the dashboard. It built `8d90b30` as production; checked by effect the same day: Vercel's status on the commit, `/api/stats`, the name mark and the Back link, the first preset's full block. Step 5 of the workflow (section 2), the deploy hook, makes every later green run reach Vercel without a hand. On the second run (42221039703, `2580834`, green, US$0.0398) Vercel built `live` twice, both as production: once from the push that moved the existing branch, once from the hook, which is the one serving. So the miss on the first run was most likely `live` being created at a commit Vercel had already received on `main`. The hook stays as the safety net; the cost is one extra build of about 15 seconds on a green run that changes the demo.

   In either order, if the run is red, `live` does not exist or does not move, production is untouched, and the misses are reported by case and line.
5. **The push to `main` is never forced.** If `git push origin gate:main` is rejected because `origin/main` moved (a `[ci]` or daily record commit, say), Claude Code fetches, merges the new `origin/main` into `gate` (no rebase, no force), reruns every offline test in section 6, shows the results, and asks Megat before pushing again.
   The Root Directory switch "Skip deployment" (skip when nothing changed) is on and is left alone: Vercel applies it only to monorepos with declared workspaces, and this repo declares none, so the `ignoreCommand` decides every build.
6. `demo` is frozen from step 2: no more pushes. Deleting it waits for Megat's word after `live` has served a day.
7. Nobody pushes `live` by hand, Claude Code included. Only step 4 of the workflow moves it.

## 5. Secrets and settings

Each is Megat's to create or change. Each is checked by its effect (a run starts, a route answers), never by seeing it.

| Name | What it is | Where it lives | Created by | Expires |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | key `github-actions` in Console workspace `data-answers-ci`, US$5 monthly limit | GitHub, `mjazzly/data-answers`, Settings, Secrets and variables, Actions, repository secret | Megat | 90 days from creation (about 5 Feb 2027 if made on 7 Nov). After that CI goes red and `live` stops moving; production keeps serving |
| `data-answers-actions` | fine-grained token: Actions read and write on `mjazzly/data-answers` only | cron-job.org only, in the two jobs' Authorization header | Megat | 90 days from creation |
| `DEMO_URL` | `https://data-answers.vercel.app` | GitHub repository variable, exists | unchanged | never |
| Production branch | `demo` to `live` | Vercel, project `data-answers`, Settings, Environments, Production, Branch Tracking | Megat | never |
| System environment variables | "Enable access to System Environment Variables" | Vercel project settings | Megat looks; ticked; not changed | never |
| `VERCEL_DEPLOY_HOOK` | the URL of a Vercel deploy hook for branch `live`; anyone holding it can start a build, so it is kept as a secret | made in Vercel, project `data-answers`, Settings, Git, Deploy Hooks; kept in GitHub as a repository secret | Megat | never; delete the hook in Vercel to revoke it |
| The workflow's own token | `contents: write`, given per run | GitHub, built in | none | each run |

The demo's own Vercel settings (its key, `IP_SALT`, the caps, Upstash) are unchanged. CI never connects to Upstash: no `UPSTASH_*` or `KV_*` variable is set in either workflow, and test 1 checks that.

## 6. Tests with no key, and what each must show

Written before any code. Every one runs offline in step 2 and again in step 1 of the workflow.

**Test 1, `demo/test/keys.js`, the key guard.** `store()` in `demo/lib/limits.js` returns a thin wrapper over the Upstash client (and the in-memory stand-in) that throws on any key not starting with `da:`, so a wrong key fails shut.

| Check | Expected |
|---|---|
| Every entry in `KEYS`, called with sample arguments | 7 of 7 return a key starting with `da:` |
| The wrapper over a fake client, for `get`, `set`, `incr`, `incrby`, `decr`, `del`, `expire` with `mt:x`, and with the bare key `x` | every call throws; the fake client records zero calls |
| `mget("da:a", "mt:x")` | throws; zero calls |
| The same calls with `da:` keys | pass through to the fake client unchanged |
| The scan of decision 11 over `demo/` (outside `node_modules/`, `.next/`, `core/`, `test/`) and both workflow files | zero hits |
| `CI` set (GitHub sets it): any environment variable named `UPSTASH_*` or `KV_*`; and those strings in `cases.yml` | none; none |

A refused key inside `claim()` throws before any model call, so the route answers an error and spends nothing.

**Test 2, `demo/test/presets.js`, the presets still match the code.** Each block in `presets.json` was recorded once and is served without the model. The test reruns each one's tool call through the code as it stands, on a fresh copy of the table.

| Preset | Rerun | Expected |
|---|---|---|
| P01 Returns rate by branch, Q3 2025 | `run_metric` returns_rate by branch, 2025-Q3 | metric, definition, period, filters, dimensions, data version, rows computed over, and all 8 rows equal |
| P02 Average order value, March 2025 | `run_metric` average_order_value, 2025-03 | value 261.22 and the same fields equal |
| P03 Which branch grew most, H1 to H2 | `compare_periods` revenue by branch, H1 to H2 2025 | 8 rows, ranking and changes equal |
| P04 Share of revenue by branch, 2025 | `run_metric` revenue_share by branch, 2025 | 8 rows equal |
| P05 Harbor branch revenue, May 2025 | `run_metric` revenue, branch Harbour, 2025-05 | value 13266.20 and the correction note equal. The rerun uses the spelling the note says the call used ("Harbor"), so the typo gate is checked too |
| P06 Profit margin by branch | `run_metric` profit_margin by branch, 2025 | refused at G1, `undefined_metric`, same nearest metric and message |
| P07 Returns rate last quarter | `run_metric` returns_rate, "last quarter" | stopped at G2, `ambiguous_period`, same message and period forms |
| P08 Revenue in January 2026, roughly | `stop` with reason `estimate` | G6, `estimate`; the recorded message equals the page's fixed line for it |

Then a self-check: one copy of P02 with its value changed by 0.01 must be reported stale, by preset and field. Expected: 8 of 8 match, the planted copy reported, exit 0. A metric change that would leave a preset stale turns the run red.

**Test 3, `demo/test/vercel.js`, the build rule.** Reads `demo/vercel.json` and runs its `ignoreCommand` in a throwaway git repository with set variables; then reads `cases.yml` for the deploy hook.

| Case | Expected exit |
|---|---|
| `deploymentEnabled` is `{ "*": false, "live": true }` | as written |
| branch `main` | 0, skipped |
| branch `fix/x` | 0, skipped |
| branch `live`, previous SHA empty | 1, builds |
| branch `live`, previous SHA not in the clone | 1, builds |
| branch `live`, only `results/` changed since the previous SHA | 0, skipped |
| branch `live`, a `demo/` change two commits back and only `results/` in the last commit | 1, builds (the case `HEAD^` got wrong) |
| branch `live`, a change in `../lib` | 1, builds |
| `cases.yml`: the step "Ask Vercel to build live" | directly after "Move live to the commit that passed" |
| `cases.yml`: that step's condition | the same as the move's, `success() && github.ref == 'refs/heads/main' && env.MEASURE == '0'` (a planted `always()` fails it) |
| `cases.yml`: the hook | from `secrets.VERCEL_DEPLOY_HOOK` only; no hook URL written in the file |

**Test 4, `demo/test/record.js`, the catch-up day list.** `missing-days.js` with a folder of record files and a set "today".

| Files present | Today (UTC) | Expected days |
|---|---|---|
| 10-31, 11-05 | 2026-11-07 | 11-01, 11-02, 11-03, 11-04, 11-06 |
| 10-31 to 11-06 | 2026-11-07 | none |
| none | 2026-10-31 | none (nothing before the first day, nothing for today) |
| 10-31 only | 2026-12-20 | 11-15 to 12-19 (35 days back, the floor) |

**The scripts, run offline.**

| Command | Expected |
|---|---|
| root `npm run mock` | bar met, as today |
| `demo/` `npm run check -- --mock` | 20 of 20, 6 of 6, state 2 of 2, BAR MET, exit 0, as today |
| `demo/` `npm test` | tests 1 to 4 pass, exit 0 |
| `demo/` `next build` | completes |
| `ci.js --mock` | one pass, GREEN, exit 0, no record written |
| `ci.js --mock --plant A03` | A03 missed with its lines, 19 of 20, bar met, GREEN, exit 0: the bar allows two answered misses. (This row was "RED" before the build; the run corrected it.) |
| `ci.js --mock --plant A01,A02,A03` | 17 of 20 and both state cases missed (they compare with A01 and A02), the whole pass rerun, misses again, RED, exit 1 |
| `ci.js --mock --plant R01` | R01 answered where it should be refused, 5 of 6 refusals, rerun, RED, exit 1 |
| `ci.js --mock --measure 2` | per-case tally, 2 of 2 for every case, no gate, exit 0 |
| `ci.js --mock --record results/ci` | refused, exit 2 |
| `ci.js --effort high` | refused (effort is for measure only), exit 2 |
| `ci.js` with no key | refused with a line naming the `data-answers-ci` key, exit 2 |

Step 6 of the brief plants a miss for the real model on the branch `ci-red-check` (proposed: `LIMITS.maxCalls` set to 1 on that branch only, so cases stop at the call limit). That run must be red and `live` must not move.

## 7. Cost

One gate pass on the demo path cost US$0.0407 on 31 Oct (run `D202610312308-4aad`, 84 model calls, local `eval/runs-demo/`, not committed). A rerun doubles it.

| Use | Passes | About |
|---|---|---|
| A green push | 1 | US$0.04 |
| A red push (pass and rerun) | 2 | US$0.08 |
| A month: about 10 pushes and 4 or 5 weekly runs | 15 | US$0.60; US$1.20 if every run reran |
| Measure, default effort | 5 | US$0.20 |
| Measure, high effort | 5 | more output tokens; estimated US$0.30 to 0.40, read from its record |
| The red check | 2 | US$0.08 |

All inside the workspace's US$5 a month. If the limit is reached, the calls fail, the run is red and nothing goes live.

## 8. What this build does not touch

- Metrics, the skill, the cases, the expected answers, `harness.json`, `eval/check.js`, `check-demo.js`. The build stays v1.1; the demo package moves to 1.2.0.
- `MODEL` and `LIMITS` in `demo/lib/answer.js`.
- The shared Upstash database: `da:` keys only; no `mt:` key, no key listing, no `FLUSHDB` or `FLUSHALL`, no database setting. CI never connects to it.
- `~/Code/meeting-tracker-server` and `mjazzly/meeting-tracker-assistant`: read for the pattern, nothing written, no git commands.
- The site, until step 8 and Megat's word.
- Published history. Commits are made as Megat Jazly, `76079998+mjazzly@users.noreply.github.com` (checked: that is what `git config user.email` shows here).
