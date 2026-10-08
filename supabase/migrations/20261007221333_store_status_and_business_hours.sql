-- BB-08: authoritative store status, weekly business hours and a mandatory delivery fee.
--
-- Supersedes the ambiguous `stores.is_open` flag and the free-form `stores.business_hours` jsonb:
--   * `status_override` is the manual switch: auto (follow the hours), open, paused or closed.
--   * `store_business_hours` holds weekly shifts in the store time zone; a shift whose
--     `closes_at` is not after `opens_at` ends the next day (crosses midnight).
--   * `delivery_fee_cents` is null until the fixed fee is configured, and orders cannot be
--     enabled (auto/open) without it.
-- The old columns stay, marked deprecated, so branches still reading them keep working; a later
-- migration drops them once no code reads them.

create type public.store_status_override as enum ('auto', 'open', 'paused', 'closed');

alter table public.stores
  add column status_override public.store_status_override not null default 'closed';

-- Keep the previous manual decision: an open store stays open, a closed one stays closed.
update public.stores
set status_override = case when is_open then 'open' else 'closed' end::public.store_status_override;

alter table public.stores
  alter column delivery_fee_cents drop default,
  alter column delivery_fee_cents drop not null,
  alter column timezone set default 'America/Argentina/Tucuman',
  add constraint stores_delivery_fee_required_to_accept_orders
    check (delivery_fee_cents is not null or status_override in ('paused', 'closed'));

comment on column public.stores.status_override is
  'Manual switch: auto follows store_business_hours; open, paused and closed override them.';
comment on column public.stores.is_open is
  'DEPRECATED (BB-08): superseded by status_override; not read by the app. Will be dropped.';
comment on column public.stores.business_hours is
  'DEPRECATED (BB-08): superseded by store_business_hours; not read by the app. Will be dropped.';
comment on column public.stores.delivery_fee_cents is
  'Fixed delivery fee in cents; null means not configured, which keeps orders disabled.';

update public.stores
set timezone = 'America/Argentina/Tucuman'
where timezone = 'America/Argentina/Buenos_Aires';

create function private.assert_valid_store_timezone()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception using
      errcode = '22023',
      message = format('unknown time zone: %s', new.timezone);
  end if;
  return new;
end;
$$;
revoke all on function private.assert_valid_store_timezone() from public, anon, authenticated;

create trigger stores_assert_valid_timezone before insert or update of timezone on public.stores
for each row execute function private.assert_valid_store_timezone();

create table public.store_business_hours (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  opens_at time not null check (opens_at < '24:00'),
  closes_at time not null check (closes_at < '24:00'),
  created_at timestamptz not null default now(),
  constraint store_business_hours_not_empty check (opens_at <> closes_at),
  unique (store_id, day_of_week, opens_at)
);
comment on table public.store_business_hours is
  'Weekly shifts in stores.timezone. day_of_week: 0 = Sunday … 6 = Saturday, the day the shift opens. '
  'closes_at <= opens_at means the shift closes the next day (00:00 = at midnight).';

alter table public.store_business_hours enable row level security;

revoke all on table public.store_business_hours from anon, authenticated;
grant select on table public.store_business_hours to anon;
grant select, insert, update, delete on table public.store_business_hours to authenticated;
grant all on table public.store_business_hours to service_role;

create policy store_business_hours_anon_read on public.store_business_hours for select to anon
using (exists (
  select 1 from public.stores s where s.id = store_business_hours.store_id and s.is_public
));
create policy store_business_hours_authenticated_read on public.store_business_hours for select to authenticated
using (
  exists (select 1 from public.stores s where s.id = store_business_hours.store_id and s.is_public)
  or exists (
    select 1 from public.admin_memberships m
    where m.store_id = store_business_hours.store_id and m.user_id = (select auth.uid()) and m.is_active
  )
);
create policy store_business_hours_admin_insert on public.store_business_hours for insert to authenticated
with check (exists (
  select 1 from public.admin_memberships m
  where m.store_id = store_business_hours.store_id and m.user_id = (select auth.uid()) and m.is_active
));
create policy store_business_hours_admin_update on public.store_business_hours for update to authenticated
using (exists (
  select 1 from public.admin_memberships m
  where m.store_id = store_business_hours.store_id and m.user_id = (select auth.uid()) and m.is_active
))
with check (exists (
  select 1 from public.admin_memberships m
  where m.store_id = store_business_hours.store_id and m.user_id = (select auth.uid()) and m.is_active
));
create policy store_business_hours_admin_delete on public.store_business_hours for delete to authenticated
using (exists (
  select 1 from public.admin_memberships m
  where m.store_id = store_business_hours.store_id and m.user_id = (select auth.uid()) and m.is_active
));
