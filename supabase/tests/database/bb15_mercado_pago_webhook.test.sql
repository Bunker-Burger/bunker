begin;

create extension if not exists pgtap with schema extensions;

select plan(54);

insert into public.stores (id, name, slug, whatsapp_e164, is_public)
values ('99151000-0000-0000-0000-000000000001', 'BB15 Pay', 'bb15-pay', '+5491100000151', true);

insert into public.payment_quotes (
  id, store_id, lines, subtotal_cents, discount_cents, delivery_cents, total_cents, currency,
  fulfillment_channel, expires_at
) values
  ('96151000-0000-0000-0000-000000000001', '99151000-0000-0000-0000-000000000001',
   '[{"productId":"p","quantity":1}]'::jsonb, 150000, 0, 0, 150000, 'ARS', 'pickup', now() + interval '15 minutes'),
  ('96151000-0000-0000-0000-000000000002', '99151000-0000-0000-0000-000000000001',
   '[{"productId":"p","quantity":1}]'::jsonb, 90000, 0, 0, 90000, 'ARS', 'pickup', now() + interval '15 minutes');

insert into public.payment_attempts (
  id, quote_id, store_id, amount_cents, currency, idempotency_key, external_reference, status,
  customer_name, customer_phone
) values
  ('97151000-0000-0000-0000-000000000001', '96151000-0000-0000-0000-000000000001',
   '99151000-0000-0000-0000-000000000001', 150000, 'ARS', 'bb15-idempotency-0001', 'bb15-ref-0001', 'pending',
   'Ana Pérez', '+54 9 11 5555-0001'),
  -- Its own amount was altered after the quote was frozen: the quote snapshot still wins.
  ('97151000-0000-0000-0000-000000000002', '96151000-0000-0000-0000-000000000002',
   '99151000-0000-0000-0000-000000000001', 95000, 'ARS', 'bb15-idempotency-0002', 'bb15-ref-0002', 'pending',
   null, null);

-- Minimal contact
select is(
  (select customer_name || ' / ' || customer_phone from public.payment_attempts where external_reference = 'bb15-ref-0001'),
  'Ana Pérez / +54 9 11 5555-0001',
  'an attempt keeps the minimal contact of who pays'
);
select throws_ok(
  $$update public.payment_attempts set customer_phone = 'llamame al 1234' where external_reference = 'bb15-ref-0001'$$,
  '23514', null,
  'free text is not a phone'
);
select throws_ok(
  $$update public.payment_attempts set customer_name = 'A' where external_reference = 'bb15-ref-0001'$$,
  '23514', null,
  'a one-letter name is rejected'
);

-- Webhook event claims: each claim gets its own token; only the current owner closes the event.
create temporary table bb15_claims (name text primary key, token uuid);

insert into bb15_claims values ('e1', public.claim_payment_webhook_event('bb15-event-1', 'mp-1001'));
select ok((select token from bb15_claims where name = 'e1') is not null, 'the first delivery owns the event and gets a token');
select is(public.claim_payment_webhook_event('bb15-event-1', 'mp-1001'), null::uuid, 'a concurrent delivery of an in-flight event is a duplicate');
select is(public.finish_payment_webhook_event('bb15-event-1', (select token from bb15_claims where name = 'e1'), null), true, 'its owner completes it');
select is(public.claim_payment_webhook_event('bb15-event-1', 'mp-1001'), null::uuid, 'a replay of a completed event is a duplicate');
select is(
  (select processing_status::text || ':' || delivery_count from public.payment_webhook_events where event_id = 'bb15-event-1'),
  'completed:1',
  'duplicates do not touch the completed event'
);
select is(public.finish_payment_webhook_event('bb15-event-1', (select token from bb15_claims where name = 'e1'), 'late_error'), false, 'a closed event cannot be closed again');

