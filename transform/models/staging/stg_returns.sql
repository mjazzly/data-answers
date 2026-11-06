-- One row per returned order. A return logged twice counts once: the first event's time is kept and
-- the number of events is carried for the record. An order returned in two batches gives two rows and
-- fails the unique test on order_id.
select
  order_id,
  min(cast(returned_at as timestamp)) as returned_at,
  count(*) as events,
  cast(export_batch as integer) as export_batch
from {{ ref('raw_returns') }}
group by order_id, export_batch
