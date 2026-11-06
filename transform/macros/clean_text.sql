{#- The cleaning rules staging applies to the raw text (transform/DESIGN.md, decision 13). No list of
    values here: a spelling that does not land on a metrics.json value is caught by accepted_values. -#}

{#- trim the ends and fold every run of inner spaces to one -#}
{% macro fold_space(col) -%}
  regexp_replace(trim({{ col }}), '\s+', ' ', 'g')
{%- endmacro %}

{#- every word capitalised: garment care -> Garment Care -#}
{% macro title_case(col) -%}
  array_to_string(list_transform(string_split(lower({{ fold_space(col) }}), ' '), lambda w: upper(left(w, 1)) || substr(w, 2)), ' ')
{%- endmacro %}

{#- the first letter capitalised, the rest lower: IN STORE -> In store -#}
{% macro first_capital(col) -%}
  upper(left({{ fold_space(col) }}, 1)) || lower(substr({{ fold_space(col) }}, 2))
{%- endmacro %}

{#- an amount as text, with or without a thousands separator: 1,250.00 -> 1250.00 -#}
{% macro parse_amount(col) -%}
  cast(replace(trim({{ col }}), ',', '') as decimal(12, 2))
{%- endmacro %}
