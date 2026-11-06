-- S1. Every return sits in its order's batch: no batch 2 return points at a batch 1 order. The batch
-- loader only appends rows, so a late return for an earlier batch could not be shown; this test makes
-- that limit visible instead of hiding it (README, the late returns limit).
select r.order_id, r.export_batch as return_batch, o.export_batch as order_batch
from {{ ref('stg_returns') }} r
join {{ ref('stg_orders') }} o on o.order_id = r.order_id
where r.export_batch <> o.export_batch
