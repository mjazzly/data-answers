-- One row per order, in the columns, types and order of data/orders.csv, plus export_batch. This is the
-- table the AI reads, once scripts/export_mart.js has written it back to the two CSVs. The post-hook
-- copies it to target/fct_orders.parquet, the hand-off to Node. It runs before this table's own tests,
-- so the export reads run_results.json and refuses unless every node passed.
{{ config(post_hook="copy (select * from " ~ this ~ " order by export_batch, order_id) to 'target/fct_orders.parquet' (format parquet)") }}
select
  o.order_id,
  o.branch,
  o.order_date,
  o.month,
  o.quarter,
  o.category,
  o.channel,
  o.order_value,
  r.order_id is not null as returned,
  o.export_batch
from {{ ref('stg_orders') }} o
left join {{ ref('stg_returns') }} r on r.order_id = o.order_id
order by o.export_batch, o.order_id