insert into bb15_claims values ('e2-first', public.claim_payment_webhook_event('bb15-event-2', 'mp-1002'));
select is(public.finish_payment_webhook_event('bb15-event-2', (select token from bb15_claims where name = 'e2-first'), 'provider_unavailable'), true, 'its owner records a failure');
insert into bb15_claims values ('e2-retry', public.claim_payment_webhook_event('bb15-event-2', 'mp-1002'));
select ok(
  (select token from bb15_claims where name = 'e2-retry') is not null
  and (select token from bb15_claims where name = 'e2-retry') <> (select token from bb15_claims where name = 'e2-first'),
  'a failed event is claimed again by the next delivery, with a new token'
);
select is(
  (select processing_status::text || ':' || coalesce(last_error_code, '-') || ':' || delivery_count from public.payment_webhook_events where event_id = 'bb15-event-2'),
  'processing:-:2',
  'the retry clears the error and counts the delivery'
);
select is(public.claim_payment_webhook_event('bb15-event-2', 'mp-9999'), null::uuid, 'an event id cannot be re-claimed for another payment');

-- Interleaving: A claims, stalls past 60 s, B takes over; A's late close must not touch B's claim.
insert into bb15_claims values ('A', public.claim_payment_webhook_event('bb15-event-3', 'mp-1003'));
update public.payment_webhook_events set claimed_at = now() - interval '2 minutes' where event_id = 'bb15-event-3';
insert into bb15_claims values ('B', public.claim_payment_webhook_event('bb15-event-3', 'mp-1003'));
select ok(
  (select token from bb15_claims where name = 'B') is not null
  and (select token from bb15_claims where name = 'B') <> (select token from bb15_claims where name = 'A'),
  'an abandoned claim (older than 60 s) is taken over with a new token'
);
select is(public.finish_payment_webhook_event('bb15-event-3', (select token from bb15_claims where name = 'A'), 'provider_unavailable'), false, 'the stale delivery A cannot fail the event B now owns');
select is(public.finish_payment_webhook_event('bb15-event-3', (select token from bb15_claims where name = 'A'), null), false, 'nor complete it');
select is(
  (select processing_status::text || ':' || coalesce(last_error_code, '-') from public.payment_webhook_events where event_id = 'bb15-event-3'),
  'processing:-',
  'B keeps a clean, in-flight claim'
);
select is(public.claim_payment_webhook_event('bb15-event-3', 'mp-1003'), null::uuid, 'so a third delivery is still a duplicate');
select is(public.finish_payment_webhook_event('bb15-event-3', (select token from bb15_claims where name = 'B'), null), true, 'B completes the event');
select is(public.finish_payment_webhook_event('bb15-event-3', (select token from bb15_claims where name = 'A'), 'provider_unavailable'), false, 'A arriving after B finished changes nothing');
select is(
  (select processing_status::text || ':' || coalesce(last_error_code, '-') || ':' || delivery_count from public.payment_webhook_events where event_id = 'bb15-event-3'),
  'completed:-:2',
  'the event stays completed by B'
);
select throws_ok(
  $$select public.finish_payment_webhook_event('bb15-event-3', gen_random_uuid(), repeat('x', 81))$$,
  '22023', null,
  'an error code longer than 80 characters is refused'
);

-- Applying provider payments
select is(public.apply_mercado_pago_payment('bb15-ref-none', 'mp-1', 'approved', 150000, 'ARS'), 'unknown_reference', 'an unknown reference credits nothing');
select is(public.apply_mercado_pago_payment('bb15-ref-0001', 'mp-1', 'approved', 150000, 'USD'), 'currency_mismatch', 'another currency credits nothing');
select is(public.apply_mercado_pago_payment('bb15-ref-0001', 'mp-1', 'approved', 149999, 'ARS'), 'amount_mismatch', 'a different amount credits nothing');
select is(public.apply_mercado_pago_payment('bb15-ref-0002', 'mp-2', 'approved', 95000, 'ARS'), 'amount_mismatch', 'the frozen quote total is checked too');
-- R2 H4: an attempt without a frozen quote (pre-BB-03 rows) is never credited. Such a row cannot be
-- inserted here without DDL on payment_attempts (its quote check rejects new rows), which this test
-- must not run on the single cloud project: the guard is asserted on the function itself, and the
-- behaviour is covered by the domain rule tests (payment-application.test.ts).
select ok(
  pg_get_functiondef('public.apply_mercado_pago_payment(text, text, text, bigint, text)'::regprocedure)
    ~ 'if quote_total is null\s+or target_amount_cents is distinct from attempt\.amount_cents\s+or target_amount_cents <> quote_total then\s+return ''amount_mismatch'';',
  'a missing frozen quote credits nothing (guard present in apply_mercado_pago_payment)'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.payment_attempts'::regclass and conname = 'payment_attempts_quote_required_for_new_rows'
  ),
  'BB-15 keeps the quote requirement for new attempts untouched'
);
select is(
  (select string_agg(status::text || ':' || coalesce(provider_payment_id, '-'), ',' order by external_reference)
   from public.payment_attempts where external_reference in ('bb15-ref-0001', 'bb15-ref-0002')),
  'pending:-,pending:-',
  'mismatches leave the attempts untouched'
);

