-- BB-15: Mercado Pago webhook, idempotent payment application and 90-day retention.
--
-- * Minimal contact (name and phone) and the provider's raw status live on the attempt, so a paid
--   order whose customer never sends the WhatsApp message is still on record (no operations board).
-- * Webhook events are claimed atomically; a failed or abandoned claim can be retried by the next
--   delivery from Mercado Pago, a completed or in-flight one cannot.
-- * Provider payments are applied under a row lock with the amount and currency checked against
--   the attempt and its frozen quote. An approved attempt never goes back, and a second approved
--   payment for the same reference is reported, never overwritten.
-- * The existing 90-day purge runs every day with pg_cron.
-- Writes are only for service_role (server); admins keep their read-only RLS access.

alter table public.payment_attempts
  add column customer_name text
    constraint payment_attempts_customer_name_check check (customer_name is null or length(btrim(customer_name)) between 2 and 100),
  add column customer_phone text
    constraint payment_attempts_customer_phone_check check (customer_phone is null or customer_phone ~ '^[0-9+() -]{6,32}$'),
  add column provider_status text
    constraint payment_attempts_provider_status_check check (provider_status is null or provider_status ~ '^[a-z_]{1,40}$');

comment on column public.payment_attempts.customer_name is
  'Minimal contact for a Mercado Pago payment; removed with the attempt by the 90-day purge.';
comment on column public.payment_attempts.customer_phone is
  'Minimal contact for a Mercado Pago payment; removed with the attempt by the 90-day purge.';
comment on column public.payment_attempts.provider_status is
  'Last status reported by Mercado Pago for this attempt (approved, in_process, rejected...).';

alter table public.payment_webhook_events
  add column claimed_at timestamptz not null default now(),
  add column delivery_count integer not null default 1
    constraint payment_webhook_events_delivery_count_check check (delivery_count >= 1),
  -- Lease of the delivery that currently owns the event: renewed on every claim or takeover, so a
  -- delivery whose claim was taken over can no longer close the event.
  add column claim_token uuid not null default gen_random_uuid();

