-- One row per order: the raw export trimmed, mapped, cast and derived. An identical repeat is kept once,
-- compared after cleaning. A repeated order_id with different values keeps both rows, so the unique
-- test on order_id turns red and no row is picked silently. The same id in two batches counts as
-- different values. An unknown branch code leaves branch empty and fails the relationships test.
with cleaned as (
  select
    order_id,
    branch_code,
    cast(ordered_at as timestamp) as ordered_at,
    {{ title_case('category') }} as category,
    {{ first_capital('channel') }} as channel,
    {{ parse_amount('order_value') }} as order_value,
    cast(export_batch as integer) as export_batch
  from {{ ref('raw_orders') }}
)
select distinct
  c.order_id,
  c.branch_code,
  b.branch,
  c.ordered_at,
  cast(c.ordered_at as date) as order_date,
  strftime(c.ordered_at, '%Y-%m') as month,
  strftime(c.ordered_at, '%Y') || '-Q' || cast(quarter(c.ordered_at) as varchar) as quarter,
  c.category,
  c.channel,
  c.order_value,
  c.export_batch
from cleaned c
left join {{ ref('branch_codes') }} b on b.code = c.branch_code