select is(public.apply_mercado_pago_payment('bb15-ref-0001', 'mp-1', 'in_process', 150000, 'ARS'), 'pending', 'a payment in process is not a transition');
select is(
  (select status::text || ':' || provider_status from public.payment_attempts where external_reference = 'bb15-ref-0001'),
  'pending:in_process',
  'the provider status is recorded'
);
select is(public.apply_mercado_pago_payment('bb15-ref-0001', 'mp-1', 'rejected', 150000, 'ARS'), 'rejected', 'a rejected card rejects the attempt');
select is(public.apply_mercado_pago_payment('bb15-ref-0001', 'mp-2', 'approved', 150000, 'ARS'), 'approved', 'a later approved payment for the same reference approves it');
select is(
  (select status::text || ':' || provider_payment_id || ':' || provider_status from public.payment_attempts where external_reference = 'bb15-ref-0001'),
  'approved:mp-2:approved',
  'the attempt records the approved payment'
);
select is(public.apply_mercado_pago_payment('bb15-ref-0001', 'mp-2', 'approved', 150000, 'ARS'), 'unchanged', 'replaying the approval changes nothing');
select is(public.apply_mercado_pago_payment('bb15-ref-0001', 'mp-1', 'rejected', 150000, 'ARS'), 'unchanged', 'a late rejection of the earlier payment does not undo the approval');
select is(public.apply_mercado_pago_payment('bb15-ref-0001', 'mp-2', 'pending', 150000, 'ARS'), 'unchanged', 'an out-of-order pending does not undo the approval');
select is(public.apply_mercado_pago_payment('bb15-ref-0001', 'mp-3', 'approved', 150000, 'ARS'), 'conflicting_payment', 'a second approved payment is reported, not recorded');
select is(
  (select status::text || ':' || provider_payment_id from public.payment_attempts where external_reference = 'bb15-ref-0001'),
  'approved:mp-2',
  'the first approved payment stays'
);
select is(public.apply_mercado_pago_payment('bb15-ref-0001', 'mp-2', 'refunded', 150000, 'ARS'), 'refunded', 'a manual refund of that payment is recorded');
select is(public.apply_mercado_pago_payment('bb15-ref-0001', 'mp-2', 'approved', 150000, 'ARS'), 'unchanged', 'a refunded attempt is final');
select throws_ok(
  $$select public.apply_mercado_pago_payment('bb15-ref-0001', 'mp-2', 'Approved; drop', 150000, 'ARS')$$,
  '22023', null,
  'a malformed provider status is refused'
);

