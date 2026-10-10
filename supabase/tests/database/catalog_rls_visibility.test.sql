begin;

create extension if not exists pgtap with schema extensions;

-- What each signed-in role may read and write in the catalog. Written against the BB-03 policies
-- and kept identical by 20261010190000 (definer helpers): this file must pass before and after it.

select plan(8);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'admin-a@rls.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('a1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'admin-b@rls.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('a1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'outsider@rls.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

-- S1 public (admin A), S2 not public (admin B).
insert into public.stores (id, name, slug, whatsapp_e164, is_public) values
  ('a2000000-0000-0000-0000-000000000001', 'RLS Public', 'rls-public', '+5491100000101', true),
  ('a2000000-0000-0000-0000-000000000002', 'RLS Private', 'rls-private', '+5491100000102', false);
insert into public.admin_memberships (store_id, user_id, role) values
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'owner'),
  ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002', 'owner');

insert into public.categories (id, store_id, name, slug, kind, sort_order, is_visible) values
  ('a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'Visible', 'visible', 'burger', 10, true),
  ('a3000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'Hidden', 'hidden', 'other', 20, false),
  ('a3000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000002', 'Private', 'private', 'burger', 10, true);

-- P1 published/visible, P2 draft, P3 published in a hidden category, P4 in the private store.
insert into public.products (id, store_id, category_id, name, slug, description, base_price_cents, is_published) values
  ('a4000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'P1', 'p1', 'Publicado.', 100000, true),
  ('a4000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000001', 'P2', 'p2', 'Borrador.', 100000, false),
  ('a4000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000002', 'P3', 'p3', 'Oculto.', 100000, true),
  ('a4000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000003', 'P4', 'p4', 'Privado.', 100000, true);

insert into public.product_images (id, product_id, storage_path, alt_text, is_primary) values
  ('a5000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001/p1.webp', 'P1', true),
  ('a5000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001/p2.webp', 'P2', true),
  ('a5000000-0000-0000-0000-000000000003', 'a4000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001/p3.webp', 'P3', true),
  ('a5000000-0000-0000-0000-000000000004', 'a4000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000002/p4.webp', 'P4', true);

-- G1 linked to P1, G2 only to the draft P2, G3 unlinked, G4 linked to P4.
insert into public.option_groups (id, store_id, name, selection_mode, minimum_selections, maximum_selections, is_required) values
  ('a6000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'G1', 'multiple', 0, 3, false),
  ('a6000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'G2', 'multiple', 0, 3, false),
  ('a6000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'G3', 'multiple', 0, 3, false),
  ('a6000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000002', 'G4', 'multiple', 0, 3, false);
insert into public.options (id, option_group_id, name, is_available) values
  ('a7000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', 'O1', true),
  ('a7000000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-000000000001', 'O2', false),
  ('a7000000-0000-0000-0000-000000000003', 'a6000000-0000-0000-0000-000000000002', 'O3', true),
  ('a7000000-0000-0000-0000-000000000004', 'a6000000-0000-0000-0000-000000000003', 'O4', true),
  ('a7000000-0000-0000-0000-000000000005', 'a6000000-0000-0000-0000-000000000004', 'O5', true);
insert into public.product_option_groups (product_id, option_group_id, store_id) values
  ('a4000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001'),
  ('a4000000-0000-0000-0000-000000000002', 'a6000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001'),
  ('a4000000-0000-0000-0000-000000000004', 'a6000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000002');

-- R1 running, R2 inactive (S1); R3 running in the private store.
insert into public.promotion_rules (id, store_id, name, slug, promotion_type, priority, is_active, starts_at, ends_at, percent_off) values
  ('a8000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'R1', 'r1', 'percent_off', 1, true, now() - interval '1 day', now() + interval '1 day', 10),
  ('a8000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'R2', 'r2', 'percent_off', 2, false, now() - interval '1 day', now() + interval '1 day', 10),
  ('a8000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000002', 'R3', 'r3', 'percent_off', 1, true, now() - interval '1 day', now() + interval '1 day', 10);
insert into public.promotion_items (promotion_id, product_id, store_id) values
  ('a8000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001'),
  ('a8000000-0000-0000-0000-000000000002', 'a4000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001'),
  ('a8000000-0000-0000-0000-000000000003', 'a4000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000002');
insert into public.promotion_schedule (promotion_id, day_of_week, starts_at, ends_at) values
  ('a8000000-0000-0000-0000-000000000001', 1, '10:00', '12:00'),
  ('a8000000-0000-0000-0000-000000000002', 1, '10:00', '12:00'),
  ('a8000000-0000-0000-0000-000000000003', 1, '10:00', '12:00');

insert into public.store_payment_methods (store_id, method, display_name, is_enabled) values
  ('a2000000-0000-0000-0000-000000000001', 'cash', 'Efectivo', true),
  ('a2000000-0000-0000-0000-000000000001', 'bank_transfer', 'Transferencia', false),
  ('a2000000-0000-0000-0000-000000000002', 'cash', 'Efectivo', true);
insert into public.store_business_hours (store_id, day_of_week, opens_at, closes_at) values
  ('a2000000-0000-0000-0000-000000000001', 1, '19:00', '23:00'),
  ('a2000000-0000-0000-0000-000000000002', 1, '19:00', '23:00');

-- One row of counts per role, restricted to the fixture stores.
create temp table rls_counts (who text primary key, counts bigint[] not null);
grant insert, select on rls_counts to authenticated;

create function pg_temp.count_visible(who text) returns void language sql as $$
  insert into rls_counts select who, array[
    (select count(*) from public.categories where store_id in ('a2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002')),
    (select count(*) from public.products where store_id in ('a2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002')),
    (select count(*) from public.product_images where id::text like 'a5000000-%'),
    (select count(*) from public.product_option_groups where store_id in ('a2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002')),
    (select count(*) from public.option_groups where store_id in ('a2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002')),
    (select count(*) from public.options where id::text like 'a7000000-%'),
    (select count(*) from public.promotion_rules where store_id in ('a2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002')),
    (select count(*) from public.promotion_items where store_id in ('a2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002')),
    (select count(*) from public.promotion_schedule where promotion_id::text like 'a8000000-%'),
    (select count(*) from public.store_payment_methods where store_id in ('a2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002')),
    (select count(*) from public.store_business_hours where store_id in ('a2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002'))
  ];
$$;
grant execute on function pg_temp.count_visible(text) to authenticated;

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.count_visible('outsider');
reset role;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.count_visible('admin A');
reset role;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select pg_temp.count_visible('admin B');
reset role;

-- Order: categories, products, images, product links, option groups, options, promotions,
-- promotion items, promotion schedule, payment methods, business hours.
select results_eq(
  $$select counts from rls_counts where who = 'outsider'$$,
  $$values (array[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]::bigint[])$$,
  'a signed-in non-admin reads only the public catalog (visible, published, available, enabled, running)'
);
select results_eq(
  $$select counts from rls_counts where who = 'admin A'$$,
  $$values (array[2, 3, 3, 2, 3, 4, 2, 2, 2, 2, 1]::bigint[])$$,
  'an admin reads everything of their store (drafts, hidden, unavailable, inactive, unlinked) and nothing private of others'
);
select results_eq(
  $$select counts from rls_counts where who = 'admin B'$$,
  $$values (array[2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2]::bigint[])$$,
  'an admin of a private store reads their own catalog plus only the public part of another store'
);

-- Writes whose policies used to join tables with their own RLS.
create temp table rls_writes (write text primary key, row_count bigint not null);
grant insert, select on rls_writes to authenticated;

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select lives_ok(
  $$insert into public.product_images (product_id, storage_path, alt_text, sort_order)
    values ('a4000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001/p2-b.webp', 'P2 b', 1)$$,
  'an admin adds an image to a product of their store'
);
with changed as (update public.options set description = 'A' where id = 'a7000000-0000-0000-0000-000000000002' returning 1)
insert into rls_writes select 'admin A updates own option', count(*) from changed;
select lives_ok(
  $$insert into public.promotion_schedule (promotion_id, day_of_week, starts_at, ends_at)
    values ('a8000000-0000-0000-0000-000000000002', 2, '10:00', '12:00')$$,
  'an admin schedules a promotion of their store'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$insert into public.product_images (product_id, storage_path, alt_text, sort_order)
    values ('a4000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001/p1-b.webp', 'P1 b', 1)$$,
  '42501', null,
  'an admin of another store cannot add images to this store''s products'
);
with changed as (update public.options set description = 'B' where id = 'a7000000-0000-0000-0000-000000000001' returning 1)
insert into rls_writes select 'admin B updates foreign option', count(*) from changed;
select throws_ok(
  $$insert into public.promotion_schedule (promotion_id, day_of_week, starts_at, ends_at)
    values ('a8000000-0000-0000-0000-000000000001', 3, '10:00', '12:00')$$,
  '42501', null,
  'an admin of another store cannot schedule this store''s promotions'
);
reset role;

select results_eq(
  $$select write, row_count from rls_writes order by write$$,
  $$values ('admin A updates own option'::text, 1::bigint), ('admin B updates foreign option'::text, 0::bigint)$$,
  'only the store''s admin changes its options (1 row), another store''s admin changes none'
);

select * from finish();
rollback;
