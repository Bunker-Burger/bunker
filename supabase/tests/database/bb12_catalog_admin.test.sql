begin;

create extension if not exists pgtap with schema extensions;

select plan(14);

select has_column('public', 'products', 'sort_order', 'products carry a manual order');
select col_default_is('public', 'products', 'sort_order', 0, 'existing products keep order 0');
select has_column('public', 'product_images', 'focal_x', 'images carry a horizontal focal point');
select has_column('public', 'product_images', 'focal_y', 'images carry a vertical focal point');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '98120000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'admin@bb12.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '98120000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'outsider@bb12.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.stores (id, name, slug, whatsapp_e164, is_public)
values ('99120000-0000-0000-0000-000000000001', 'BB12 Store', 'bb12-store', '+5491100000012', true);

insert into public.admin_memberships (store_id, user_id, role)
values ('99120000-0000-0000-0000-000000000001', '98120000-0000-0000-0000-000000000001', 'admin');

insert into public.categories (id, store_id, name, slug, kind, sort_order, is_visible)
values
  ('99120000-0000-0000-0000-000000000101', '99120000-0000-0000-0000-000000000001', 'Bebidas', 'bebidas', 'drink', 10, true),
  ('99120000-0000-0000-0000-000000000102', '99120000-0000-0000-0000-000000000001', 'Otros', 'otros', 'other', 20, true);

insert into public.products (id, store_id, category_id, name, slug, description, base_price_cents)
values
  ('99120000-0000-0000-0000-000000000201', '99120000-0000-0000-0000-000000000001',
    '99120000-0000-0000-0000-000000000101', 'Agua', 'agua', 'Sin gas.', 100000),
  ('99120000-0000-0000-0000-000000000202', '99120000-0000-0000-0000-000000000001',
    '99120000-0000-0000-0000-000000000102', 'Combo', 'combo', 'Combo.', 100000);

select throws_ok(
  $$update public.products
    set contains_alcohol = true, alcohol_by_volume = 5, requires_age_verification = true
    where id = '99120000-0000-0000-0000-000000000201'$$,
  'BB012',
  null,
  'a drink cannot be marked as alcoholic'
);
select throws_ok(
  $$insert into public.products (
      store_id, category_id, name, slug, description, base_price_cents,
      contains_alcohol, alcohol_by_volume, requires_age_verification
    ) values (
      '99120000-0000-0000-0000-000000000001', '99120000-0000-0000-0000-000000000101',
      'Cerveza', 'cerveza', 'Rubia.', 100000, true, 5, true
    )$$,
  'BB012',
  null,
  'an alcoholic drink cannot be created'
);
select lives_ok(
  $$update public.products
    set contains_alcohol = true, alcohol_by_volume = 5, requires_age_verification = true
    where id = '99120000-0000-0000-0000-000000000202'$$,
  'the drink rule only applies to drink categories'
);
select throws_ok(
  $$update public.products set category_id = '99120000-0000-0000-0000-000000000101'
    where id = '99120000-0000-0000-0000-000000000202'$$,
  'BB012',
  null,
  'an alcoholic product cannot be moved into a drink category'
);

insert into public.product_images (id, product_id, storage_path, alt_text, is_primary)
values (
  '99120000-0000-0000-0000-000000000301', '99120000-0000-0000-0000-000000000201',
  '99120000-0000-0000-0000-000000000001/agua.webp', 'Botella de agua', true
);
select results_eq(
  $$select focal_x, focal_y from public.product_images
    where id = '99120000-0000-0000-0000-000000000301'$$,
  $$values (50::smallint, 50::smallint)$$,
  'a new image is centred by default'
);
select throws_ok(
  $$update public.product_images set focal_x = 101
    where id = '99120000-0000-0000-0000-000000000301'$$,
  '23514',
  null,
  'the focal point stays inside the image'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"98120000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;
update public.products set sort_order = 99 where id = '99120000-0000-0000-0000-000000000201';
update public.product_images set focal_x = 10 where id = '99120000-0000-0000-0000-000000000301';
reset role;
select results_eq(
  $$select sort_order from public.products where id = '99120000-0000-0000-0000-000000000201'$$,
  $$values (0)$$,
  'a non-admin cannot reorder products'
);
select results_eq(
  $$select focal_x from public.product_images where id = '99120000-0000-0000-0000-000000000301'$$,
  $$values (50::smallint)$$,
  'a non-admin cannot move the focal point'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"98120000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
select lives_ok(
  $$update public.products set sort_order = 20 where id = '99120000-0000-0000-0000-000000000201'$$,
  'an active admin reorders products'
);
select lives_ok(
  $$update public.product_images set focal_x = 30, focal_y = 70
    where id = '99120000-0000-0000-0000-000000000301'$$,
  'an active admin sets the focal point'
);
reset role;

select * from finish();
rollback;