-- Privileges: only the server (service_role) writes payments
select ok(
  not has_function_privilege('anon', 'public.claim_payment_webhook_event(text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.claim_payment_webhook_event(text, text)', 'EXECUTE'),
  'anon and authenticated cannot claim webhook events'
);
select ok(
  not has_function_privilege('anon', 'public.finish_payment_webhook_event(text, uuid, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.finish_payment_webhook_event(text, uuid, text)', 'EXECUTE'),
  'anon and authenticated cannot close webhook events'
);
select ok(
  not has_function_privilege('anon', 'public.apply_mercado_pago_payment(text, text, text, bigint, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.apply_mercado_pago_payment(text, text, text, bigint, text)', 'EXECUTE'),
  'anon and authenticated cannot apply payments'
);
select ok(
  has_function_privilege('service_role', 'public.claim_payment_webhook_event(text, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.finish_payment_webhook_event(text, uuid, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.apply_mercado_pago_payment(text, text, text, bigint, text)', 'EXECUTE'),
  'service_role runs all three'
);
select ok(
  (select bool_and(not p.prosecdef and p.proconfig @> array['search_path=""']) and count(*) = 3
   from pg_proc p
   where p.oid in ('public.claim_payment_webhook_event(text, text)'::regprocedure,
                   'public.finish_payment_webhook_event(text, uuid, text)'::regprocedure,
                   'public.apply_mercado_pago_payment(text, text, text, bigint, text)'::regprocedure)),
  'all three run as the caller with an empty search_path'
);

-- 90-day retention, contact included
insert into public.payment_quotes (
  id, store_id, lines, subtotal_cents, discount_cents, delivery_cents, total_cents, currency,
  fulfillment_channel, expires_at, created_at
) values
  ('96151000-0000-0000-0000-000000000091', '99151000-0000-0000-0000-000000000001', '[{"productId":"p","quantity":1}]'::jsonb,
   100000, 0, 0, 100000, 'ARS', 'pickup', now() - interval '91 days' + interval '15 minutes', now() - interval '91 days'),
  ('96151000-0000-0000-0000-000000000089', '99151000-0000-0000-0000-000000000001', '[{"productId":"p","quantity":1}]'::jsonb,
   100000, 0, 0, 100000, 'ARS', 'pickup', now() - interval '89 days' + interval '15 minutes', now() - interval '89 days');
insert into public.payment_attempts (
  id, quote_id, store_id, amount_cents, currency, idempotency_key, external_reference, status,
  customer_name, customer_phone, created_at, updated_at
) values
  ('97151000-0000-0000-0000-000000000091', '96151000-0000-0000-0000-000000000091', '99151000-0000-0000-0000-000000000001',
   100000, 'ARS', 'bb15-idempotency-0091', 'bb15-ref-0091', 'approved', 'Viejo Cliente', '+5491100000091',
   now() - interval '91 days', now() - interval '91 days'),
  ('97151000-0000-0000-0000-000000000089', '96151000-0000-0000-0000-000000000089', '99151000-0000-0000-0000-000000000001',
   100000, 'ARS', 'bb15-idempotency-0089', 'bb15-ref-0089', 'approved', 'Reciente Cliente', '+5491100000089',
   now() - interval '89 days', now() - interval '89 days');
insert into public.payment_webhook_events (event_id, provider_payment_id, processing_status, completed_at, received_at)
values
  ('bb15-event-91d', 'mp-91', 'completed', now() - interval '91 days', now() - interval '91 days'),
  ('bb15-event-89d', 'mp-89', 'completed', now() - interval '89 days', now() - interval '89 days');

select ok(private.purge_expired_payment_data() >= 3, 'the purge removes the expired quote, attempt and event');
select is(
  (select count(*)::integer from public.payment_attempts where external_reference = 'bb15-ref-0091'),
  0,
  'an attempt older than 90 days is gone with its contact'
);
select is(
  (select count(*)::integer from public.payment_quotes where id = '96151000-0000-0000-0000-000000000091'),
  0,
  'its quote is gone'
);
select is(
  (select count(*)::integer from public.payment_webhook_events where event_id = 'bb15-event-91d'),
  0,
  'a webhook event older than 90 days is gone'
);
select is(
  (select count(*)::integer from public.payment_attempts where external_reference in ('bb15-ref-0089', 'bb15-ref-0001')),
  2,
  'attempts within 90 days stay'
);
select is(
  (select count(*)::integer from public.payment_webhook_events where event_id = 'bb15-event-89d'),
  1,
  'events within 90 days stay'
);
select is(
  (select schedule || ' | ' || command from cron.job where jobname = 'bb15-purge-expired-payment-data'),
  '15 6 * * * | select private.purge_expired_payment_data()',
  'the purge is scheduled every day'
);

select * from finish();
rollback;
