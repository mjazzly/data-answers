-- S6. Returned orders in fct_orders equal the distinct order ids in the return events.
with raw as (select count(distinct order_id) as n from {{ ref('raw_returns') }}),
fct as (select count(*) as n from {{ ref('fct_orders') }} where returned)
select raw.n as raw_returned, fct.n as fct_returned from raw, fct where raw.n <> fct.n
