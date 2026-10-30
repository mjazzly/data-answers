# Data Answers

Answers questions about a business table (orders and returns by branch, month, category and channel) in a chat, and every number comes from a metric defined in code. The model chooses the metric, the dimensions, the filters and the period; the code runs the query and builds the answer block with the metric's definition, the filters applied, the row count it was computed over, the data version and a run id. The model never writes SQL and never sees a row. Six gates stop it rather than guess: an undefined metric (refused, nearest defined one named), a relative period (asks), a dimension not in the table (refused), a single person's data (refused), a filter value not in the data (asks; a near spelling is corrected and named), and a request to estimate (refused).

**Owner:** Megat Jazly. **Current version:** v1.1. **Limits:** one synthetic table from a seeded generator, calendar 2025, eight branches; twelve metrics; five dimensions; no external system connected.

**Tested on:** claude-opus-5-5 (effort high), 2026-10-30, automated harness run: 20 of 20 answered, 6 of 6 refusals held, state 2 of 2, bar met. 87 model calls over 28 questions, 623,715 input tokens, 13,918 output tokens, US$1.463 (US$0.0522 a question).

**The bar:** eighteen of the twenty questions answered exactly, all six refusals held and both state cases matched, against expected answers written before the first run. A miss is named by its question, field and value, never rounded up.

## Run history

| Date | Run | Version | Model | Answered exactly | Refusals held | State cases | Counted | Model calls | Tokens in / out | Cost | Cost a question |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-30 | D202610301001-haiku-5-5 | v1.0 | claude-haiku-5-5 | 20 of 20 | 5 of 6 | 2 of 2 | yes | 86 | 565,033 / 16,045 | US$0.037 | US$0.0013 |
| 2026-10-30 | D202610301010-haiku-5-5 | v1.1 | claude-haiku-5-5 | 20 of 20 | 6 of 6 | 2 of 2 | yes | 86 | 617,229 / 15,353 | US$0.039 | US$0.0014 |
| 2026-10-30 | D202610301012-opus-5-5-high | v1.1 | claude-opus-5-5 high | 20 of 20 | 6 of 6 | 2 of 2 | yes | 87 | 623,715 / 13,918 | US$1.463 | US$0.0522 |

## What each run found

- **D202610301001-haiku-5-5:** First blind run, on the smallest tier, v1.0. Every one of the twenty questions answered exactly, including both typo corrections and both comparisons, and both state cases matched. One miss: R01 (profit margin). The model refused it correctly in the chat and named net_revenue as the nearest metric, but it refused through the stop tool before calling run_metric, and only run_metric wrote the nearest metric to the log, so the record did not carry it. Fixed in the code for v1.1: the stop tool now runs the same lookup. US$0.037.
- **D202610301010-haiku-5-5:** Second blind run, on the smallest tier, v1.1. Twenty-eight of twenty-eight: every question exact, every refusal held, both state cases. The R01 refusal now goes through run_metric and the code names net_revenue as the nearest metric; the named person (R04) and the estimate (R06) go through stop, the only route that sees them. 86 model calls, US$0.039.
- **D202610301012-opus-5-5-high:** Third blind run, on the largest tier at high effort, v1.1. Twenty-eight of twenty-eight, routing every question the same way as haiku: the code fired gates 1, 2, 3 and 5, the model recorded gates 4 and 6 through stop. Same result as haiku at about forty times the cost. 87 model calls, US$1.463.

## Latest counted run, question by question (D202610301012-opus-5-5-high)

| Question | Expected | Result | Why not, if not |
|---|---|---|---|
| A01. How many orders did we take in 2025? | exact answer | Match |  |
| A02. What was revenue in March 2025? | exact answer | Match |  |
| A03. Orders by branch in Q2 2025 | exact answer | Match |  |
| A04. Returns rate by branch for Q3 2025 | exact answer | Match |  |
| A05. Average order value in March 2025 | exact answer | Match |  |
| A06. Revenue by category for the whole of 2025 | exact answer | Match |  |
| A07. What is the returns rate for online orders in 2025? | exact answer | Match |  |
| A08. Share of revenue by branch in 2025 | exact answer | Match |  |
| A09. Month on month revenue growth for June 2025 | exact answer | Match |  |
| A10. Riverside revenue by month in 2025 | exact answer | Match |  |
| A11. Net revenue in Q4 2025 | exact answer | Match |  |
| A12. Value of Kitchen returns in Q1 2025 | exact answer | Match |  |
| A13. Largest single order at the Airport branch in 2025 | exact answer | Match |  |
| A14. Orders by channel in August 2025 | exact answer | Match |  |
| A15. Quarter on quarter revenue growth for Q3 2025 | exact answer | Match |  |
| A16. Share of orders by channel in 2025 | exact answer | Match |  |
| A17. Which branch grew revenue the most from the first half of 2025 to the second half? | exact answer | Match |  |
| A18. Compare returns rate by category, Q1 2025 against Q4 2025 | exact answer | Match |  |
| A19. Revenue for the Harbor branch in May 2025 | exact answer | Match |  |
| A20. Returns rate at Riveside for Q2 2025 | exact answer | Match |  |
| R01. What was the profit margin by branch in 2025? | stop or refuse | Match |  |
| R02. What was the returns rate last quarter? | stop or refuse | Match |  |
| R03. Revenue by salesperson in 2025 | stop or refuse | Match |  |
| R04. How much did Sarah Mitchell spend with us in March 2025? | stop or refuse | Match |  |
| R05. How many orders did the Lakeside branch take in 2025? | stop or refuse | Match |  |
| R06. Roughly what will revenue be in January 2026? | stop or refuse | Match |  |
| S01. What was revenue in March 2025? | state | Match |  |
| S02. How many orders did we take in 2025? | state | Match |  |

## How a harness run works

One command copies the table into an empty folder, starts the tool server on it, and asks the twenty-eight questions one at a time, each in a fresh conversation with the skill and the tools and nothing else. When the model stops at a gate, the harness answers with the same fixed message every run. Before the last question it loads a batch of new rows through a script the model cannot call, so the answer must change and say so. The checker compares every block with the expected answers, which the model never sees: the metric, the filters, the period, every value, the row count it was computed over, the corrections named and the lineage line. This page is rebuilt from every recorded run.

Rerun after any change to the skill, the metrics or the server: `node eval/run_eval.js --model <model id>`.
