# Tested tables: the design note

Today `data/orders.csv` comes straight from the generator and the metrics trust it. This build puts
tested tables between a raw export and the table the metrics read. A **model** here is one SQL query
that builds one table; a **test** is a query that must return nothing, run on every build. dbt runs
both in order and stops the build when a test fails.

The proof is exact: the raw export carries five kinds of mess, and the models must rebuild today's
`data/orders.csv` (4,948 rows) and `data/batch_2.csv` (30 rows) byte for byte. Those two files are the
expected result and are never edited to fit a model.

## 1. Decisions (recommendation first)

| # | Decision | Recommended | Alternative |
|---|---|---|---|
| 1 | The engine | **dbt Core 1.12.6 with dbt-duckdb 1.11.1**, pinned in `transform/requirements.txt`, run from `transform/.venv` on Python 3.12. See the reasons below the table. | dbt v2's open source build, `dbt-oss`, once its docs confirm the three points below. |
| 2 | How the AI reads the models | **The export to the two CSVs, byte for byte**; `lib/store.js` and the demo unchanged. | `lib/store.js` opens the dbt warehouse: dbt on Vercel or a binary file in git, and two DuckDB versions on one file. |
| 3 | The mess | **The five kinds in section 2.** | A clean raw export, which passes every test and proves nothing. |
| 4 | How raw lands | **Seeds**, all text; the README says a real project lands raw tables with a loader. | Sources read with `read_csv`. |
| 5 | The vocabulary | **`metrics.json` stays the source**; `test/vocab.js` checks the dbt project against it. | Generate the yml from `metrics.json` on every build. |
| 6 | The answer block | **Unchanged**, so the 28 expected blocks and the scorecard's pin stay valid. | `describe_data` names the build and its test count: a new tool output and a new expected set. |
| 7 | Version | **v1.2**: root `package.json` 1.1.1 to 1.2.0 in the build commit; the WORK-03 pill reads "Deployed · v1.2" only after the first green gate run on `main`. The demo's own 1.2.1 is not touched. | Stay v1.1, since every answer is unchanged. |
| 8 | The site | **One "The table under it" line on WORK-03**, linking `transform/models/` and the tests, and one step "Rows checked" at the start of the WORK-03 swimlane. | A new entry. |
| 9 | Where this note lives | **`transform/DESIGN.md`**, beside the models. | The repo root. |
| 10 | The CSV writer (added) | **Move the generator's `q` and `csv` into `scripts/csv.js`**; `make_data.js` and `export_mart.js` both import it. `make_data.js` is rerun once to show its three outputs unchanged. `scripts/` is outside the Vercel build rule, so no demo build. | Copy the three lines into `export_mart.js` and rely on the byte check alone. |
| 11 | Where the export writes (added) | **`transform/target/export/`, then `cmp` against `data/`.** The models never write into `data/`, so the expected result cannot be overwritten, even by a broken local run. | Write over `data/*.csv` and check with `git diff --exit-code`, as the brief has it. Same proof, but a wrong model leaves a changed CSV in the working tree. |
| 12 | The record's `models` field (added) | **A root script, `scripts/record_models.js`, adds it** to the record `demo/scripts/ci.js` just wrote, in its own workflow step. `demo/` stays unchanged (rule 8). | `ci.js` reads the dbt results itself, which changes the demo. |
| 13 | Unknown text values (added) | **Normalised by rule, not by a list**: trim, fold inner spaces, then title case for category (`Garment Care`) and first letter capital for channel (`In store`). The accepted values tests catch anything that does not land on a `metrics.json` value, so no third copy of the vocabulary sits in SQL. | A mapping table of every spelling, which is one more list to keep in step. |

**Why decision 1 falls back to dbt Core.** The brief takes `dbt-oss` only if its docs confirm the
DuckDB adapter, unit tests and typed seeds. Read on docs.getdbt.com:

- `dbt-oss` exists: Apache 2.0, installed with `uv tool install dbt-oss`, separate from the
  proprietary `dbt` package. Unit tests and `dbt build` are documented for v2.
