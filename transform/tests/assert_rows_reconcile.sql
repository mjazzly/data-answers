-- S4. fct_orders holds one row for each distinct raw order id, batch by batch.
with raw as (select cast(export_batch as integer) as export_batch, count(distinct order_id) as n from {{ ref('raw_orders') }} group by 1),
fct as (select export_batch, count(*) as n from {{ ref('fct_orders') }} group by 1)
select coalesce(raw.export_batch, fct.export_batch) as export_batch, raw.n as raw_orders, fct.n as fct_orders
from raw full join fct on fct.export_batch = raw.export_batch
where raw.n is distinct from fct.n
