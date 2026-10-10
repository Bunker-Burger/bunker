begin;

create extension if not exists pgtap with schema extensions;

select plan(39);

select has_table('public', 'stores', 'stores exists');
select has_table('public', 'admin_memberships', 'admin_memberships exists');
select has_table('public', 'categories', 'categories exists');
select has_table('public', 'products', 'products exists');
select has_table('public', 'product_images', 'product_images exists');
select has_table('public', 'option_groups', 'option_groups exists');
select has_table('public', 'options', 'options exists');
select has_table('public', 'product_option_groups', 'product_option_groups exists');
select has_table('public', 'promotion_rules', 'promotion_rules exists');
select has_table('public', 'promotion_items', 'promotion_items exists');
select has_table('public', 'promotion_schedule', 'promotion_schedule exists');
select has_table('public', 'store_payment_methods', 'store_payment_methods exists');
select has_table('public', 'payment_attempts', 'payment_attempts exists');

select col_type_is('public', 'products', 'base_price_cents', 'bigint', 'product money uses bigint cents');
select col_type_is('public', 'options', 'price_delta_cents', 'bigint', 'option money uses bigint cents');
select col_type_is('public', 'stores', 'delivery_fee_cents', 'bigint', 'delivery money uses bigint cents');
select col_type_is('public', 'payment_attempts', 'amount_cents', 'bigint', 'payment money uses bigint cents');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.products'::regclass),
  'products has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.payment_attempts'::regclass),
  'payment_attempts has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.products', 'INSERT'),
  'anon cannot insert products at the grant layer'
);
select ok(
  not has_table_privilege('anon', 'public.payment_attempts', 'SELECT'),
  'anon cannot read Mercado Pago attempts at the grant layer'
);
select ok(
  not has_table_privilege('authenticated', 'public.payment_attempts', 'INSERT'),
  'browser-authenticated users cannot create Mercado Pago attempts'
);
select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and coalesce(qual, '') || coalesce(with_check, '') ilike '%user_metadata%'
  ),
  'authorization policies never use user_metadata'
);

select is(
  (select public from storage.buckets where id = 'catalog'),
  true,
  'catalog bucket is public'
);
select is(
  (select file_size_limit from storage.buckets where id = 'catalog'),
  5242880::bigint,
  'catalog bucket limits files to 5 MiB'
);
select ok(
  (select allowed_mime_types <@ array['image/jpeg', 'image/png', 'image/webp', 'image/avif']::text[]
     and not ('image/svg+xml' = any(allowed_mime_types))
   from storage.buckets where id = 'catalog'),
  'catalog bucket allows raster images and excludes SVG'
);

insert into public.stores (
  id, name, slug, whatsapp_e164, timezone, currency, delivery_fee_cents, is_public
) values (
  '10000000-0000-0000-0000-000000000001', 'Bunker Test', 'bunker-test',
  '+5491100000000', 'America/Argentina/Buenos_Aires', 'ARS', 120000, true
);

insert into public.categories (id, store_id, name, slug, kind, sort_order, is_visible)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Hamburguesas', 'hamburguesas', 'burger', 10, true),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Oculta', 'oculta', 'other', 20, false),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'Bebidas', 'bebidas', 'drink', 30, true);

insert into public.products (
  id, store_id, category_id, name, slug, description, base_price_cents,
  is_published, is_available, contains_alcohol, alcohol_by_volume, requires_age_verification
) values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Visible', 'visible', 'Producto visible', 100000, true, true, false, 0, false),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'Oculto', 'oculto', 'Producto oculto', 100000, true, true, false, 0, false),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'Gaseosa', 'gaseosa', 'Bebida sin alcohol', 100000, true, true, false, 0, false),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Agotado', 'agotado', 'Producto publicado sin stock', 100000, true, false, false, 0, false);

set local role anon;
select results_eq(
  $$select slug from public.products
    where store_id = '10000000-0000-0000-0000-000000000001'
    order by slug$$,
  $$values ('agotado'::text), ('gaseosa'::text), ('visible'::text)$$,
  'anon reads published products, including unavailable items, in visible categories of public stores'
);
select throws_ok(
  $$select count(*) from public.payment_attempts$$,
  '42501',
  null,
  'anon has no payment-attempt read path'
);
reset role;