- **The DuckDB adapter: not confirmed for the open source build.** The DuckDB setup page says the
  adapter is built into v2, but the `dbt-oss` page only points to the repository for adapters.
- **Typed seeds: not confirmed.** `column_types` is documented generically, with no word on v2 or DuckDB.
- **And a blocker for the hand-off:** the DuckDB page says v2's bundled driver cannot load DuckDB
  extensions, and names `parquet` among them. The Parquet hand-off depends on it.
- No exact `dbt-oss` version could be read (its PyPI page refused the fetch), and no version pin is
  documented for it.

So two of the three are unconfirmed and the hand-off is at risk: dbt Core 1.x. dbt-core 1.12.6 is the
latest stable (Apache 2.0, Python 3.10 or later); dbt-duckdb 1.11.1 is the latest adapter, and its own
test suite runs dbt's unit test cases. Typed seeds on dbt-duckdb are still to be proven: the first
`dbt seed` in step 3 checks that every raw column lands as text, and stops if it does not.

`transform/requirements.in` names the three pins (`dbt-core==1.12.6`, `dbt-duckdb==1.11.1`, and the
exact `duckdb` 1.5 release on PyPI closest to the 1.5.6 that `@duckdb/node-api` is built on);
`transform/requirements.txt` is the full lock, written by `uv pip compile --universal`, so the lock made
on the Mac also installs on GitHub's Linux runner. Never the proprietary build. dbt-core 1.12.6 also
pulls in `dbt-core-experimental-parser` 2.0.11, whose package metadata gives its licence as Apache 2.0.

## 2. The raw export: `scripts/make_raw.js`

Seeded, reads `data/orders.csv` and `data/batch_2.csv`, writes `transform/seeds/raw/raw_orders.csv`
and `transform/seeds/raw/raw_returns.csv`. The counts below are constants in the script; the seed picks which rows.
Step 2 prints them and five raw rows beside the clean rows they must become.

**What the clean files hold** (counted from them):

| | Batch 1 (`orders.csv`) | Batch 2 (`batch_2.csv`) | Both |
|---|---|---|---|
| Orders | 4,948 | 30 | 4,978 |
| Returned orders | 413 | 3 | 416 |
| Order values of 1,000 or more | 92 | 1 | 93 |
| Total order value | 1,297,884.00 | 8,364.60 | 1,306,248.60 |

**The raw columns.** `raw_orders`: `order_id, branch_code, ordered_at, category, channel,
order_value, export_batch`. `raw_returns`: `return_id, order_id, returned_at, export_batch`. No
`branch`, `order_date`, `month`, `quarter` or `returned`: each is derived in staging. All columns land
as text. `branch_codes` (`code, branch`) is a fixed reference seed in `transform/seeds/`, not part of
the export.

**The five kinds of mess.**

| # | Mess | Count | Staging does | What fails the build |
|---|---|---|---|---|
| 1 | Returns arrive as a separate file of return events, some logged twice | 416 returned orders, **24 logged twice** (23 in batch 1, 1 in batch 2): **440 event rows** (436 in batch 1, 4 in batch 2). A repeat has a new `return_id` and a later `returned_at`. | Keeps one row per `order_id`; `returned` is derived by joining. | A return pointing at no order; a batch 2 return pointing at a batch 1 order. |
| 2 | Branch arrives as a code | **Every row**: `BR-01` Central, `BR-02` Harbour, `BR-03` Riverside, `BR-04` Hillside, `BR-05` Old Town, `BR-06` Westgate, `BR-07` Northpoint, `BR-08` Airport (the `metrics.json` order). Unknown codes: **0**. | Joins `branch_codes`. | An unknown code (relationships test). |
| 3 | Order time arrives as a text timestamp | **Every row**, a seeded time of day from `08:00:00` to `21:59:59` on the order's date. | Derives `order_date`, `month`, `quarter`; none is supplied. | A timestamp that will not cast (build error). |
| 4 | The export overlaps itself | **62 orders repeated as identical rows** (60 in batch 1, 2 in batch 2), each repeat inside its own batch: **5,040 raw order rows** (5,008 in batch 1, 32 in batch 2). Repeats with different values: **0**. | Keeps one row of each identical set, compared after cleaning. | An `order_id` that repeats with different values: both rows survive staging and the unique test turns red, so no row is picked silently. The same id in two batches counts as different values. |
| 5 | Text arrives inconsistent | Category respelt in **500 orders** (495 in batch 1, 5 in batch 2) from `garment care`, `GARMENT CARE`, ` Kitchen `, `Personal  Care`; channel respelt in **500 orders** (495, 5) from `online`, `ONLINE`, ` In Store `, `in store `, `phone `. Of the respelt values in each column, **202 carry a leading or trailing space** (200 in batch 1, 2 in batch 2); S7 checks the raw table still holds them. Order value: **all 93 values of 1,000 or more** carry a thousands separator (`1,250.00`). | Trims, folds spaces, cases by rule (decision 13), strips the separator, casts to `DECIMAL(12,2)`. | A value that lands off the `metrics.json` list (accepted values); an amount that will not cast. |

