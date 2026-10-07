-- Development-only catalog fixtures. Replace all commercial values before launch.
insert into public.stores (
  id, name, slug, whatsapp_e164, timezone, currency,
  is_open, is_public, delivery_fee_cents, business_hours
) values (
  '0199b2c8-40b0-7000-8000-000000000001',
  'Bunker Burger',
  'bunker-burger',
  '+5491100000000',
  'America/Argentina/Buenos_Aires',
  'ARS',
  false,
  true,
  120000,
  '{"notice":"Horario de demostración; configurar antes de producción"}'::jsonb
)
on conflict (id) do nothing;

insert into public.categories (id, store_id, name, slug, kind, sort_order, is_visible)
values
  ('0199b2c8-40b0-7000-8000-000000000101', '0199b2c8-40b0-7000-8000-000000000001', 'Hamburguesas', 'hamburguesas', 'burger', 10, true),
  ('0199b2c8-40b0-7000-8000-000000000102', '0199b2c8-40b0-7000-8000-000000000001', 'Sándwiches', 'sandwiches', 'sandwich', 20, true),
  ('0199b2c8-40b0-7000-8000-000000000103', '0199b2c8-40b0-7000-8000-000000000001', 'Papas', 'papas', 'side', 30, true),
  ('0199b2c8-40b0-7000-8000-000000000104', '0199b2c8-40b0-7000-8000-000000000001', 'Bebidas', 'bebidas', 'drink', 40, true)
on conflict (id) do nothing;

insert into public.products (
  id, store_id, category_id, name, slug, description, base_price_cents,
  is_published, is_available, is_featured,
  contains_alcohol, alcohol_by_volume, requires_age_verification
) values
  (
    '0199b2c8-40b0-7000-8000-000000000201',
    '0199b2c8-40b0-7000-8000-000000000001',
    '0199b2c8-40b0-7000-8000-000000000101',
    'Smash Bunker Doble',
    'smash-bunker-doble',
    'Fixture de demostración: doble medallón smash con cheddar.',
    960000,
    true,
    true,
    true,
    false,
    0,
    false
  ),
  (
    '0199b2c8-40b0-7000-8000-000000000202',
    '0199b2c8-40b0-7000-8000-000000000001',
    '0199b2c8-40b0-7000-8000-000000000104',
    'Gaseosa lata',
    'gaseosa-lata',
    'Fixture de demostración: bebida sin alcohol.',
    140000,
    true,
    true,
    false,
    false,
    0,
    false
  )
on conflict (id) do nothing;

insert into public.option_groups (
  id, store_id, name, selection_mode,
  minimum_selections, maximum_selections, is_required, sort_order
) values (
  '0199b2c8-40b0-7000-8000-000000000301',
  '0199b2c8-40b0-7000-8000-000000000001',
  'Medallones',
  'single',
  1,
  1,
  true,
  10
)
on conflict (id) do nothing;

insert into public.options (
  id, option_group_id, name, description, price_delta_cents, is_available, sort_order
) values
  ('0199b2c8-40b0-7000-8000-000000000401', '0199b2c8-40b0-7000-8000-000000000301', 'Simple', 'Incluido en el precio base', 0, true, 10),
  ('0199b2c8-40b0-7000-8000-000000000402', '0199b2c8-40b0-7000-8000-000000000301', 'Doble', 'Un medallón adicional', 180000, true, 20)
on conflict (id) do nothing;

insert into public.product_option_groups (
  product_id, option_group_id, store_id, default_option_ids, sort_order
) values (
  '0199b2c8-40b0-7000-8000-000000000201',
  '0199b2c8-40b0-7000-8000-000000000301',
  '0199b2c8-40b0-7000-8000-000000000001',
  array['0199b2c8-40b0-7000-8000-000000000401'::uuid],
  10
)
on conflict (product_id, option_group_id) do update set
  default_option_ids = excluded.default_option_ids,
  sort_order = excluded.sort_order;

insert into public.store_payment_methods (
  store_id, method, display_name, public_instructions, is_enabled, sort_order
) values
  ('0199b2c8-40b0-7000-8000-000000000001', 'cash', 'Efectivo', 'Abonás al recibir o retirar.', true, 10),
  ('0199b2c8-40b0-7000-8000-000000000001', 'bank_transfer', 'Transferencia', 'Solicitá el alias actualizado por WhatsApp.', false, 20),
  ('0199b2c8-40b0-7000-8000-000000000001', 'mercado_pago', 'Mercado Pago', 'Disponible cuando la integración esté configurada.', false, 30)
on conflict (store_id, method) do nothing;