select throws_ok(
  $$insert into public.products (
      store_id, category_id, name, slug, description, base_price_cents, is_published
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      'Inválido', 'invalido', '', 0, true
    )$$,
  '23514',
  null,
  'published products require valid public content and a positive price'
);
select throws_ok(
  $$insert into public.products (
      store_id, category_id, name, slug, description, base_price_cents,
      contains_alcohol, alcohol_by_volume, requires_age_verification
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000003',
      'Sin alcohol inválida', 'sin-alcohol-invalida', 'Bebida', 100000,
      false, 1.0, false
    )$$,
  '23514',
  null,
  'non-alcoholic products cannot carry ABV'
);
-- Outside a drink category: in drinks the BB-12 trigger rejects alcohol first (BB012).
select throws_ok(
  $$insert into public.products (
      store_id, category_id, name, slug, description, base_price_cents,
      contains_alcohol, alcohol_by_volume, requires_age_verification
    ) values (
      '10000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002',
      'Alcohol sin control', 'alcohol-sin-control', 'Bebida', 100000,
      true, 5.0, false
    )$$,
  '23514',
  null,
  'alcoholic products require age verification'
);

insert into public.promotion_rules (
  id, store_id, name, slug, promotion_type, priority, is_active,
  starts_at, ends_at, percent_off
) values (
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Diez por ciento', 'diez-por-ciento', 'percent_off', 10, false,
  now(), now() + interval '1 day', 10
);
select throws_ok(
  $$insert into public.promotion_rules (
      store_id, name, slug, promotion_type, priority, is_active,
      starts_at, ends_at, percent_off
    ) values (
      '10000000-0000-0000-0000-000000000001',
      'Misma prioridad', 'misma-prioridad', 'percent_off', 10, false,
      now(), now() + interval '1 day', 15
    )$$,
  '23505',
  null,
  'promotion priority is unique per store'
);

select has_function('private', 'purge_expired_payment_data', array[]::text[], 'payment retention purge function exists');
select ok(
  not has_function_privilege('anon', 'private.purge_expired_payment_data()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.purge_expired_payment_data()', 'EXECUTE'),
  'payment purge is not callable by browser roles'
);
select is(
  obj_description('private.purge_expired_payment_data()'::regprocedure, 'pg_proc'),
  'Deletes quotes, Mercado Pago attempts, and webhook events older than the 90-day operational retention period.',
  'payment retention policy is documented on the purge function'
);

insert into public.payment_quotes (
  id, store_id, lines, subtotal_cents, discount_cents, delivery_cents,
  total_cents, currency, fulfillment_channel, expires_at, created_at
) values (
  '51000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '[{"productId":"30000000-0000-0000-0000-000000000001","quantity":1}]'::jsonb,
  100000, 0, 0, 100000, 'ARS', 'pickup',
  now() - interval '90 days', now() - interval '91 days'
);
insert into public.payment_attempts (
  id, quote_id, store_id, amount_cents, currency, idempotency_key, external_reference,
  status, created_at, updated_at
) values (
  '50000000-0000-0000-0000-000000000001',
  '51000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001', 100000, 'ARS',
  'old-idempotency-key', 'old-external-reference', 'rejected',
  now() - interval '91 days', now() - interval '91 days'
);
select is(private.purge_expired_payment_data(), 2::bigint, 'purge removes payment data older than 90 days');
select is(
  (select count(*)::bigint from public.payment_attempts where id = '50000000-0000-0000-0000-000000000001'),
  0::bigint,
  'purged payment attempt is gone'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and cmd = 'INSERT' and roles @> array['authenticated'::name]
      and with_check ilike '%admin_memberships%'
  ),
  'catalog uploads require an admin membership'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and cmd = 'UPDATE' and roles @> array['authenticated'::name]
      and qual ilike '%admin_memberships%' and with_check ilike '%admin_memberships%'
  ),
  'catalog replacements require admin membership before and after update'
);

select * from finish();
rollback;