A repeated row in mess 4 copies its raw line exactly, mess 5 spellings included.

**The late returns limit.** Returns for batch 2 orders sit in batch 2 only. `load_batch.js` appends
rows and never updates an earlier one, so a late return for a batch 1 order could not be shown. The
test S1 below makes that limit visible rather than hiding it, and the README says so.

## 3. The layers

| Step across | Tables | Done by | What can stop it |
|---|---|---|---|
| Clean files to raw export | `transform/seeds/raw/raw_orders.csv`, `raw_returns.csv` | `scripts/make_raw.js`, seeded | CI reruns it and `git diff --exit-code -- transform/seeds/raw` stops any hand edit of the export. |
| Raw export to raw tables | seeds `raw_orders`, `raw_returns`, `branch_codes`, all text | `dbt seed` (inside `dbt build`) | A missing file or a column count that does not match. |
| Raw to staging | `stg_orders` (one row per order), `stg_returns` (one row per returned order) | dbt models | A cast that fails; a unit test; an unknown branch code; a conflicting repeat; a return pointing at no order or across batches. |
| Staging to mart | `fct_orders`: the columns, types and order of `data/orders.csv`, plus `export_batch` | dbt model; a post-hook copies it to `transform/target/fct_orders.parquet` | Any red test upstream skips it; then its own tests. |
| Mart to the two CSVs | `transform/target/export/orders.csv`, `batch_2.csv` | `scripts/export_mart.js` (`@duckdb/node-api`, already a dependency; the shared writer of decision 10) | It refuses unless `transform/target/run_results.json` shows every node passed, so a test that fails after the post-hook ran still exports nothing. `cmp` against `data/` stops any byte that differs. |
| Vocabulary check | the dbt project against `metrics.json` | `test/vocab.js` | Any value added, dropped or respelt. |
| CSVs to the 28 cases | unchanged | `cases.yml` step 2 onwards | Unchanged. |

The warehouse file `transform/target/warehouse.duckdb` is opened only by dbt's DuckDB. Parquet is the
hand-off, so no second DuckDB version ever opens it.

## 4. Every test, with its expected outcome

Expected outcome on the raw export is written before any code. 37 dbt tests in all: 7 unit tests and
30 data tests. Then 3 checks with no key, and 3 planted checks run locally.

**Unit tests** (dbt `unit_tests`, fixed input rows, expected output rows)

| Id | Model | Given | Expected |
|---|---|---|---|
| U1 | `stg_orders` | one order in two identical rows | one row; passes |
| U2 | `stg_orders` | one `order_id` in two rows with different values | both rows kept, so G1 would turn red; passes |
| U3 | `stg_orders` | channel ` In Store `, `in store`, `IN STORE`; category ` garment  care` | `In store` three times; `Garment Care`; passes |
| U4 | `stg_orders` | order value `1,250.00` and `75.00` | 1250.00 and 75.00 as `DECIMAL(12,2)`; passes |
| U5 | `stg_orders` | `2025-03-04 15:22:10` and `2025-12-31 21:59:59` | `2025-03-04`, `2025-03`, `2025-Q1`; `2025-12-31`, `2025-12`, `2025-Q4`; passes |
| U6 | `stg_returns` | one order with two return events | one row; passes |
| U7 | `fct_orders` | two orders, one with a return event | `returned` true for that one, false for the other; passes |

