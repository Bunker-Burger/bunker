begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

select col_type_is(
  'public', 'stores', 'status_override', 'store_status_override',
  'stores carry a manual status override'
);
select col_default_is(
  'public', 'stores', 'status_override', 'closed'::text,
  'a new store starts closed'
);
select col_is_null('public', 'stores', 'delivery_fee_cents', 'an unconfigured delivery fee is null');
select col_hasnt_default('public', 'stores', 'delivery_fee_cents', 'the delivery fee has no implicit default');
select col_default_is(
  'public', 'stores', 'timezone', 'America/Argentina/Tucuman'::text,
  'stores default to the Tucumán time zone'
);
select has_table('public', 'store_business_hours', 'weekly business hours live in their own table');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.store_business_hours'::regclass),
  'store_business_hours has RLS enabled'
);
select hasnt_table('public', 'delivery_zones', 'there are no delivery zones');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '98000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'admin@bb08.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '98000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'outsider@bb08.test', '', now(),
    '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.stores (id, name, slug, whatsapp_e164, is_public)
values ('99000000-0000-0000-0000-000000000001', 'BB08 Store', 'bb08-store', '+5491100000008', true);

insert into public.admin_memberships (store_id, user_id, role)
values ('99000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001', 'admin');

select throws_ok(
  $$update public.stores set status_override = 'auto'
    where id = '99000000-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  'orders cannot follow the schedule without a delivery fee'
);
select throws_ok(
  $$update public.stores set status_override = 'open'
    where id = '99000000-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  'orders cannot be forced open without a delivery fee'
);
select lives_ok(
  $$update public.stores set status_override = 'paused'
    where id = '99000000-0000-0000-0000-000000000001'$$,
  'a store without a fee can still be paused'
);
select lives_ok(
  $$update public.stores set delivery_fee_cents = 150000, status_override = 'auto'
    where id = '99000000-0000-0000-0000-000000000001'$$,
  'configuring the fee allows enabling orders'
);
select throws_ok(
  $$update public.stores set delivery_fee_cents = null
    where id = '99000000-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  'the fee cannot be removed while orders are enabled'
);
select throws_ok(
  $$update public.stores set timezone = 'America/Atlantis'
    where id = '99000000-0000-0000-0000-000000000001'$$,
  '22023',
  null,
  'an unknown time zone is rejected'
);

select lives_ok(
  $$insert into public.store_business_hours (store_id, day_of_week, opens_at, closes_at)
    values ('99000000-0000-0000-0000-000000000001', 5, '20:00', '02:00')$$,
  'a shift may cross midnight'
);
select throws_ok(
  $$insert into public.store_business_hours (store_id, day_of_week, opens_at, closes_at)
    values ('99000000-0000-0000-0000-000000000001', 1, '20:00', '20:00')$$,
  '23514',
  null,
  'an empty shift is rejected'
);
select throws_ok(
  $$insert into public.store_business_hours (store_id, day_of_week, opens_at, closes_at)
    values ('99000000-0000-0000-0000-000000000001', 7, '20:00', '23:00')$$,
  '23514',
  null,
  'day_of_week is limited to 0..6'
);

set local role anon;
select results_eq(
  $$select day_of_week, opens_at, closes_at from public.store_business_hours
    where store_id = '99000000-0000-0000-0000-000000000001'$$,
  $$values (5::smallint, '20:00'::time, '02:00'::time)$$,
  'anon reads the hours of a public store'
);
reset role;

select set_config(
  'request.jwt.claims',
  '{"sub":"98000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);
set local role authenticated;
update public.store_business_hours set closes_at = '23:00'
where store_id = '99000000-0000-0000-0000-000000000001';
reset role;
select results_eq(
  $$select closes_at from public.store_business_hours
    where store_id = '99000000-0000-0000-0000-000000000001'$$,
  $$values ('02:00'::time)$$,
  'a non-admin cannot change the hours'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"98000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;
select lives_ok(
  $$insert into public.store_business_hours (store_id, day_of_week, opens_at, closes_at)
    values ('99000000-0000-0000-0000-000000000001', 6, '20:00', '00:00')$$,
  'an active admin manages the hours'
);
reset role;

select * from finish();
rollback;
