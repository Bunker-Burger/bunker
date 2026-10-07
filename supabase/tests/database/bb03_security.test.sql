begin;

create extension if not exists pgtap with schema extensions;

select plan(45);

select has_table('public', 'payment_quotes', 'payment_quotes exists');
select has_table('public', 'payment_webhook_events', 'payment_webhook_events exists');
select col_type_is(
  'public', 'payment_quotes', 'total_cents', 'bigint',
  'quote totals use bigint cents'
);
select col_is_fk(
  'public', 'payment_attempts', array['quote_id', 'store_id'],
  'payment attempts belong to an authoritative quote'
);
select has_index(
  'public', 'option_groups', 'option_groups_store_id_idx', array['store_id'],
  'option_groups store foreign key is indexed'
);
select has_index(
  'public', 'payment_attempts', 'payment_attempts_quote_store_idx',
  array['quote_id', 'store_id'],
  'payment attempt quote foreign key is indexed'
);
select has_index(
  'public', 'product_option_groups', 'product_option_groups_group_store_idx',
  array['option_group_id', 'store_id'],
  'product option-group group foreign key is indexed'
);
select has_index(
  'public', 'product_option_groups', 'product_option_groups_product_store_idx',
  array['product_id', 'store_id'],
  'product option-group product foreign key is indexed'
);
select has_index(
  'public', 'products', 'products_category_store_idx',
  array['category_id', 'store_id'],
  'product category foreign key is indexed'
);
select has_index(
  'public', 'promotion_items', 'promotion_items_product_store_idx',
  array['product_id', 'store_id'],
  'promotion item product foreign key is indexed'
);
select has_index(
  'public', 'promotion_items', 'promotion_items_promotion_store_idx',
  array['promotion_id', 'store_id'],
  'promotion item promotion foreign key is indexed'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.payment_quotes'::regclass),
  'payment_quotes has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.payment_webhook_events'::regclass),
  'payment_webhook_events has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.payment_quotes', 'SELECT')
  and not has_table_privilege('anon', 'public.payment_webhook_events', 'SELECT'),
  'anon has no grant to private payment data'
);
select ok(
  not has_table_privilege('authenticated', 'public.payment_webhook_events', 'SELECT'),
  'browser-authenticated users cannot inspect webhook events'
);
select ok(
  has_schema_privilege('service_role', 'private', 'USAGE'),
  'service_role can resolve the private payment purge function'
);
select ok(
  has_function_privilege(
    'service_role',
    'private.purge_expired_payment_data()',
    'EXECUTE'
  ),
  'service_role can execute the payment retention purge'
);
select ok(
  not has_schema_privilege('anon', 'private', 'USAGE')
  and not has_schema_privilege('authenticated', 'private', 'USAGE'),
  'browser roles cannot resolve functions in the private schema'
);
select ok(
  not exists (
    select 1
    from pg_proc function_definition
    join pg_namespace function_schema
      on function_schema.oid = function_definition.pronamespace
    where function_schema.nspname = 'private'
      and function_definition.oid
        <> 'private.purge_expired_payment_data()'::regprocedure
      and has_function_privilege(
        'service_role',
        function_definition.oid,
        'EXECUTE'
      )
  ),
  'service_role cannot execute private validation or trigger functions'
);
select ok(
  not exists (
    select p.tablename
    from pg_policies p
    cross join lateral unnest(p.roles) as policy_role(role_name)
    where p.schemaname = 'public'
      and policy_role.role_name = 'authenticated'
      and p.cmd in ('SELECT', 'ALL')
    group by p.tablename
    having count(*) > 1
  ),
  'authenticated reads use one permissive policy per public table'
);
select has_function(
  'private', 'product_configuration_is_valid', array['uuid'],
  'product default validation function exists'
);
select ok(
  not has_function_privilege(
    'authenticated', 'private.product_configuration_is_valid(uuid)', 'EXECUTE'
  ),
  'product validation internals are not exposed to browser roles'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '90000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'admin@bb03.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '90000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'outsider@bb03.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.stores (
  id, name, slug, whatsapp_e164, is_public, delivery_fee_cents
) values (
  '91000000-0000-0000-0000-000000000001',
  'BB03 Store', 'bb03-store', '+5491100000001', true, 10000
);

insert into public.admin_memberships (store_id, user_id, role)
values (
  '91000000-0000-0000-0000-000000000001',
  '90000000-0000-0000-0000-000000000001',
  'admin'
);

insert into public.categories (
  id, store_id, name, slug, kind, is_visible
) values (
  '92000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',
  'BB03 Category', 'bb03-category', 'burger', true
);

insert into public.products (
  id, store_id, category_id, name, slug, description, base_price_cents,
  is_published
) values (
  '93000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',
  '92000000-0000-0000-0000-000000000001',
  'BB03 Product', 'bb03-product', 'A publishable product', 100000, false
);

insert into public.option_groups (
  id, store_id, name, selection_mode,
  minimum_selections, maximum_selections, is_required
) values
  (
    '94000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000001',
    'Required group', 'single', 1, 1, true
  ),
  (
    '94000000-0000-0000-0000-000000000002',
    '91000000-0000-0000-0000-000000000001',
    'Foreign group', 'single', 0, 1, false
  );

insert into public.options (
  id, option_group_id, name, price_delta_cents, is_available
) values
  (
    '95000000-0000-0000-0000-000000000001',
    '94000000-0000-0000-0000-000000000001',
    'Valid default', 0, true
  ),
  (
    '95000000-0000-0000-0000-000000000002',
    '94000000-0000-0000-0000-000000000002',
    'Foreign option', 0, true
  );

insert into public.product_option_groups (
  product_id, option_group_id, store_id, default_option_ids
) values (
  '93000000-0000-0000-0000-000000000001',
  '94000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',
  '{}'::uuid[]
);

select throws_ok(
  $$update public.products
    set is_published = true
    where id = '93000000-0000-0000-0000-000000000001'$$,
  'BB003',
  null,
  'a required option group without a default blocks publication'
);

update public.product_option_groups
set default_option_ids = array['95000000-0000-0000-0000-000000000002'::uuid]
where product_id = '93000000-0000-0000-0000-000000000001';

select throws_ok(
  $$update public.products
    set is_published = true
    where id = '93000000-0000-0000-0000-000000000001'$$,
  'BB003',
  null,
  'an option from another group cannot be a product default'
);

update public.product_option_groups
set default_option_ids = array['95000000-0000-0000-0000-000000000001'::uuid]
where product_id = '93000000-0000-0000-0000-000000000001';

select lives_ok(
  $$update public.products
    set is_published = true
    where id = '93000000-0000-0000-0000-000000000001'$$,
  'valid option defaults allow publication'
);

select throws_ok(
  $$update public.product_option_groups
    set default_option_ids = array['95000000-0000-0000-0000-000000000002'::uuid]
    where product_id = '93000000-0000-0000-0000-000000000001'$$,
  'BB003',
  null,
  'defaults cannot invalidate an already published product'
);

select throws_ok(
  $$update public.options
    set is_available = false
    where id = '95000000-0000-0000-0000-000000000001'$$,
  'BB003',
  null,
  'a selected default cannot become unavailable while its product is published'
);

select throws_ok(
  $$update public.options
    set id = '95000000-0000-0000-0000-000000000099'
    where id = '95000000-0000-0000-0000-000000000001'$$,
  'BB003',
  null,
  'a selected default UUID cannot change while its product is published'
);

insert into public.payment_quotes (
  id, store_id, lines, subtotal_cents, discount_cents, delivery_cents,
  total_cents, currency, fulfillment_channel, expires_at
) values (
  '96000000-0000-0000-0000-000000000002',
  '91000000-0000-0000-0000-000000000001',
  '[{"productId":"93000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb,
  100000, 0, 10000, 110000, 'ARS', 'delivery', now() + interval '15 minutes'
);

insert into public.payment_attempts (
  id, quote_id, store_id, amount_cents, currency,
  idempotency_key, external_reference, status
) values (
  '97000000-0000-0000-0000-000000000002',
  '96000000-0000-0000-0000-000000000002',
  '91000000-0000-0000-0000-000000000001',
  110000, 'ARS', 'bb03-current-idempotency', 'bb03-current-reference', 'pending'
);

set local role anon;
select results_eq(
  $$select slug from public.products where id = '93000000-0000-0000-0000-000000000001'$$,
  $$values ('bb03-product'::text)$$,
  'anon can read the published product'
);
select throws_ok(
  $$select count(*) from public.payment_quotes$$,
  '42501', null,
  'anon cannot read quotes'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"90000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;
select is(
  (select count(*)::bigint
   from public.products
   where id = '93000000-0000-0000-0000-000000000001'),
  1::bigint,
  'a non-admin sees only the same public catalog as anon'
);
select is(
  (select count(*)::bigint from public.payment_quotes)
    + (select count(*)::bigint from public.payment_attempts),
  0::bigint,
  'an authenticated non-admin cannot read quotes or attempts'
);
select throws_ok(
  $$insert into public.products (
      store_id, category_id, name, slug, description, base_price_cents
    ) values (
      '91000000-0000-0000-0000-000000000001',
      '92000000-0000-0000-0000-000000000001',
      'Forbidden', 'forbidden', 'Must not be inserted', 100000
    )$$,
  '42501', null,
  'an authenticated non-admin cannot mutate catalog data'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"90000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
select lives_ok(
  $$insert into public.products (
      store_id, category_id, name, slug, description, base_price_cents
    ) values (
      '91000000-0000-0000-0000-000000000001',
      '92000000-0000-0000-0000-000000000001',
      'Admin draft', 'admin-draft', 'Created by the store admin', 120000
    )$$,
  'an active store admin can create catalog data'
);
select is(
  (select count(*)::bigint from public.payment_quotes)
    + (select count(*)::bigint from public.payment_attempts),
  2::bigint,
  'an active store admin can read same-store quotes and attempts'
);
select throws_ok(
  $$select count(*) from public.payment_webhook_events$$,
  '42501', null,
  'store admins cannot inspect service-only webhook events'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values (
      'catalog',
      '91000000-0000-0000-0000-000000000001/bb03-image.webp'
    )$$,
  'an active store admin can upload a raster catalog object in the store folder'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"90000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values (
      'catalog',
      '91000000-0000-0000-0000-000000000001/outsider.webp'
    )$$,
  '42501', null,
  'a non-admin cannot upload into another store catalog folder'
);
reset role;

insert into public.payment_quotes (
  id, store_id, lines, subtotal_cents, discount_cents, delivery_cents,
  total_cents, currency, fulfillment_channel, expires_at, created_at
) values (
  '96000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',
  '[{"productId":"93000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb,
  100000, 0, 10000, 110000, 'ARS', 'delivery',
  now() - interval '90 days', now() - interval '91 days'
);

insert into public.payment_attempts (
  id, quote_id, store_id, amount_cents, currency,
  idempotency_key, external_reference, status, created_at, updated_at
) values (
  '97000000-0000-0000-0000-000000000001',
  '96000000-0000-0000-0000-000000000001',
  '91000000-0000-0000-0000-000000000001',
  110000, 'ARS', 'bb03-idempotency-key', 'bb03-external-reference',
  'rejected', now() - interval '91 days', now() - interval '91 days'
);

insert into public.payment_webhook_events (
  event_id, provider_payment_id, processing_status, received_at
) values (
  'bb03-event-1', 'bb03-payment-1', 'failed', now() - interval '91 days'
);

create temporary table purge_results (deleted_count bigint not null);
grant select, insert on table purge_results to service_role;

set local role service_role;
insert into purge_results (deleted_count)
select private.purge_expired_payment_data();
reset role;

select is(
  (select deleted_count from purge_results),
  3::bigint,
  'service_role can invoke the purge and it reports every expired payment row'
);
select is(
  (select count(*)::bigint from public.payment_quotes
   where id = '96000000-0000-0000-0000-000000000001'),
  0::bigint,
  'purge removes expired quotes'
);
select is(
  (select count(*)::bigint from public.payment_attempts
   where id = '97000000-0000-0000-0000-000000000001'),
  0::bigint,
  'purge removes expired attempts'
);
select is(
  (select count(*)::bigint from public.payment_webhook_events
   where event_id = 'bb03-event-1'),
  0::bigint,
  'purge removes expired webhook events'
);
select is(
  (select count(*)::bigint from public.payment_quotes
   where id = '96000000-0000-0000-0000-000000000002')
    +
  (select count(*)::bigint from public.payment_attempts
   where id = '97000000-0000-0000-0000-000000000002'),
  2::bigint,
  'purge preserves current quotes and attempts'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'catalog_objects_admin_insert'
      and with_check ilike '%storage.extension%'
  ),
  'catalog upload policy enforces raster file extensions'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname in ('public', 'storage')
      and coalesce(qual, '') || coalesce(with_check, '') ilike '%user_metadata%'
  ),
  'authorization never trusts user-editable metadata'
);

select * from finish();
rollback;
