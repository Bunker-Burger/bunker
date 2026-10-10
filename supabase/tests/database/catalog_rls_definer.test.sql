begin;

create extension if not exists pgtap with schema extensions;

-- 20261010190000: signed-in catalog policies check other tables through SECURITY DEFINER helpers
-- (schema catalog_rls; `private` stays closed to browser roles)
-- instead of nested EXISTS under RLS, which made signed-in reads hit the statement timeout.

select plan(7);

select results_eq(
  $$select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'catalog_rls'
      and p.proname in (
        'is_store_admin', 'store_is_public', 'category_is_visible', 'product_is_readable', 'is_product_admin',
        'option_group_is_readable', 'is_option_group_admin', 'promotion_is_readable', 'is_promotion_admin'
      )
      and p.prosecdef
      and p.provolatile = 's'
      and array_to_string(p.proconfig, ',') ~ 'search_path=(""|'''''')'$$,
  $$values (9)$$,
  'the nine policy helpers exist as stable SECURITY DEFINER functions with an empty search_path'
);

select results_eq(
  $$select
      count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute'))::int,
      count(*) filter (where has_function_privilege('anon', p.oid, 'execute'))::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'catalog_rls'
      and p.proname in (
        'is_store_admin', 'store_is_public', 'category_is_visible', 'product_is_readable', 'is_product_admin',
        'option_group_is_readable', 'is_option_group_admin', 'promotion_is_readable', 'is_promotion_admin'
      )$$,
  $$values (9, 0)$$,
  'only authenticated may execute the helpers; anon cannot'
);

select results_eq(
  $$select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('private', 'catalog_rls')
      and p.proname not in (
        'is_store_admin', 'store_is_public', 'category_is_visible', 'product_is_readable', 'is_product_admin',
        'option_group_is_readable', 'is_option_group_admin', 'promotion_is_readable', 'is_promotion_admin'
      )
      and has_function_privilege('authenticated', p.oid, 'execute')$$,
  $$values (0)$$,
  'authenticated gets no other function in private or catalog_rls'
);
select ok(
  not has_schema_privilege('authenticated', 'private', 'USAGE') and not has_schema_privilege('anon', 'catalog_rls', 'USAGE'),
  'private stays closed to authenticated and catalog_rls to anon'
);

select results_eq(
  $$select count(*)::int
    from pg_policies
    where schemaname = 'public'
      and 'authenticated' = any (roles)
      and tablename in (
        'categories', 'products', 'product_images', 'product_option_groups', 'option_groups', 'options',
        'promotion_rules', 'promotion_items', 'promotion_schedule', 'store_payment_methods', 'store_business_hours'
      )
      and (
        (cmd = 'SELECT' and policyname like '%authenticated_read')
        or (tablename in ('product_images', 'options', 'promotion_schedule') and policyname like '%admin_%')
      )
      and (coalesce(qual, '') ~* '\mselect\M' or coalesce(with_check, '') ~* '\mselect\M')$$,
  $$values (0)$$,
  'no rewritten signed-in policy runs a subquery through another table''s RLS'
);

-- Timing: a signed-in admin reads every catalog table within 3 s. Before the helpers, reading
-- `options` alone took 3.5–18 s and hit the 8 s statement timeout.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  'a9000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'timing-admin@rls.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.stores (id, name, slug, whatsapp_e164, is_public)
values ('a9000000-0000-0000-0000-000000000002', 'RLS Timing', 'rls-timing', '+5491100000109', true);
insert into public.admin_memberships (store_id, user_id, role)
values ('a9000000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-000000000001', 'owner');

select set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
set local statement_timeout = '3s';
select lives_ok(
  $$select
      (select count(*) from public.options)
      + (select count(*) from public.option_groups)
      + (select count(*) from public.product_option_groups)
      + (select count(*) from public.products)
      + (select count(*) from public.product_images)
      + (select count(*) from public.categories)$$,
  'a signed-in admin reads options, groups, links, products, images and categories within 3 s'
);
select lives_ok(
  $$select
      (select count(*) from public.promotion_rules)
      + (select count(*) from public.promotion_items)
      + (select count(*) from public.promotion_schedule)
      + (select count(*) from public.store_payment_methods)
      + (select count(*) from public.store_business_hours)$$,
  'a signed-in admin reads promotions, payment methods and hours within 3 s'
);
reset statement_timeout;
reset role;

select * from finish();
rollback;
