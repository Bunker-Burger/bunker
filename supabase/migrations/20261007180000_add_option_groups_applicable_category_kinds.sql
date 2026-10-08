alter table public.option_groups
  add column applicable_category_kinds public.category_kind[] not null default array['burger', 'sandwich', 'side', 'drink', 'other']::public.category_kind[];

update public.option_groups
set applicable_category_kinds = case id
  when '0199b2c8-40b0-7000-8000-000000000301' then array['burger']::public.category_kind[]
  when '0199b2c8-40b0-7000-8000-000000000302' then array['burger', 'sandwich']::public.category_kind[]
  when '0199b2c8-40b0-7000-8000-000000000303' then array['side']::public.category_kind[]
  else array['burger', 'sandwich', 'side', 'drink', 'other']::public.category_kind[]
end;

alter table public.option_groups
  add constraint option_groups_applicable_category_kinds_check
  check (cardinality(applicable_category_kinds) >= 1);
