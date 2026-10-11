begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.store_payment_methods'::regclass
      and conname = 'store_payment_methods_fixed_public_copy'
      and convalidated
  ),
  'payment methods have a validated fixed-copy check'
);
select is(
  (select count(*)::integer from public.store_payment_methods
   where public_instructions <> ''
      or display_name not in ('Efectivo', 'Transferencia', 'Mercado Pago')),
  0,
  'no stored payment method keeps free text'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '98131000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'admin@bb13-pay.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
);
insert into public.stores (id, name, slug, whatsapp_e164, is_public)
values ('99131000-0000-0000-0000-000000000001', 'BB13 Pay', 'bb13-pay', '+5491100000131', true);
insert into public.admin_memberships (store_id, user_id, role)
values ('99131000-0000-0000-0000-000000000001', '98131000-0000-0000-0000-000000000001', 'admin');

-- As the store's admin, through RLS: what the admin screen (or a crafted request) can write.
select set_config('request.jwt.claims', '{"sub":"98131000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$insert into public.store_payment_methods (store_id, method, display_name, public_instructions, is_enabled, sort_order)
    values ('99131000-0000-0000-0000-000000000001', 'bank_transfer', 'Transferencia', '', true, 20)
    on conflict (store_id, method) do update set is_enabled = excluded.is_enabled, sort_order = excluded.sort_order$$,
  'a transfer with its fixed name and no instructions is stored'
);
select throws_ok(
  $$update public.store_payment_methods set public_instructions = 'Alias bunkerburger'
    where store_id = '99131000-0000-0000-0000-000000000001' and method = 'bank_transfer'$$,
  '23514', null,
  'an alias without separators cannot be stored as instructions'
);
select throws_ok(
  $$update public.store_payment_methods set public_instructions = 'Mi alias bancoburger'
    where store_id = '99131000-0000-0000-0000-000000000001' and method = 'bank_transfer'$$,
  '23514', null,
  'an alias inside a sentence cannot be stored as instructions'
);
select throws_ok(
  $$update public.store_payment_methods set public_instructions = 'Pedí el alias por WhatsApp.'
    where store_id = '99131000-0000-0000-0000-000000000001' and method = 'bank_transfer'$$,
  '23514', null,
  'not even neutral free text: the customer copy lives in the app'
);
select throws_ok(
  $$update public.store_payment_methods set display_name = 'Alias: bunker.burger'
    where store_id = '99131000-0000-0000-0000-000000000001' and method = 'bank_transfer'$$,
  '23514', null,
  'an alias cannot be stored as the transfer name'
);
select throws_ok(
  $$update public.store_payment_methods set display_name = 'CBU 2850590940090418135201'
    where store_id = '99131000-0000-0000-0000-000000000001' and method = 'bank_transfer'$$,
  '23514', null,
  'a CBU cannot be stored as the transfer name'
);
select throws_ok(
  $$insert into public.store_payment_methods (store_id, method, display_name, public_instructions, is_enabled, sort_order)
    values ('99131000-0000-0000-0000-000000000001', 'cash', 'Efectivo · alias bunkerburger', '', true, 10)$$,
  '23514', null,
  'no other method can carry free text either'
);
select lives_ok(
  $$insert into public.store_payment_methods (store_id, method, display_name, public_instructions, is_enabled, sort_order)
    values
      ('99131000-0000-0000-0000-000000000001', 'cash', 'Efectivo', '', true, 10),
      ('99131000-0000-0000-0000-000000000001', 'mercado_pago', 'Mercado Pago', '', false, 30)$$,
  'cash and Mercado Pago keep working with their fixed names'
);
reset role;

-- What an anonymous visitor reads once the transfer is enabled.
set local role anon;
select results_eq(
  $$select method::text, display_name, public_instructions from public.store_payment_methods
    where store_id = '99131000-0000-0000-0000-000000000001' order by sort_order$$,
  $$values ('cash', 'Efectivo', ''), ('bank_transfer', 'Transferencia', '')$$,
  'the public row of an enabled transfer exposes only its fixed name'
);
select is(
  (select count(*)::integer from public.store_payment_methods
   where store_id = '99131000-0000-0000-0000-000000000001'
     and (display_name ilike '%alias%' or public_instructions ilike '%alias%' or display_name ~ '\d{6}')),
  0,
  'no alias or account number is publicly readable'
);
reset role;

select * from finish();
rollback;
