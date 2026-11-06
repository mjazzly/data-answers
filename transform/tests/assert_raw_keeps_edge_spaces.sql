-- S7. The raw export keeps its edge spaces. scripts/make_raw.js writes a fixed number of category and
-- channel values with a leading or trailing space (raw_edge_spaced in dbt_project.yml); a seed loader
-- that strips them would leave staging's trimming untested, so the count must match exactly.
-- Counted over the distinct raw rows, so an identical repeat is not counted twice.
with raw as (select distinct * from {{ ref('raw_orders') }}),
counted as (
  select 'category' as col, count(*) filter (where category <> trim(category)) as found, {{ var('raw_edge_spaced')['category'] }} as expected from raw
  union all
  select 'channel', count(*) filter (where channel <> trim(channel)), {{ var('raw_edge_spaced')['channel'] }} from raw
)
select * from counted where found <> expected