**Generic data tests**

| Id | Table | Test | Expected |
|---|---|---|---|
| G1, G2 | `stg_orders` | `order_id` unique, not null | pass |
| G3 | `stg_orders` | `branch_code` in `branch_codes.code` (relationships) | pass |
| G4, G5 | `branch_codes` | `code` unique, `branch` unique | pass |
| G6 | `stg_returns` | `order_id` unique | pass |
| G7 | `stg_returns` | `order_id` in `stg_orders` (relationships) | pass |
| G8 | `fct_orders` | `order_id` unique | pass |
| G9 to G18 | `fct_orders` | not null on all ten columns | pass |
| G19 to G23 | `fct_orders` | accepted values for `branch`, `category`, `channel`, `month`, `quarter` | pass |

**Singular data tests** (`transform/tests/`, each returns the rows that break it)

| Id | Test | Expected |
|---|---|---|
| S1 | every return sits in its order's batch: no batch 2 return points at a batch 1 order | pass (returns nothing) |
| S2 | `order_value` above 0 (singular, since dbt packages are kept out) | pass |
| S3 | `month` is the year and month of `order_date`; `quarter` is its quarter | pass |
| S4 | rows in `fct_orders` equal the distinct raw order ids: 4,948 in batch 1, 30 in batch 2 | pass |
| S5 | total order value equals the raw total after repeats are removed: 1,306,248.60 | pass |
| S6 | returned orders equal the distinct order ids in the return events: 416 | pass |
| S7 | the raw seed still holds its edge spaces: category and channel values with a leading or trailing space, over the distinct raw rows, equal `raw_edge_spaced` in `dbt_project.yml` (202 each), the sum of `edgeSpaced` in `make_raw.js`. A loader that strips them turns the build red. | pass |

**Checks with no key** (Node, after `dbt build`)

| Id | Check | Expected |
|---|---|---|
| N1 | `node scripts/make_raw.js`, then `git diff --exit-code -- transform/seeds/raw` | no difference |
| N2 | `node test/vocab.js`: the accepted values in `transform/target/manifest.json` (what dbt actually ran, so no yaml parser is added) and the names in `branch_codes.csv` equal the values in `metrics.json` | pass |
| N3 | `node scripts/export_mart.js`, then `cmp` of each exported CSV against `data/orders.csv` and `data/batch_2.csv` | no difference |

**Planted, local only** (and P1 again on the branch `ci-red-models` in step 5)

| Id | Planted | Expected |
|---|---|---|
| P1 | one raw order row with code `BR-09` | red at G3; `fct_orders` skipped; the export refuses; `data/` untouched |
| P2 | one raw order repeated with a different order value | red at G1; `fct_orders` skipped; the export refuses; `data/` untouched |
| P3 | the raw export with every edge space stripped, as a loader that trims would leave it | red at S7; the export refuses; `data/` untouched |

## 5. The CI change (`.github/workflows/cases.yml`)

One new step before "Tests with no key", and one after the cases step. Everything else is unchanged:
step 2 onwards, the record, `live` moving only on green from `main`. None of it needs a key, and dbt
never connects to Upstash.

```yaml
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
          cache-dependency-path: transform/requirements.txt
      - run: pip install -r transform/requirements.txt
      - name: Tested tables with no key
        run: |
          node scripts/make_raw.js
          git diff --exit-code -- transform/seeds/raw
          dbt build --project-dir transform --profiles-dir transform
          node scripts/export_mart.js
          cmp data/orders.csv transform/target/export/orders.csv
          cmp data/batch_2.csv transform/target/export/batch_2.csv
          node test/vocab.js
```

The runner installs from the same `transform/requirements.txt` the Mac uses. It installs there because
the lock is compiled with `uv pip compile --universal`, which resolves for every platform rather than
only the Mac's.

