-- Issue #54: extras (multiple-choice groups) have no cap; the customer adds as many as they want.
-- "Tamaño / medallones" stays single choice. A high ceiling keeps the existing checks (orders count
-- selections against the maximum) without a schema change; per-product caps are cleared.

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
