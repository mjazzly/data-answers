-- S2. Every order value is above 0.
select order_id, order_value from {{ ref('fct_orders') }} where order_value <= 0
