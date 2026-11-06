-- S3. month is the year and month of order_date, and quarter is its quarter.
select order_id, order_date, month, quarter
from {{ ref('fct_orders') }}
where month <> strftime(order_date, '%Y-%m')
   or quarter <> cast(year(order_date) as varchar) || '-Q' || cast(quarter(order_date) as varchar)
