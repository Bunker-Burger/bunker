-- Development-only catalog fixtures for the cloud development project.
-- Idempotent: every row is upserted by id, so re-running refreshes the dataset.
-- Replace all commercial values (prices, WhatsApp, hours) before launch.
-- Rules: the four product types, only non-alcoholic drinks, no allergen content.

insert into public.stores (
  id, name, slug, whatsapp_e164, timezone, currency,
  is_open, is_public, delivery_fee_cents, business_hours
) values (
  '0199b2c8-40b0-7000-8000-000000000001',
  'Búnker Burger',
  'bunker-burger',
  '+5491100000000',
  'America/Argentina/Buenos_Aires',
  'ARS',
  false,
  true,
  120000,
  '{"notice":"Horario de demostración; configurar antes de producción"}'::jsonb
)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  is_public = excluded.is_public,
  delivery_fee_cents = excluded.delivery_fee_cents;

insert into public.categories (id, store_id, name, slug, kind, sort_order, is_visible)
values
  ('0199b2c8-40b0-7000-8000-000000000101', '0199b2c8-40b0-7000-8000-000000000001', 'Hamburguesas', 'hamburguesas', 'burger', 10, true),
  ('0199b2c8-40b0-7000-8000-000000000102', '0199b2c8-40b0-7000-8000-000000000001', 'Sándwiches', 'sandwiches', 'sandwich', 20, true),
  ('0199b2c8-40b0-7000-8000-000000000103', '0199b2c8-40b0-7000-8000-000000000001', 'Papas', 'papas', 'side', 30, true),
  ('0199b2c8-40b0-7000-8000-000000000104', '0199b2c8-40b0-7000-8000-000000000001', 'Bebidas', 'bebidas', 'drink', 40, true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  kind = excluded.kind,
  sort_order = excluded.sort_order,
  is_visible = excluded.is_visible;

-- Option groups and options first, so products can link valid defaults before publication checks.
insert into public.option_groups (
  id, store_id, name, selection_mode,
  minimum_selections, maximum_selections, is_required, sort_order,
  applicable_category_kinds
) values
  ('0199b2c8-40b0-7000-8000-000000000301', '0199b2c8-40b0-7000-8000-000000000001', 'Tamaño / medallones', 'single', 1, 1, true, 10, array['burger']::public.category_kind[]),
  ('0199b2c8-40b0-7000-8000-000000000302', '0199b2c8-40b0-7000-8000-000000000001', 'Extras', 'multiple', 0, 3, false, 20, array['burger', 'sandwich']::public.category_kind[]),
  ('0199b2c8-40b0-7000-8000-000000000303', '0199b2c8-40b0-7000-8000-000000000001', 'Tamaño de porción', 'single', 1, 1, true, 10, array['side']::public.category_kind[])
on conflict (id) do update set
  name = excluded.name,
  selection_mode = excluded.selection_mode,
  minimum_selections = excluded.minimum_selections,
  maximum_selections = excluded.maximum_selections,
  is_required = excluded.is_required,
  sort_order = excluded.sort_order,
  applicable_category_kinds = excluded.applicable_category_kinds;

insert into public.options (
  id, option_group_id, name, description, price_delta_cents, is_available, sort_order
) values
  ('0199b2c8-40b0-7000-8000-000000000401', '0199b2c8-40b0-7000-8000-000000000301', 'Doble (2× 100 g)', 'Incluido en el precio base', 0, true, 10),
  ('0199b2c8-40b0-7000-8000-000000000402', '0199b2c8-40b0-7000-8000-000000000301', 'Triple (3× 100 g)', 'Un medallón adicional', 160000, true, 20),
  ('0199b2c8-40b0-7000-8000-000000000403', '0199b2c8-40b0-7000-8000-000000000302', 'Extra bacon ahumado', '', 90000, true, 10),
  ('0199b2c8-40b0-7000-8000-000000000404', '0199b2c8-40b0-7000-8000-000000000302', 'Cheddar fundido doble', '', 80000, true, 20),
  ('0199b2c8-40b0-7000-8000-000000000405', '0199b2c8-40b0-7000-8000-000000000302', 'Huevo a la plancha', '', 60000, true, 30),
  ('0199b2c8-40b0-7000-8000-000000000406', '0199b2c8-40b0-7000-8000-000000000302', 'Pepinillos extra', 'Sin stock en la demo', 30000, false, 40),
  ('0199b2c8-40b0-7000-8000-000000000407', '0199b2c8-40b0-7000-8000-000000000303', 'Regular', 'Incluido en el precio base', 0, true, 10),
  ('0199b2c8-40b0-7000-8000-000000000408', '0199b2c8-40b0-7000-8000-000000000303', 'Grande', 'Porción para compartir', 120000, true, 20)
on conflict (id) do update set
  option_group_id = excluded.option_group_id,
  name = excluded.name,
  description = excluded.description,
  price_delta_cents = excluded.price_delta_cents,
  is_available = excluded.is_available,
  sort_order = excluded.sort_order;

insert into public.products (
  id, store_id, category_id, name, slug, description, base_price_cents,
  is_published, is_available, is_featured,
  contains_alcohol, alcohol_by_volume, requires_age_verification
) values
  ('0199b2c8-40b0-7000-8000-000000000201', '0199b2c8-40b0-7000-8000-000000000001', '0199b2c8-40b0-7000-8000-000000000101',
    'Smash Búnker Doble', 'smash-bunker-doble', 'Dos medallones smash, doble cheddar, bacon crocante y salsa Búnker.', 780000,
    true, true, true, false, 0, false),
  ('0199b2c8-40b0-7000-8000-000000000203', '0199b2c8-40b0-7000-8000-000000000001', '0199b2c8-40b0-7000-8000-000000000101',
    'Oklahoma Onion', 'oklahoma-onion', 'Cebolla ultrafina smashada, cheddar fundido, pepinillos y mostaza dijon.', 720000,
    true, true, false, false, 0, false),
  ('0199b2c8-40b0-7000-8000-000000000209', '0199b2c8-40b0-7000-8000-000000000001', '0199b2c8-40b0-7000-8000-000000000101',
    'Burger del mes', 'burger-del-mes', '', 0,
    false, true, false, false, 0, false),
  ('0199b2c8-40b0-7000-8000-000000000204', '0199b2c8-40b0-7000-8000-000000000001', '0199b2c8-40b0-7000-8000-000000000102',
    'Crispy Chicken Búnker', 'crispy-chicken-bunker', 'Pechuga extra crujiente, ensalada coleslaw fresca y pepinillo.', 680000,
    true, true, false, false, 0, false),
  ('0199b2c8-40b0-7000-8000-000000000205', '0199b2c8-40b0-7000-8000-000000000001', '0199b2c8-40b0-7000-8000-000000000102',
    'Pulled Pork Búnker', 'pulled-pork-bunker', 'Bondiola braseada lentamente, barbacoa Búnker y pan brioche.', 740000,
    true, false, false, false, 0, false),
  ('0199b2c8-40b0-7000-8000-000000000206', '0199b2c8-40b0-7000-8000-000000000001', '0199b2c8-40b0-7000-8000-000000000103',
    'Papas Búnker', 'papas-bunker', 'Papas doradas con bacon crocante y cheddar fundido.', 350000,
    true, true, false, false, 0, false),
  ('0199b2c8-40b0-7000-8000-000000000207', '0199b2c8-40b0-7000-8000-000000000001', '0199b2c8-40b0-7000-8000-000000000103',
    'Aros de cebolla', 'aros-de-cebolla', 'Rebozado extra crocante con dip de barbacoa.', 320000,
    true, false, false, false, 0, false),
  ('0199b2c8-40b0-7000-8000-000000000202', '0199b2c8-40b0-7000-8000-000000000001', '0199b2c8-40b0-7000-8000-000000000104',
    'Gaseosa lata 354 ml', 'gaseosa-lata', 'Bien fría para acompañar tu pedido. Sin alcohol.', 140000,
    true, true, false, false, 0, false),
  ('0199b2c8-40b0-7000-8000-000000000208', '0199b2c8-40b0-7000-8000-000000000001', '0199b2c8-40b0-7000-8000-000000000104',
    'Limonada de la casa', 'limonada-de-la-casa', 'Limón exprimido, menta fresca y hielo. Sin alcohol.', 240000,
    true, true, false, false, 0, false)
on conflict (id) do update set
  category_id = excluded.category_id,
  name = excluded.name,
  slug = excluded.slug,
  description = excluded.description,
  base_price_cents = excluded.base_price_cents,
  is_published = excluded.is_published,
  is_available = excluded.is_available,
  is_featured = excluded.is_featured,
  contains_alcohol = excluded.contains_alcohol,
  alcohol_by_volume = excluded.alcohol_by_volume,
  requires_age_verification = excluded.requires_age_verification;

insert into public.product_option_groups (
  product_id, option_group_id, store_id, default_option_ids, sort_order
) values
  ('0199b2c8-40b0-7000-8000-000000000201', '0199b2c8-40b0-7000-8000-000000000301', '0199b2c8-40b0-7000-8000-000000000001', array['0199b2c8-40b0-7000-8000-000000000401'::uuid], 10),
  ('0199b2c8-40b0-7000-8000-000000000201', '0199b2c8-40b0-7000-8000-000000000302', '0199b2c8-40b0-7000-8000-000000000001', array[]::uuid[], 20),
  ('0199b2c8-40b0-7000-8000-000000000203', '0199b2c8-40b0-7000-8000-000000000301', '0199b2c8-40b0-7000-8000-000000000001', array['0199b2c8-40b0-7000-8000-000000000401'::uuid], 10),
  ('0199b2c8-40b0-7000-8000-000000000203', '0199b2c8-40b0-7000-8000-000000000302', '0199b2c8-40b0-7000-8000-000000000001', array[]::uuid[], 20),
  ('0199b2c8-40b0-7000-8000-000000000206', '0199b2c8-40b0-7000-8000-000000000303', '0199b2c8-40b0-7000-8000-000000000001', array['0199b2c8-40b0-7000-8000-000000000407'::uuid], 10),
  ('0199b2c8-40b0-7000-8000-000000000207', '0199b2c8-40b0-7000-8000-000000000303', '0199b2c8-40b0-7000-8000-000000000001', array['0199b2c8-40b0-7000-8000-000000000407'::uuid], 10)
on conflict (product_id, option_group_id) do update set
  default_option_ids = excluded.default_option_ids,
  sort_order = excluded.sort_order;

insert into public.promotion_rules (
  id, store_id, name, slug, description, badge_text, promotion_type, priority, is_active,
  starts_at, ends_at, percent_off, applies_to_delivery, applies_to_pickup
) values
  ('0199b2c8-40b0-7000-8000-000000000501', '0199b2c8-40b0-7000-8000-000000000001',
    'Martes de Smash', 'martes-de-smash', 'Fixture de demostración: 15% en la Smash Búnker Doble los martes.', '15% OFF',
    'percent_off', 10, true, '2026-10-01 00:00:00-03', '2027-03-31 23:59:00-03', 15, true, true)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  description = excluded.description,
  badge_text = excluded.badge_text,
  priority = excluded.priority,
  is_active = excluded.is_active,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  percent_off = excluded.percent_off;

insert into public.promotion_rules (
  id, store_id, name, slug, description, badge_text, promotion_type, priority, is_active,
  starts_at, ends_at, applies_to_delivery, applies_to_pickup
) values
  ('0199b2c8-40b0-7000-8000-000000000502', '0199b2c8-40b0-7000-8000-000000000001',
    'Envío gratis (pausada)', 'envio-gratis', 'Fixture de demostración: promoción inactiva, solo visible en administración.', null,
    'free_delivery', 20, false, '2026-10-01 00:00:00-03', '2027-03-31 23:59:00-03', true, false)
on conflict (id) do update set
  name = excluded.name,
  slug = excluded.slug,
  description = excluded.description,
  priority = excluded.priority,
  is_active = excluded.is_active,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at;

insert into public.promotion_items (promotion_id, product_id, store_id, quantity)
values ('0199b2c8-40b0-7000-8000-000000000501', '0199b2c8-40b0-7000-8000-000000000201', '0199b2c8-40b0-7000-8000-000000000001', 1)
on conflict (promotion_id, product_id) do update set quantity = excluded.quantity;

insert into public.promotion_schedule (id, promotion_id, day_of_week, starts_at, ends_at)
values ('0199b2c8-40b0-7000-8000-000000000601', '0199b2c8-40b0-7000-8000-000000000501', 2, '18:00', '23:59')
on conflict (id) do update set day_of_week = excluded.day_of_week, starts_at = excluded.starts_at, ends_at = excluded.ends_at;

insert into public.store_payment_methods (
  store_id, method, display_name, public_instructions, is_enabled, sort_order
) values
  ('0199b2c8-40b0-7000-8000-000000000001', 'cash', 'Efectivo', 'Abonás al recibir o retirar.', true, 10),
  ('0199b2c8-40b0-7000-8000-000000000001', 'bank_transfer', 'Transferencia', 'Solicitá el alias actualizado por WhatsApp.', false, 20),
  ('0199b2c8-40b0-7000-8000-000000000001', 'mercado_pago', 'Mercado Pago', 'Disponible cuando la integración esté configurada.', false, 30)
on conflict (store_id, method) do nothing;
