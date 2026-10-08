begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

select has_column('public', 'option_groups', 'applicable_category_kinds', 'option_groups has applicable_category_kinds column');
select col_type_is('public', 'option_groups', 'applicable_category_kinds', 'category_kind[]', 'applicable_category_kinds is category_kind[]');
select col_not_null('public', 'option_groups', 'applicable_category_kinds', 'applicable_category_kinds is not null');

select throws_ok(
  $$insert into public.option_groups (
      id, store_id, name, selection_mode, minimum_selections, maximum_selections, is_required, sort_order, applicable_category_kinds
    ) values (
      '0199b2c8-40b0-7000-8000-999999999999', '0199b2c8-40b0-7000-8000-000000000001', 'Test Empty', 'single', 0, 1, false, 99, array[]::public.category_kind[]
    )$$,
  '23514',
  null,
  'empty applicable_category_kinds violates cardinality check'
);

select lives_ok(
  $$insert into public.option_groups (
      id, store_id, name, selection_mode, minimum_selections, maximum_selections, is_required, sort_order, applicable_category_kinds
    ) values (
      '0199b2c8-40b0-7000-8000-999999999998', '0199b2c8-40b0-7000-8000-000000000001', 'Test Single', 'single', 0, 1, false, 99, array['burger']::public.category_kind[]
    )$$,
  'valid applicable_category_kinds passes'
);

select * from finish();
rollback;
