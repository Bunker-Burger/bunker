begin;

create extension if not exists pgtap with schema extensions;

select plan(40);

-- Who can call the atomic promotion writes.
select ok(
  not has_function_privilege('anon', 'public.admin_save_promotion(uuid, uuid, jsonb, jsonb, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.admin_move_promotion(uuid, uuid, text)', 'execute'),
  'anonymous visitors cannot call the promotion writes'
);
select ok(
  has_function_privilege('authenticated', 'public.admin_save_promotion(uuid, uuid, jsonb, jsonb, jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_move_promotion(uuid, uuid, text)', 'execute'),
  'signed-in sessions can call them (RLS decides what they touch)'
);
select ok(
  not has_function_privilege('service_role', 'public.admin_save_promotion(uuid, uuid, jsonb, jsonb, jsonb)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_move_promotion(uuid, uuid, text)', 'execute'),
  'the service role does not call them'
);
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('admin_save_promotion', 'admin_move_promotion') and p.prosecdef),
  0,
  'both run as the caller (no SECURITY DEFINER)'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('98130000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'admin@bb13.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('98130000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'other@bb13.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('98130000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'both@bb13.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.stores (id, name, slug, whatsapp_e164, is_public) values
  ('99130000-0000-0000-0000-000000000001', 'BB13 Store', 'bb13-store', '+5491100000013', true),
  ('99130000-0000-0000-0000-000000000002', 'BB13 Other', 'bb13-other', '+5491100000014', true);

insert into public.admin_memberships (store_id, user_id, role) values
  ('99130000-0000-0000-0000-000000000001', '98130000-0000-0000-0000-000000000001', 'admin'),
  ('99130000-0000-0000-0000-000000000002', '98130000-0000-0000-0000-000000000002', 'admin'),
  ('99130000-0000-0000-0000-000000000001', '98130000-0000-0000-0000-000000000003', 'admin'),
  ('99130000-0000-0000-0000-000000000002', '98130000-0000-0000-0000-000000000003', 'admin');

insert into public.categories (id, store_id, name, slug, kind, sort_order, is_visible) values
  ('99130000-0000-0000-0000-000000000101', '99130000-0000-0000-0000-000000000001', 'Burgers', 'burgers', 'burger', 10, true),
  ('99130000-0000-0000-0000-000000000102', '99130000-0000-0000-0000-000000000002', 'Burgers', 'burgers', 'burger', 10, true);

insert into public.products (id, store_id, category_id, name, slug, description, base_price_cents) values
  ('99130000-0000-0000-0000-000000000201', '99130000-0000-0000-0000-000000000001',
    '99130000-0000-0000-0000-000000000101', 'Clásica', 'clasica', 'Clásica.', 1000000),
  ('99130000-0000-0000-0000-000000000202', '99130000-0000-0000-0000-000000000001',
    '99130000-0000-0000-0000-000000000101', 'Doble', 'doble', 'Doble.', 1500000),
  ('99130000-0000-0000-0000-000000000203', '99130000-0000-0000-0000-000000000002',
    '99130000-0000-0000-0000-000000000102', 'Ajena', 'ajena', 'De otra tienda.', 900000);

-- X (10) < Y (20) < Z (30): Z applies first. W belongs to the other store.
insert into public.promotion_rules (
  id, store_id, name, slug, promotion_type, percent_off, priority, is_active, starts_at, ends_at
) values
  ('99130000-0000-0000-0000-000000000301', '99130000-0000-0000-0000-000000000001', 'Promo X', 'promo-x',
    'percent_off', 10, 10, true, now() - interval '1 day', now() + interval '30 days'),
  ('99130000-0000-0000-0000-000000000302', '99130000-0000-0000-0000-000000000001', 'Promo Y', 'promo-y',
    'percent_off', 20, 20, true, now() - interval '1 day', now() + interval '30 days'),
  ('99130000-0000-0000-0000-000000000303', '99130000-0000-0000-0000-000000000001', 'Promo Z', 'promo-z',
    'percent_off', 30, 30, false, now() - interval '1 day', now() + interval '30 days'),
  ('99130000-0000-0000-0000-000000000304', '99130000-0000-0000-0000-000000000002', 'Promo W', 'promo-w',
    'percent_off', 40, 5, true, now() - interval '1 day', now() + interval '30 days');
insert into public.promotion_items (promotion_id, product_id, store_id, quantity) values
  ('99130000-0000-0000-0000-000000000301', '99130000-0000-0000-0000-000000000201', '99130000-0000-0000-0000-000000000001', 1);
insert into public.promotion_schedule (promotion_id, day_of_week, starts_at, ends_at) values
  ('99130000-0000-0000-0000-000000000301', 5, '19:00', '23:00');

create temp view bb13_priorities as
  select name, priority from public.promotion_rules
  where store_id in ('99130000-0000-0000-0000-000000000001', '99130000-0000-0000-0000-000000000002');
grant select on bb13_priorities to authenticated, anon;

-- ---------------------------------------------------------------------------------------------
-- Reorder as the store's admin

select set_config('request.jwt.claims', '{"sub":"98130000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select is(
  public.admin_move_promotion('99130000-0000-0000-0000-000000000001', '99130000-0000-0000-0000-000000000301', 'up'),
  true,
  'moving X up reports a move'
);
reset role;
select results_eq(
  'select name, priority::integer from bb13_priorities order by name',
  $$values ('Promo W', 5), ('Promo X', 20), ('Promo Y', 10), ('Promo Z', 30)$$,
  'X and Y swapped priorities; Z, the other store and no free value are left behind'
);
select is(
  (select count(*)::integer from pg_locks l
   where l.locktype = 'advisory' and l.pid = pg_backend_pid()
     and l.classid::bigint = (hashtextextended('promotion_rules:99130000-0000-0000-0000-000000000001', 0) >> 32) & 4294967295
     and l.objid::bigint = hashtextextended('promotion_rules:99130000-0000-0000-0000-000000000001', 0) & 4294967295),
  1,
  'the move holds the store''s promotion lock until the transaction ends'
);

set local role authenticated;
select is(
  public.admin_move_promotion('99130000-0000-0000-0000-000000000001', '99130000-0000-0000-0000-000000000303', 'up'),
  false,
  'the first promotion cannot move up'
);
select is(
  public.admin_move_promotion('99130000-0000-0000-0000-000000000001', '99130000-0000-0000-0000-000000000302', 'down'),
  false,
  'the last promotion cannot move down'
);
select is(
  public.admin_move_promotion('99130000-0000-0000-0000-000000000001', '99130000-0000-0000-0000-000000000301', 'down'),
  true,
  'moving X down reports a move'
);
reset role;
select results_eq(
  'select name, priority::integer from bb13_priorities order by name',
  $$values ('Promo W', 5), ('Promo X', 10), ('Promo Y', 20), ('Promo Z', 30)$$,
  'edges change nothing and moving back restores the original order'
);

set local role authenticated;
select throws_ok(
  $$select public.admin_move_promotion('99130000-0000-0000-0000-000000000001', '99130000-0000-0000-0000-000000000304', 'up')$$,
  'P0002', null,
  'a promotion of another store is not found in this one'
);
select throws_ok(
  $$select public.admin_move_promotion('99130000-0000-0000-0000-000000000002', '99130000-0000-0000-0000-000000000304', 'up')$$,
  '42501', null,
  'naming the other store does not help: it is not administered by this session'
);
select throws_ok(
  $$select public.admin_move_promotion('99130000-0000-0000-0000-000000000001', '99130000-0000-0000-0000-000000000301', 'sideways')$$,
  '22023', null,
  'an unknown direction is rejected'
);

select set_config('request.jwt.claims', '{"sub":"98130000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$select public.admin_move_promotion('99130000-0000-0000-0000-000000000001', '99130000-0000-0000-0000-000000000301', 'up')$$,
  '42501', null,
  'an admin of another store cannot reorder this one'
);
reset role;
select results_eq(
  'select name, priority::integer from bb13_priorities order by name',
  $$values ('Promo W', 5), ('Promo X', 10), ('Promo Y', 20), ('Promo Z', 30)$$,
  'rejected moves changed nothing'
);

-- A failure at any of the three updates undoes the whole move. Moving X up writes X=31 (free
-- value), then Y=10, then X=20; the trigger fails the write of the chosen value.
create function public.bb13_fail_on_priority() returns trigger language plpgsql as $$
begin
  if new.priority = nullif(current_setting('bb13.fail_priority', true), '')::integer then
    raise exception using errcode = 'BB999', message = 'injected failure';
  end if;
  return new;
end;
$$;
create trigger bb13_fail_on_priority before update of priority on public.promotion_rules
for each row execute function public.bb13_fail_on_priority();

select set_config('request.jwt.claims', '{"sub":"98130000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select set_config('bb13.fail_priority', '31', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_move_promotion('99130000-0000-0000-0000-000000000001', '99130000-0000-0000-0000-000000000301', 'up')$$,
  'BB999', null,
  'a failure parking X on the free value fails the move'
);
reset role;
select results_eq(
  'select name, priority::integer from bb13_priorities order by name',
  $$values ('Promo W', 5), ('Promo X', 10), ('Promo Y', 20), ('Promo Z', 30)$$,
  'after a failed first step nothing moved'
);

select set_config('bb13.fail_priority', '10', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_move_promotion('99130000-0000-0000-0000-000000000001', '99130000-0000-0000-0000-000000000301', 'up')$$,
  'BB999', null,
  'a failure moving the neighbour fails the move'
);
reset role;
select results_eq(
  'select name, priority::integer from bb13_priorities order by name',
  $$values ('Promo W', 5), ('Promo X', 10), ('Promo Y', 20), ('Promo Z', 30)$$,
  'after a failed second step X is not left on the free value'
);

select set_config('bb13.fail_priority', '20', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_move_promotion('99130000-0000-0000-0000-000000000001', '99130000-0000-0000-0000-000000000301', 'up')$$,
  'BB999', null,
  'a failure placing X fails the move'
);
reset role;
select results_eq(
  'select name, priority::integer from bb13_priorities order by name',
  $$values ('Promo W', 5), ('Promo X', 10), ('Promo Y', 20), ('Promo Z', 30)$$,
  'after a failed third step both keep their original priorities'
);

-- What a quote reads (public, active promotions by priority) is the original order.
set local role anon;
select results_eq(
  $$select name from public.promotion_rules
    where store_id = '99130000-0000-0000-0000-000000000001' order by priority desc$$,
  $$values ('Promo Y'), ('Promo X')$$,
  'a quote still applies Y before X after the failed moves'
);
reset role;
drop trigger bb13_fail_on_priority on public.promotion_rules;
select set_config('bb13.fail_priority', '', true);

-- ---------------------------------------------------------------------------------------------
-- Save as the store's admin

set local role authenticated;
select ok(
  public.admin_save_promotion(
    '99130000-0000-0000-0000-000000000001', null,
    jsonb_build_object(
      'name', 'Combo nuevo', 'slug', 'combo-nuevo', 'description', '', 'badge_text', 'Combo',
      'promotion_type', 'fixed_price', 'fixed_price_cents', '123456789012',
      'applies_to_delivery', true, 'applies_to_pickup', false,
      'starts_at', '2027-01-01T03:00:00Z', 'ends_at', '2027-02-01T03:00:00Z', 'is_active', true
    ),
    '[{"product_id":"99130000-0000-0000-0000-000000000201","quantity":1},{"product_id":"99130000-0000-0000-0000-000000000202","quantity":2}]',
    '[{"day_of_week":5,"starts_at":"19:00","ends_at":"23:30"}]'
  ) is not null,
  'a new promotion is created with its products and windows'
);
reset role;
select results_eq(
  $$select priority::integer, promotion_type::text, fixed_price_cents, applies_to_delivery, applies_to_pickup, is_active, badge_text
    from public.promotion_rules where slug = 'combo-nuevo'$$,
  $$values (31, 'fixed_price', 123456789012::bigint, true, false, true, 'Combo')$$,
  'it takes the next priority and keeps the exact price in cents'
);
select results_eq(
  $$select i.product_id::text, i.quantity::integer from public.promotion_items i
    join public.promotion_rules r on r.id = i.promotion_id where r.slug = 'combo-nuevo'$$,
  $$values ('99130000-0000-0000-0000-000000000201', 1), ('99130000-0000-0000-0000-000000000202', 2)$$,
  'its products are stored'
);
select results_eq(
  $$select s.day_of_week::integer, s.starts_at, s.ends_at from public.promotion_schedule s
    join public.promotion_rules r on r.id = s.promotion_id where r.slug = 'combo-nuevo'$$,
  $$values (5, '19:00'::time, '23:30'::time)$$,
  'its windows are stored'
);

set local role authenticated;
select is(
  public.admin_save_promotion(
    '99130000-0000-0000-0000-000000000001', '99130000-0000-0000-0000-000000000301',
    jsonb_build_object(
      'name', 'Promo X editada', 'slug', 'promo-x', 'description', 'Nueva.',
      'promotion_type', 'buy_x_get_y', 'buy_quantity', 2, 'get_quantity', 1,
      'applies_to_delivery', true, 'applies_to_pickup', true,
      'starts_at', '2027-01-01T03:00:00Z', 'ends_at', '2027-02-01T03:00:00Z', 'is_active', true
    ),
    '[{"product_id":"99130000-0000-0000-0000-000000000202","quantity":3}]',
    '[]'
  ),
  '99130000-0000-0000-0000-000000000301'::uuid,
  'an existing promotion is updated in place'
);
reset role;
select results_eq(
  $$select r.name, r.priority::integer, r.promotion_type::text, r.percent_off, r.buy_quantity::integer, r.is_active,
      (select string_agg(i.product_id::text || 'x' || i.quantity, ',') from public.promotion_items i where i.promotion_id = r.id),
      (select count(*)::integer from public.promotion_schedule s where s.promotion_id = r.id)
    from public.promotion_rules r where r.id = '99130000-0000-0000-0000-000000000301'$$,
  $$values ('Promo X editada', 10, 'buy_x_get_y', null::numeric, 2, true, '99130000-0000-0000-0000-000000000202x3', 0)$$,
  'fields, products and windows are replaced together, keeping its priority and staying active'
);

-- Failures inside the save undo everything, including the row update that ran first.
create function public.bb13_fail_schedule() returns trigger language plpgsql as $$
begin
  if current_setting('bb13.fail_schedule', true) = 'on' then
    raise exception using errcode = 'BB999', message = 'injected failure';
  end if;
  return new;
end;
$$;
create trigger bb13_fail_schedule before insert on public.promotion_schedule
for each row execute function public.bb13_fail_schedule();
select set_config('bb13.fail_schedule', 'on', true);

set local role authenticated;
select throws_ok(
  $$select public.admin_save_promotion(
    '99130000-0000-0000-0000-000000000001', '99130000-0000-0000-0000-000000000301',
    jsonb_build_object(
      'name', 'Nunca guardada', 'slug', 'promo-x', 'description', '',
      'promotion_type', 'percent_off', 'percent_off', 50,
      'applies_to_delivery', true, 'applies_to_pickup', true,
      'starts_at', '2027-01-01T03:00:00Z', 'ends_at', '2027-02-01T03:00:00Z', 'is_active', false
    ),
    '[{"product_id":"99130000-0000-0000-0000-000000000201","quantity":1}]',
    '[{"day_of_week":1,"starts_at":"12:00","ends_at":"15:00"}]'
  )$$,
  'BB999', null,
  'a failure storing the windows fails the save'
);
select throws_ok(
  $$select public.admin_save_promotion(
    '99130000-0000-0000-0000-000000000001', '99130000-0000-0000-0000-000000000301',
    jsonb_build_object(
      'name', 'Nunca guardada', 'slug', 'promo-x', 'description', '',
      'promotion_type', 'percent_off', 'percent_off', 50,
      'applies_to_delivery', true, 'applies_to_pickup', true,
      'starts_at', '2027-01-01T03:00:00Z', 'ends_at', '2027-02-01T03:00:00Z', 'is_active', false
    ),
    '[{"product_id":"99130000-0000-0000-0000-000000000203","quantity":1}]',
    '[]'
  )$$,
  '23503', null,
  'a product of another store fails the save'
);
select throws_ok(
  $$select public.admin_save_promotion(
    '99130000-0000-0000-0000-000000000001', null,
    jsonb_build_object(
      'name', 'Ventana rota', 'slug', 'ventana-rota', 'description', '',
      'promotion_type', 'percent_off', 'percent_off', 5,
      'applies_to_delivery', true, 'applies_to_pickup', true,
      'starts_at', '2027-02-01T03:00:00Z', 'ends_at', '2027-01-01T03:00:00Z', 'is_active', true
    ),
    '[]', '[]'
  )$$,
  '23514', null,
  'an end before the start is rejected by the database'
);
select throws_ok(
  $$select public.admin_save_promotion(
    '99130000-0000-0000-0000-000000000001', null,
    jsonb_build_object(
      'name', 'Duplicada', 'slug', 'promo-y', 'description', '',
      'promotion_type', 'free_delivery',
      'applies_to_delivery', true, 'applies_to_pickup', false,
      'starts_at', '2027-01-01T03:00:00Z', 'ends_at', '2027-02-01T03:00:00Z', 'is_active', true
    ),
    '[]', '[]'
  )$$,
  '23505', null,
  'a taken slug is a conflict'
);

select set_config('request.jwt.claims', '{"sub":"98130000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('bb13.fail_schedule', '', true);
select throws_ok(
  $$select public.admin_save_promotion(
    '99130000-0000-0000-0000-000000000001', '99130000-0000-0000-0000-000000000301',
    jsonb_build_object(
      'name', 'Ajena', 'slug', 'promo-x', 'description', '',
      'promotion_type', 'percent_off', 'percent_off', 90,
      'applies_to_delivery', true, 'applies_to_pickup', true,
      'starts_at', '2027-01-01T03:00:00Z', 'ends_at', '2027-02-01T03:00:00Z', 'is_active', true
    ),
    '[]', '[]'
  )$$,
  '42501', null,
  'an admin of another store cannot edit this store''s promotion'
);
select throws_ok(
  $$select public.admin_save_promotion(
    '99130000-0000-0000-0000-000000000001', null,
    jsonb_build_object(
      'name', 'Intrusa', 'slug', 'intrusa', 'description', '',
      'promotion_type', 'percent_off', 'percent_off', 90,
      'applies_to_delivery', true, 'applies_to_pickup', true,
      'starts_at', '2027-01-01T03:00:00Z', 'ends_at', '2027-02-01T03:00:00Z', 'is_active', true
    ),
    '[]', '[]'
  )$$,
  '42501', null,
  'an admin of another store cannot create promotions in this one'
);

-- An admin of both stores still writes only inside the store the server resolved.
select set_config('request.jwt.claims', '{"sub":"98130000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$select public.admin_save_promotion(
    '99130000-0000-0000-0000-000000000001', '99130000-0000-0000-0000-000000000304',
    jsonb_build_object(
      'name', 'Cruzada', 'slug', 'promo-w', 'description', '',
      'promotion_type', 'percent_off', 'percent_off', 90,
      'applies_to_delivery', true, 'applies_to_pickup', true,
      'starts_at', '2027-01-01T03:00:00Z', 'ends_at', '2027-02-01T03:00:00Z', 'is_active', true
    ),
    '[]', '[]'
  )$$,
  'P0002', null,
  'a promotion of another store is not edited through this store, even by an admin of both'
);
reset role;
select results_eq(
  $$select name, percent_off::integer from public.promotion_rules where id = '99130000-0000-0000-0000-000000000304'$$,
  $$values ('Promo W', 40)$$,
  'the other store''s promotion is untouched'
);

select results_eq(
  $$select r.name, r.promotion_type::text, r.is_active,
      (select string_agg(i.product_id::text || 'x' || i.quantity, ',') from public.promotion_items i where i.promotion_id = r.id),
      (select count(*)::integer from public.promotion_schedule s where s.promotion_id = r.id)
    from public.promotion_rules r where r.id = '99130000-0000-0000-0000-000000000301'$$,
  $$values ('Promo X editada', 'buy_x_get_y', true, '99130000-0000-0000-0000-000000000202x3', 0)$$,
  'after every failed save X keeps the last stored fields, products and windows'
);
select is(
  (select count(*)::integer from public.promotion_rules where slug in ('ventana-rota', 'duplicada', 'intrusa') or name = 'Duplicada'),
  0,
  'failed creations leave no row behind'
);
select results_eq(
  'select name, priority::integer from bb13_priorities order by name',
  $$values ('Combo nuevo', 31), ('Promo W', 5), ('Promo X editada', 10), ('Promo Y', 20), ('Promo Z', 30)$$,
  'no failed save consumed or changed a priority'
);

select * from finish();
rollback;
