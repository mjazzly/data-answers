-- S5. Total order value in fct_orders equals the raw total once the identical repeats are removed.
-- The raw side parses the amount on its own, without the staging macro.
with raw as (select sum(cast(replace(order_value, ',', '') as decimal(14, 2))) as total from (select distinct * from {{ ref('raw_orders') }})),
fct as (select sum(order_value) as total from {{ ref('fct_orders') }})
select raw.total as raw_total, fct.total as fct_total from raw, fct where raw.total is distinct from fct.total
