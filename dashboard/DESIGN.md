# Dashboard 1: the design note

A Power BI report on `fct_orders`, the tested table, for one reader and one decision: **an operations
lead at the month-end review, choosing which branches need attention next month.** It reads the same
table and the same metric definitions as the data answers assistant, and a recorded agreement check
proves the two give the same numbers.

Written 8 Nov 2026, before any code. Every open point has the recommendation first.

**Approved 8 Nov 2026 as recommended, with two changes:** (1) before any rebuild, `git status` and
`git branch` are run and shown; if the checked out branch is not `main`, nothing is switched or rebuilt
until Megat says so (section 0, point 3); (2) decision 4 stands: `month_axis` is kept and the selected
month is marked on the trend. Also confirmed: batch 1 only, eight measures, `agreement.tsv`, the
14-case check, `C:\repos\data-answers` on the PC.

## 0. Found while reading the repo

1. **Batch 2 is all December.** `fct_orders` holds 4,948 rows in `export_batch` 1 (Jan to Dec 2025)
   and 30 rows in `export_batch` 2, every one of them in 2025-12. The page opens on 2025-12, so the
   data state (section 4) changes the first numbers a reader sees.
2. **The live assistant reads batch 1 only.** `lib/store.js` and the demo load `data/orders.csv`;
   `batch_2.csv` is loaded only by case S02 in the eval. Nineteen of the twenty number cases assume
   4,948 rows.
3. **The last local dbt build did not pass.** `transform/target/run_results.json` (7 Nov, 07:35) shows
   the `relationships` test on `stg_orders.branch_code` failing and 23 nodes skipped, `fct_orders`
   among them. The Parquet file on disk (07:09) is from an earlier, passing build. The hand-off in
   step 2 refuses on this state, as it should. It is probably the bad row demonstration from the red
   check on 7 Nov (branch `ci-red-models`). Before step 2: `git status` and `git branch` are shown,
   and the rebuild (`npm run raw`, then `npm run models`, on the clean raw export) runs only on `main`.
   On 8 Nov the checked out branch was `tested-tables`, so step 2 waits for Megat's word.
4. **Amounts are DECIMAL(12,2) in the Parquet.** Power BI must load `order_value` as **Fixed decimal
   number**, so sums are exact, and Fixed decimal sets a currency format by default, which must be
   replaced (section 6).

## 1. Decisions