-- Returns the claim token when this delivery owns the event, null when it is a duplicate.
create function public.claim_payment_webhook_event(target_event_id text, target_provider_payment_id text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  claimed uuid;
begin
  insert into public.payment_webhook_events (event_id, provider_payment_id, claim_token)
  values (target_event_id, target_provider_payment_id, gen_random_uuid())
  on conflict (event_id) do update
    set processing_status = 'processing',
        last_error_code = null,
        completed_at = null,
        claimed_at = now(),
        claim_token = gen_random_uuid(),
        delivery_count = public.payment_webhook_events.delivery_count + 1
    where public.payment_webhook_events.provider_payment_id = excluded.provider_payment_id
      and (
        public.payment_webhook_events.processing_status = 'failed'
        or (
          public.payment_webhook_events.processing_status = 'processing'
          and public.payment_webhook_events.claimed_at < now() - interval '60 seconds'
        )
      )
  returning claim_token into claimed;

  return claimed;
end;
$$;

comment on function public.claim_payment_webhook_event(text, text) is
  'BB-15: atomic claim of a Mercado Pago webhook event; failed or stale (60 s) claims can be retried. Returns the claim token, or null for a duplicate.';

-- Closes the event only for the delivery that still owns it (same token, still processing):
-- completed without error code, failed with one. False when the claim was taken over or closed.
create function public.finish_payment_webhook_event(target_event_id text, target_claim_token uuid, target_error_code text default null)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  closed text;
begin
  if target_error_code is not null and length(target_error_code) not between 1 and 80 then
    raise exception 'invalid error code' using errcode = '22023';
  end if;

  update public.payment_webhook_events
  set processing_status = case when target_error_code is null then 'completed' else 'failed' end::public.payment_webhook_processing_status,
      completed_at = case when target_error_code is null then now() else null end,
      last_error_code = target_error_code
  where event_id = target_event_id
    and claim_token = target_claim_token
    and processing_status = 'processing'
  returning event_id into closed;

  return closed is not null;
end;
$$;

comment on function public.finish_payment_webhook_event(text, uuid, text) is
  'BB-15: completes (null error code) or fails a webhook event, only for the delivery holding its current claim token.';

-- Outcomes: approved, refunded, rejected, cancelled, pending, unchanged, unknown_reference,
-- currency_mismatch, amount_mismatch (also when the attempt has no frozen quote), conflicting_payment.
create function public.apply_mercado_pago_payment(
  target_external_reference text,
  target_provider_payment_id text,
  target_provider_status text,
  target_amount_cents bigint,
  target_currency text
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  attempt public.payment_attempts%rowtype;
  quote_total bigint;
  next_status public.payment_attempt_status;
begin
  if target_provider_payment_id is null or length(target_provider_payment_id) not between 1 and 255
    or target_provider_status is null or target_provider_status !~ '^[a-z_]{1,40}$' then
    raise exception 'invalid provider payment' using errcode = '22023';
  end if;

  select * into attempt
  from public.payment_attempts
  where external_reference = target_external_reference
  for update;

  if not found then
    return 'unknown_reference';
  end if;

  if target_currency is distinct from 'ARS' or attempt.currency <> target_currency then
    return 'currency_mismatch';
  end if;

  select q.total_cents into quote_total
  from public.payment_quotes q
  where q.id = attempt.quote_id and q.store_id = attempt.store_id;

  -- Both the attempt and its frozen quote must match. Without a quote (attempts older than BB-03
  -- may lack one) there is no authoritative snapshot to check: nothing is credited.
  if quote_total is null
    or target_amount_cents is distinct from attempt.amount_cents
    or target_amount_cents <> quote_total then
    return 'amount_mismatch';
  end if;

  next_status := case target_provider_status
    when 'approved' then 'approved'
    when 'rejected' then 'rejected'
    when 'cancelled' then 'cancelled'
    when 'refunded' then 'refunded'
    when 'charged_back' then 'refunded'
    else null -- pending, in_process, authorized, in_mediation: no transition yet
  end::public.payment_attempt_status;

  -- An approved (or refunded) attempt belongs to its payment: another payment never replaces it.
  if attempt.status in ('approved', 'refunded')
    and attempt.provider_payment_id is not null
    and attempt.provider_payment_id <> target_provider_payment_id then
    return case when next_status = 'approved' then 'conflicting_payment' else 'unchanged' end;
  end if;

  if attempt.status = 'refunded' then
    return 'unchanged';
  end if;

  if attempt.status = 'approved' then
    if next_status = 'refunded' then
      update public.payment_attempts
      set status = 'refunded', provider_status = target_provider_status
      where id = attempt.id;
      return 'refunded';
    end if;
    return 'unchanged';
  end if;

  if next_status is null then
    update public.payment_attempts
    set provider_status = target_provider_status
    where id = attempt.id;
    return 'pending';
  end if;

  update public.payment_attempts
  set status = next_status,
      provider_payment_id = target_provider_payment_id,
      provider_status = target_provider_status
  where id = attempt.id;
  return next_status::text;
end;
$$;

comment on function public.apply_mercado_pago_payment(text, text, text, bigint, text) is
  'BB-15: applies a Mercado Pago payment read from the provider API to its attempt, under a row lock and only when amount and currency match the frozen quote.';

revoke all on function public.claim_payment_webhook_event(text, text) from public, anon, authenticated;
revoke all on function public.finish_payment_webhook_event(text, uuid, text) from public, anon, authenticated;
revoke all on function public.apply_mercado_pago_payment(text, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.claim_payment_webhook_event(text, text) to service_role;
grant execute on function public.finish_payment_webhook_event(text, uuid, text) to service_role;
grant execute on function public.apply_mercado_pago_payment(text, text, text, bigint, text) to service_role;

-- 90-day retention, every day at 06:15 UTC (03:15 in Argentina; pg_cron runs in GMT by default).
-- Installed as Supabase Cron recommends; scheduling by name replaces a job with the same name.
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
select cron.schedule(
  'bb15-purge-expired-payment-data',
  '15 6 * * *',
  'select private.purge_expired_payment_data()'
);