After "The twenty-eight cases on the smallest model" and before "Keep the record", with the same
condition as "Keep the record", so the `models` field is in the record that step commits:

```yaml
      - name: Add the tested tables to the record
        if: always() && github.ref == 'refs/heads/main' && (steps.cases.outcome == 'success' || steps.cases.outcome == 'failure')
        run: node scripts/record_models.js "$([ "$MEASURE" != "0" ] && echo results/ci-measure || echo results/ci)"
```

The record gains `"models": { "dbt": "1.12.6", "adapter": "dbt-duckdb 1.11.1", "tests_run": 37,
"tests_passed": 37 }`, read from `run_results.json`. The workflow's header comment gains one line for
the new step. A red tested table stops the run before the paid pass starts.

**Vercel.** Nothing changes. dbt never runs there, and `demo/vercel.json` builds only when a demo path
or `data/orders.csv` changes; `transform/` and `scripts/` are neither.

## 6. Files

**Added**

- `transform/DESIGN.md` (this note)
- `transform/dbt_project.yml`; `transform/profiles.yml` (DuckDB at `target/warehouse.duckdb`, no secret)
- `transform/requirements.in`, `transform/requirements.txt`
- `transform/seeds/branch_codes.csv`, `transform/seeds/_seeds.yml` (every raw column typed as text;
  `seed-paths` is the default `["seeds"]`, which takes in `seeds/raw/`. The raw export lives inside
  the project because dbt's docs say only that seed paths "must be relative to the location of your
  `dbt_project.yml` file" and never that a path may leave the project folder.)
- `transform/models/staging/stg_orders.sql`, `stg_returns.sql`, `_staging.yml` (tests U1 to U6, G1 to G7)
- `transform/models/mart/fct_orders.sql`, `_mart.yml` (U7, G8 to G23, the Parquet post-hook)
- `transform/macros/clean_text.sql` (trim, fold spaces, the two casing rules, the amount parse)
- `transform/tests/` S1 to S7, one `.sql` file each
- `transform/seeds/raw/raw_orders.csv`, `transform/seeds/raw/raw_returns.csv`
- `scripts/make_raw.js`, `scripts/export_mart.js`, `scripts/csv.js`, `scripts/record_models.js`
- `test/vocab.js`

**Changed**

- `scripts/make_data.js`: imports `q` and `csv` from `scripts/csv.js`; its three outputs stay byte for byte
- `.github/workflows/cases.yml`: section 5
- `.gitignore`: `transform/target/`, `transform/logs/`, `transform/dbt_packages/`, `transform/*.duckdb`,
  `transform/.venv/`, `.user.yml`, `PROJECT-D-BRIEF.md`
- `README.md`: the layers, how to rebuild, the late returns limit, and that a real project lands raw
  tables with a loader rather than seeds
- `package.json` and `package-lock.json`: version 1.2.0 (decision 7), and the scripts `raw`, `models`, `export`

**Not changed**: `data/orders.csv`, `data/batch_2.csv`, `metrics.json`, `skill/SKILL.md`, the cases,
`eval/expected/`, `eval/answers.txt`, `harness.json`, `lib/store.js`, everything under `demo/`.

## 7. Local setup (step 3, asked before it runs)

Python 3.12.13 is already installed through uv, so nothing new lands outside the repo except uv's
package cache in `~/.cache/uv`. The commands, shown again for a yes at step 3:

```bash
uv venv --python 3.12 transform/.venv
```

```bash
uv pip compile --universal transform/requirements.in -o transform/requirements.txt
```

```bash
uv pip install --python transform/.venv -r transform/requirements.txt
```

The work branch `tested-tables` starts from `gate`, which after a fetch is exactly `origin/main` plus
`abe7054`, so `abe7054` keeps its own hash rather than being copied by a cherry-pick:

```bash
git fetch origin && git switch -c tested-tables gate
```

**Kept out, on purpose**: a semantic layer (MetricFlow), dbt Cloud, dbt packages, incremental models,
snapshots, dimension tables beyond the branch seed, models shaped for the dashboard, and a hosted dbt
docs site. Each would add weight with nothing for a reader to open.