| # | Decision | Recommended | Alternative |
|---|---|---|---|
| 1 | Data state | **`export_batch` 1 only**, filtered in Power Query, so the dashboard shows what the live assistant shows and the agreement check compares like with like. | Both batches: December gains 30 rows, the page disagrees with the live assistant, and only S02 could be checked. |
| 2 | Measures in the model | **Eight, named as in `metrics.json`:** the five on the cards (`revenue`, `net_revenue`, `returns_rate`, `average_order_value`, `mom_growth`) and the three their definitions are built from (`orders`, `returns`, `returned_value`). | Only the five: `returns_rate` and `net_revenue` then hide their parts, and three more cases drop out of the check. |
| 3 | Percent measures | **Return a fraction** (0.0782) with format `0.00%`, the Power BI convention; the check multiplies by 100. | Return 7.82 with a literal `%` in the format: reads oddly in DAX and in any later sum. |
| 4 | Marking the selected month on the trend | **A small `month_axis` table** made in Power Query from `fct_orders` (its distinct months, no typed values, no relationship). The trend's axis comes from it, so all twelve months stay on the line while the month slicer still filters the page, and a pale column sits behind the selected month. The eight metric measures never touch it. | Drop the mark: the trend ignores the slicer and shows twelve months with nothing marked. One table, but the reader loses where the month sits. |
| 5 | Branch slicer and the table | **The table ignores the branch slicer** (edit interactions), so all eight branches always rank; cards, trend and the two detail charts follow it (blank = all branches). | The slicer filters the table too, which then shows one row. |
| 6 | Cards | **The new card visual with five callouts**, which keeps them one size by construction. | Five classic cards set to the same width and height. |
| 7 | The agreement result file | **`dashboard/agreement.tsv`**: DAX query view copies results as tab-separated text, so Megat pastes into Notepad and saves; the name says what the file is. | `dashboard/agreement.csv` as the brief has it: same content, but a `.csv` holding tabs. |
| 8 | Where the hand-off logic lives | **Move the six refusal checks out of `scripts/export_mart.js` into `scripts/build_gate.js`**, imported by both `export_mart.js` and a new `scripts/export_dashboard.js`. `export_mart.js` behaves the same; the CI byte check on the two CSVs proves it. | Copy the six checks into the new script: two copies to keep in step. |
| 9 | Guarding the committed Parquet | **`node scripts/export_dashboard.js --check` in CI:** after `dbt build`, the committed `dashboard/data/fct_orders.parquet` must hold exactly the rows of the fresh `fct_orders` (compared as rows through DuckDB, both ways). Parquet bytes carry the writer's version, so rows, not bytes. | No CI guard: the dashboard data can drift from the tested table without anyone seeing. |
| 10 | Version | **No version bump.** The assistant and its answers are unchanged; the dashboard is a new entry, not a new release of WORK-03. | `package.json` 1.3.0. |
| 11 | Report name | **`Branch review`**, the file `dashboard/report/Branch review.pbip`. The name shows in the service and on the Publish to web frame. | `branch_review`, no space in paths. |
| 12 | Clone path on the PC | **`C:\repos\data-answers`.** The path parameter's value is saved in the .pbip text, so a neutral path keeps the Windows user folder out of a public repo. | The default `C:\Users\<name>\...`, which then shows in git. |

## 2. The page, drawn

One report page, 1280 by 720, read top to bottom in the order the decision is made.

```
+------------------------------------------------------------------------------------------+
| Which branches need attention next month?                                                 |
| 2025-12 · All branches                                (subtitle, a measure, follows slicers)|
+------------------------------------------------------------------------------------------+
| Month [ 2025-12 v ]  (single select, default 2025-12)   Branch [ All v ]  (single select)  |
+------------------------------------------------------------------------------------------+
| Revenue       | Net revenue   | Returns rate  | Average order | Month on month growth  |
| 147.6K        | 134.7K        | 7.82%         | 250.98        | 9.98%                  |
+------------------------------------------------------------------------------------------+
| Branches ranked by net revenue                                                           |
| Branch      Net revenue   Returns rate   Month on month growth   Attention              |
| Central       27,517.80        5.88%            20.54%                                     |
| Westgate      26,491.50       11.54%           -10.15%    ● Returns above all branches;   |
|                                                              revenue down on last month   |
| Harbour       21,131.70        7.14%            10.58%                                     |
| ...                                                                                        |
+------------------------------------------------------------------------------------------+
| Revenue by month, 2025                                                                     |
|   line: twelve months  ·  pale marine column behind the selected month                     |
+--------------------------------------------+---------------------------------------------+
| Revenue by category, All branches, 2025-12 | Revenue by channel, All branches, 2025-12   |
|   bars, largest first, one shared scale    |   bars, largest first, one shared scale     |
+--------------------------------------------+---------------------------------------------+
| Amounts are order values in one currency, shown without a symbol. All data is synthetic.  |
+------------------------------------------------------------------------------------------+
```

**The flag rule, in words a non-analyst reads:** *A branch is marked amber when, in the month under
review, a larger share of its orders came back than across all branches together, or it took less
revenue than in the month before. January has no month before it in the data, so only the first part
applies there. The mark says where to look first, not what went wrong.*

In measure terms: `returns_rate` for the branch above `returns_rate` for all branches in the same
month, or `mom_growth` below zero. The Attention column says which part in words, so the flag never
rests on colour alone.

**Sizes and scales.** The five callouts share one size. The two detail charts share one width, the same
bar thickness (the channel chart is three quarters the height of the category chart, three bars to
four), and one x axis: both run from 0 to the same maximum, set by a helper measure (the larger of the
top category and the top channel revenue in the current selection) through the axis's fx setting.

