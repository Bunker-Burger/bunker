-- Issue #54: medallions and extras are multiple choice with no cap; the customer adds as many as
-- they want. "Tamaño / medallones" keeps being required (at least one, its default).
-- A high ceiling keeps the existing checks (orders count selections against the maximum) without
-- a schema change; per-product overrides that capped them are cleared.

update public.option_groups
   set selection_mode = 'multiple',
       maximum_selections = 99
 where id = '0199b2c8-40b0-7000-8000-000000000301';

update public.option_groups
   set maximum_selections = 99
 where selection_mode = 'multiple'
   and maximum_selections < 99;

update public.product_option_groups pog
   set maximum_selections_override = null
  from public.option_groups og
 where og.id = pog.option_group_id
   and og.selection_mode = 'multiple'
   and pog.maximum_selections_override is not null;