**Interactions.** The month slicer filters everything; the trend keeps all twelve months through
`month_axis` (decision 4). The branch slicer filters everything except the table (decision 5).

**Phone layout** (View, Mobile layout), in this order: title, month slicer, branch slicer, the five
callouts, the table, the trend, revenue by category, revenue by channel, the footer. Whether Publish to web shows
the phone layout in a phone browser is to be confirmed by opening the link on a phone in Phase B; the
site's Phase C plan (a still picture plus a link on phones) does not depend on it.

## 3. The measures

Every measure that shares a name with a `metrics.json` metric has that metric's `definition`, word for
word, as its Description, and the format for its unit. Claude Code drafts every measure's DAX; Megat
reviews and approves it before it goes into the model (corrected 8 Nov 2026: Megat does not write
DAX from scratch). Each row gives one known case to check each measure against on a scratch card. The
table holds 2025 only.

| Measure | Metric | Format | Check it with | Expected |
|---|---|---|---|---|
| `orders` | orders | `#,0` | the whole table (A01) | 4,948 |
| `returns` | returns | `#,0` | month 2025-12, all branches (computed with the metric's SQL; no case) | 46 |
| `revenue` | revenue | `#,0.00` | month 2025-03 (A02) | 97,694.60 |
| `returned_value` | returned_value | `#,0.00` | category Kitchen, quarter 2025-Q1 (A12) | 7,558.10 |
| `net_revenue` | net_revenue | `#,0.00` | quarter 2025-Q4 (A11) | 359,084.50 |
| `returns_rate` | returns_rate | `0.00%` | channel Online, whole year (A07) | 11.78% |
| `average_order_value` | average_order_value | `#,0.00` | month 2025-03 (A05) | 261.22 |
| `mom_growth` | mom_growth | `0.00%` | month 2025-06 (A09) | 1.99% |

The Descriptions, copied from `metrics.json`:

- **orders:** Count of orders placed in the period, returned or not.
- **returns:** Count of orders placed in the period that were later returned.
- **revenue:** Sum of the order value of every order placed in the period, before returns.
- **returned_value:** Sum of the order value of the orders placed in the period that were later returned.
- **net_revenue:** Revenue minus returned value: the order value of the orders placed in the period that were not returned.
- **returns_rate:** Returns divided by orders, as a percent: the share of orders placed in the period that were later returned.
- **average_order_value:** Revenue divided by orders: the mean order value of the orders placed in the period.
- **mom_growth:** Revenue in the month minus revenue in the month before, divided by the month before, as a percent. The period must be one month, and January has no month before it in the data.

`mom_growth` follows its definition: blank unless exactly one month is in the filter, and blank for
2025-01. There is no date table and no relationship on purpose; the month before can be found from
`order_date` or from the `month` text.

**The drafted DAX** (approved by Megat as drafted, 8 Nov 2026). All eight live in the `fct_orders` table.

```dax
orders = COUNTROWS ( fct_orders )

returns = CALCULATE ( COUNTROWS ( fct_orders ), KEEPFILTERS ( fct_orders[returned] = TRUE () ) )

revenue = SUM ( fct_orders[order_value] )

returned_value = CALCULATE ( [revenue], KEEPFILTERS ( fct_orders[returned] = TRUE () ) )

net_revenue = [revenue] - [returned_value]

returns_rate = DIVIDE ( COALESCE ( [returns], 0 ), [orders] )

average_order_value = DIVIDE ( [revenue], [orders] )

mom_growth =
VAR this_month = SELECTEDVALUE ( fct_orders[month] )
VAR month_before = FORMAT ( EOMONTH ( MIN ( fct_orders[order_date] ), -1 ), "yyyy-MM" )
VAR revenue_before =
    CALCULATE (
        [revenue],
        REMOVEFILTERS ( fct_orders[month], fct_orders[quarter], fct_orders[order_date] ),
        fct_orders[month] = month_before
    )
RETURN
    IF ( NOT ISBLANK ( this_month ), DIVIDE ( [revenue] - revenue_before, revenue_before ) )
```

Why each choice:
- `KEEPFILTERS` keeps a filter already on `returned` (a slicer on it) instead of overriding it.
- `COALESCE ( [returns], 0 )` makes a branch with orders and no returns read 0.00%, not blank (Hillside
  in December). With no orders, `DIVIDE` still gives blank.
- `net_revenue` subtracts a blank as 0, so a period with no returns gives its whole revenue.
- `mom_growth` is blank unless one month is in the filter. The month before comes from `order_date`.
  Only the month, quarter and date filters are lifted for it, so branch, category and channel filters
  still apply. January's month before, 2024-12, has no rows, so `DIVIDE` gives blank.

**Helper measures** (not metrics; each still carries a Description saying what it is for):
`page_subtitle` (the month and branch shown under the title), `attention` (the words in the
Attention column, blank when not flagged), `attention_colour` (amber when flagged, for the table's
conditional formatting), `trend_revenue` and `trend_selected_month` (the trend's line and its marked
column, through `month_axis`), and `detail_scale_max` (the shared x axis maximum).

**The page on its default view, 2025-12, all branches** (computed from `fct_orders` batch 1 with the
assistant's rounding rule, `lib/round.js`), so the finished page can be checked by eye:

| Branch | Net revenue | Returns rate | Month on month growth | Flagged |
|---|---|---|---|---|
| Central | 27,517.80 | 5.88% | 20.54% | |
| Westgate | 26,491.50 | 11.54% | -10.15% | both parts |
| Harbour | 21,131.70 | 7.14% | 10.58% | |
| Airport | 14,567.50 | 4.55% | 3.66% | |
| Northpoint | 14,492.00 | 15.07% | 54.69% | returns |
| Old Town | 11,849.20 | 5.77% | 36.27% | |
| Riverside | 9,888.60 | 4.55% | 9.55% | |
| Hillside | 8,793.60 | 0.00% | -18.33% | revenue down |

All branches: revenue 147,575.80, net revenue 134,731.90, returns rate 7.82%, average order value
250.98, month on month growth 9.98%.

## 4. The data state

**`export_batch` 1 only: 4,948 rows.** The Power Query step that loads the Parquet keeps rows where
`export_batch` = 1, and `scripts/check_dashboard.js` confirms that step is in the model's TMDL before it
compares a single number. The Parquet file itself stays the whole of `fct_orders` (4,978 rows), so the
hand-off is a plain copy of the tested table and the filter is visible in the report's own text.

## 5. The agreement check

**Counted: 14 cases**, every number in each (44 values):
A01, A02, A03, A04, A05, A06, A07, A09, A10, A11, A12, A14, A19, A20.
A19 and A20 ask with misspelt branch names; the dashboard is checked on the corrected names (Harbour,
Riverside), since correcting the spelling is the assistant's job, not the page's.

**Left out, each named in the record with its reason, never counted as a pass:**

| Case | Reason |
|---|---|
| A08, A16 | `revenue_share`, `orders_share`: not measures on this page |
| A13 | `largest_order`: not a measure on this page |
| A15 | `qoq_growth`: not a measure on this page |
| A17, A18 | `compare_periods`: a comparison the assistant builds, with change columns the page has no measure for |
| R01, R03, R04, R06 | a gate: the right answer is a refusal, with no number |
| R02, R05 | a gate first; the number after it repeats a kind of question already counted |
| S01 | the same question as A02 |
| S02 | assumes batch 2 is loaded (section 4) |

**The query.** Written to `dashboard/agreement.dax` after "go". Megat opens a DAX query view tab,
pastes it, runs it and saves; Power BI keeps the tab in the project's `DAXQueries` folder, and the
check confirms that copy matches `dashboard/agreement.dax`, so the result came from the query in git.

```dax
// The agreement check (dashboard/DESIGN.md, section 5): the dashboard's own measures on the 14 case
// questions it can answer. One row per number. Values are not rounded here: scripts/check_dashboard.js
// rounds them by the assistant's rule. The table holds 2025 only, so the year needs no filter.
EVALUATE
UNION (
    ROW ( "case_id", "A01", "group", "", "value", [orders] ),
    ROW ( "case_id", "A02", "group", "", "value", CALCULATE ( [revenue], fct_orders[month] = "2025-03" ) ),
    SELECTCOLUMNS (
        SUMMARIZECOLUMNS ( fct_orders[branch], TREATAS ( { "2025-Q2" }, fct_orders[quarter] ), "v", [orders] ),
        "case_id", "A03", "group", fct_orders[branch], "value", [v] ),
    SELECTCOLUMNS (
        SUMMARIZECOLUMNS ( fct_orders[branch], TREATAS ( { "2025-Q3" }, fct_orders[quarter] ), "v", [returns_rate] ),
        "case_id", "A04", "group", fct_orders[branch], "value", [v] ),
    ROW ( "case_id", "A05", "group", "", "value", CALCULATE ( [average_order_value], fct_orders[month] = "2025-03" ) ),
    SELECTCOLUMNS (
        SUMMARIZECOLUMNS ( fct_orders[category], "v", [revenue] ),
        "case_id", "A06", "group", fct_orders[category], "value", [v] ),
    ROW ( "case_id", "A07", "group", "", "value", CALCULATE ( [returns_rate], fct_orders[channel] = "Online" ) ),
    ROW ( "case_id", "A09", "group", "", "value", CALCULATE ( [mom_growth], fct_orders[month] = "2025-06" ) ),
    SELECTCOLUMNS (
        SUMMARIZECOLUMNS ( fct_orders[month], TREATAS ( { "Riverside" }, fct_orders[branch] ), "v", [revenue] ),
        "case_id", "A10", "group", fct_orders[month], "value", [v] ),
    ROW ( "case_id", "A11", "group", "", "value", CALCULATE ( [net_revenue], fct_orders[quarter] = "2025-Q4" ) ),
    ROW ( "case_id", "A12", "group", "", "value",
        CALCULATE ( [returned_value], fct_orders[category] = "Kitchen", fct_orders[quarter] = "2025-Q1" ) ),
    SELECTCOLUMNS (
        SUMMARIZECOLUMNS ( fct_orders[channel], TREATAS ( { "2025-08" }, fct_orders[month] ), "v", [orders] ),
        "case_id", "A14", "group", fct_orders[channel], "value", [v] ),
    ROW ( "case_id", "A19", "group", "", "value",
        CALCULATE ( [revenue], fct_orders[branch] = "Harbour", fct_orders[month] = "2025-05" ) ),
    ROW ( "case_id", "A20", "group", "", "value",
        CALCULATE ( [returns_rate], fct_orders[branch] = "Riverside", fct_orders[quarter] = "2025-Q2" ) )
)
ORDER BY [case_id], [group]
```

**The comparison**, in `scripts/check_dashboard.js`:

- Reads `dashboard/agreement.tsv` (tab or comma separated, header row; brackets and table prefixes on
  column names are stripped, Windows line endings accepted).
- Each value is read as a decimal string (`toPrecision(12)`, to drop floating point noise), multiplied
  by 100 when the metric's unit is `%`, then rounded half away from zero to two places, the rule in
  `lib/round.js`. Counts compare as whole numbers.
- A case matches only when every expected group is present with the expected value and no other group
  is. A missing case, an extra group or a wrong value is a miss, named with expected and got.
- Writes `results/dashboard/D<yyyymmddhhmm>-<short sha>.json`, the same form as the CI records:
  commit, data state, measures checked, `matched`, `total` (14), every miss, and every left-out case
  with its reason. Exits non-zero on any miss.

**Before it compares anything, it checks the model** (from the TMDL text under
`dashboard/report/Branch review.SemanticModel/definition/`):

- each of the eight metric measures exists, its Description equals the metric's definition, and its
  format string is the one for its unit;
- every other measure has a Description;
- no format string anywhere carries a currency symbol;
- the `fct_orders` partition keeps `export_batch` = 1 and reads the Parquet through the path parameter;
- there are no relationships;
- the `DAXQueries` copy of the query matches `dashboard/agreement.dax`.

Any missing file stops it with the file's name and a non-zero exit, never a silent pass.

**What this cannot prove:** the result file is pasted by hand from DAX query view. The guard is that
the query and the model are both in git, so anyone with Power BI Desktop can reopen the project, run
the same query and get the same file.

## 6. Design rules for the report

A report theme, `dashboard/theme.json`, holds them, so they live in git and Megat imports one file
(Design ribbon, Import theme, in Power BI Desktop 2.159):

- **Colours, one meaning each:** marine `#2C5F7C` for values (the line, the bars); marine deep
  `#214A62` for the selected month; amber `#B07E23` for attention only, with amber tint `#F7EFDD`
  behind a flagged row; ink `#172529` for text, ink soft `#4F6166` for secondary text, line
  `#DEE2E6` for gridlines; page `#F3F4F6`, visuals on white `#FFFFFF`. From the site's `style.css`.
- **Segoe UI** throughout (Manrope does not render in the Power BI service).
- No gradients, no 3D, no pie or donut charts, no shadows, no visual borders; rounded visual corners
  to sit beside the site's panels.
- **Titles in sentence case that say what the visual answers** ("Branches ranked by net revenue",
  "Revenue by month, 2025"). Measure names stay as in `metrics.json`; each visual renames its field for
  display ("Net revenue"), which changes no measure.
- **No currency symbol anywhere:** `order_value`'s own format set to `#,0.00` after it becomes Fixed
  decimal, and every amount measure `#,0.00`.
- **Amounts on the cards in thousands, one decimal** (added 8 Nov 2026): the Revenue and Net revenue
  cards set the visual's display units to Thousands with 1 decimal place (147.6K). The measures keep
  `#,0.00`, so the check is unchanged. The branch table shows full values (27,517.80). The Average
  order value card keeps full values, 250.98, because in thousands it would read 0.3K (recommended,
  to confirm). Percent cards are unchanged.
- **Footer, one line** (added 8 Nov 2026): "Amounts are order values in one currency, shown without a
  symbol. All data is synthetic."
- No dashes in report text; the subtitle joins with "·".
- Every visual has alt text saying what it shows; tab order follows the reading order.
- Synthetic data: the eight place-type branch names only, amounts to 2 places.

## 7. Files added

| File | Written by | When |
|---|---|---|
| `dashboard/DESIGN.md` | Claude Code | now |
| `scripts/build_gate.js` | Claude Code | step 2 (decision 8) |
| `scripts/export_mart.js` (imports the gate; same behaviour) | Claude Code | step 2 |
| `scripts/export_dashboard.js` (the copy, and `--check`) | Claude Code | step 2 |
| `dashboard/data/fct_orders.parquet` (4,978 rows) | the script | step 2 |
| `dashboard/agreement.dax` | Claude Code | step 3 |
| `dashboard/theme.json` | Claude Code | step 3 |
| `scripts/check_dashboard.js` | Claude Code | step 3 |
| `test/dashboard.js` (added in step 3: tests the check on a stand-in project, sixteen scenarios, no Power BI) | Claude Code | step 3 |
| `package.json`: `"dashboard:data"`, `"dashboard:check"` scripts | Claude Code | steps 2 and 3 |
| `.gitignore`: `DASHBOARD-BRIEF.md`, and `dashboard/report/**/.pbi/cache.abf` and `localSettings.json` beside the project's own ignore file | Claude Code | step 2 |
| `README.md`: one short "The dashboard" paragraph | Claude Code | step 3 |
| `dashboard/report/Branch review.pbip`, `.SemanticModel/`, `.Report/` | Megat, on the PC | B3, B4 |
| `dashboard/agreement.tsv` | Megat, on the PC | B5 |
| `results/dashboard/D…json` | the check, on the Mac | after B5 |
| `.github/workflows/cases.yml` (shown before it changes) | Claude Code | after B5 |

**The CI change, when it comes:** `node scripts/export_dashboard.js --check` joins the "Tested tables
with no key" step right after `dbt build`, and `node scripts/check_dashboard.js` joins it once the
.pbip and `agreement.tsv` are in git. Before then the check would stop on a missing file and turn the
gate red, so it goes in after B5, not in step 3. Both read files only; neither needs Power BI.

## 8. Phase B: the PC steps, in order

Given one instruction at a time when we get there. Every sign-in and setting is Megat's.

1. **Git for Windows** (`winget install --id Git.Git -e`, or GitHub Desktop), keeping the installer's
   default line endings ("Checkout Windows-style, commit Unix-style"). Then, in Git Bash:
   `git config --global user.name "Megat Jazly"` and
   `git config --global user.email "76079998+mjazzly@users.noreply.github.com"`, so commits from the
   PC carry the noreply address too.
2. **Clone** `mjazzly/data-answers` to `C:\repos\data-answers` (decision 12), signing in to GitHub
   in the browser window Git opens.
3. **Power BI Desktop** from the Microsoft Store. Sign in with the tenant account. In File, Options,
   Preview features: if "Power BI Project (.pbip) save option" and "Store semantic model using TMDL
   format" are listed, turn both on, and restart. (Done 8 Nov 2026 on 2.159.1231.0: neither was
   listed, both are standard; "Detect and reload external PBIP changes" was already on.)
4. **Load the data.** New report. Manage parameters: `RepoPath`, Text, `C:\repos\data-answers`.
   Get data, Parquet, then in the Advanced Editor point the source at
   `RepoPath & "\dashboard\data\fct_orders.parquet"`. Keep rows where `export_batch` = 1. Set
   `order_value` to Fixed decimal number, then its format to `#,0.00`. Name the query `fct_orders`.
   Add `month_axis` as a reference to `fct_orders`, keeping the `month` column, distinct. (Done as two
   blank queries in the Advanced Editor. Power BI joined the two `month` columns by itself and Auto
   date/time added hidden date tables and a join; the join was deleted, and in Options, Current file,
   Data Load, "Auto date/time" and "Autodetect new relationships" were turned off.)
5. **Save as a Power BI project:** `C:\repos\data-answers\dashboard\report\Branch review.pbip`.
   Commit and push; Claude Code reviews the model text from the Mac. (Done: `6f2b263`.)
6. **Import the theme** `dashboard\theme.json` (Design ribbon, Import theme, in 2.159).
7. **The eight measures.** Claude Code drafts them (section 3) and Megat approves the draft. Megat
   saves, commits and pushes the project from the PC. On the Mac, Claude Code pulls, writes the eight
   measures with their Descriptions and formats into `fct_orders.tmdl`, runs the check and pushes.
   Megat pulls on the PC; Power BI reloads the changed project files, and Megat checks each measure on
   a scratch card against its expected number. The helper measures follow the same way.
8. **Build the page** (section 2), then the phone layout. Save, commit, push; review.
9. **Run the agreement query** in a DAX query view tab, copy the results with headers into Notepad,
   save as `dashboard\agreement.tsv`. Commit and push. On the Mac: pull and
   `node scripts/check_dashboard.js`.
10. **Tenant settings** (Admin portal, Megat's account): Tenant settings, Advanced networking, Block Public
    Internet Access to Disabled; then Export and sharing settings, Publish to web, allow users to
    create new embed codes.
11. **Microsoft 365 Business Basic** added to the same tenant (admin.microsoft.com; confirm the price
    on the page) before the link goes on the site.
12. **Publish** to My workspace, create the Publish to web link and embed code, and open the link in a
    private window on the Mac to confirm it loads with no sign-in. Open it on a phone too (section 2).

Then Phase C, in the site's own session, once the check is green.
