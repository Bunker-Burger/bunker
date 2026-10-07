create type public.payment_webhook_processing_status as enum (
  'processing', 'completed', 'failed'
);

alter table public.product_option_groups
add column default_option_ids uuid[] not null default '{}'::uuid[];

create table public.payment_quotes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  lines jsonb not null
    check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0),
  subtotal_cents bigint not null check (subtotal_cents >= 0),
  discount_cents bigint not null default 0 check (discount_cents >= 0),
  delivery_cents bigint not null default 0 check (delivery_cents >= 0),
  total_cents bigint not null check (total_cents >= 0),
  currency text not null default 'ARS' check (currency ~ '^[A-Z]{3}$'),
  fulfillment_channel public.fulfillment_channel not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint payment_quotes_amounts_check check (
    discount_cents <= subtotal_cents
    and total_cents = subtotal_cents - discount_cents + delivery_cents
  ),
  constraint payment_quotes_expiry_check check (expires_at > created_at),
  unique (id, store_id)
);
create index payment_quotes_store_created_idx
  on public.payment_quotes(store_id, created_at desc);
create index payment_quotes_retention_idx on public.payment_quotes(created_at);

alter table public.payment_attempts
add column quote_id uuid;
alter table public.payment_attempts
add constraint payment_attempts_quote_store_fk
foreign key (quote_id, store_id)
references public.payment_quotes(id, store_id) on delete cascade;
alter table public.payment_attempts
add constraint payment_attempts_quote_required_for_new_rows
check (quote_id is not null) not valid;
comment on constraint payment_attempts_quote_required_for_new_rows
on public.payment_attempts is
  'Enforced for new writes; pre-BB-03 attempts remain readable until normal 90-day retention removes them.';
create index payment_attempts_quote_id_idx on public.payment_attempts(quote_id);

create table public.payment_webhook_events (
  event_id text primary key check (length(event_id) between 1 and 255),
  provider text not null default 'mercado_pago' check (provider = 'mercado_pago'),
  provider_payment_id text not null check (length(provider_payment_id) between 1 and 255),
  processing_status public.payment_webhook_processing_status not null default 'processing',
  last_error_code text check (
    last_error_code is null or length(last_error_code) between 1 and 80
  ),
  received_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint payment_webhook_events_completion_check check (
    (processing_status = 'completed' and completed_at is not null and last_error_code is null)
    or (processing_status = 'processing' and completed_at is null and last_error_code is null)
    or (processing_status = 'failed' and completed_at is null)
  )
);
create index payment_webhook_events_provider_payment_idx
  on public.payment_webhook_events(provider_payment_id);
create index payment_webhook_events_retention_idx
  on public.payment_webhook_events(received_at);

create function private.product_configuration_is_valid(target_product_id uuid)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select not exists (
    select 1
    from public.product_option_groups pog
    join public.option_groups og on og.id = pog.option_group_id
    where pog.product_id = target_product_id
      and (
        cardinality(pog.default_option_ids)
          < coalesce(pog.minimum_selections_override, og.minimum_selections)
        or cardinality(pog.default_option_ids)
          > coalesce(pog.maximum_selections_override, og.maximum_selections)
        or cardinality(pog.default_option_ids) <> (
          select count(distinct defaults.option_id)
          from unnest(pog.default_option_ids) as defaults(option_id)
        )
        or exists (
          select 1
          from unnest(pog.default_option_ids) as selected(option_id)
          left join public.options o
            on o.id = selected.option_id
            and o.option_group_id = pog.option_group_id
          where o.id is null or not o.is_available
        )
      )
  );
$$;
comment on function private.product_configuration_is_valid(uuid) is
  'Validates default option cardinality, membership, uniqueness, and availability before publication.';
revoke all on function private.product_configuration_is_valid(uuid)
from public, anon, authenticated;

update public.product_option_groups
set default_option_ids = array['0199b2c8-40b0-7000-8000-000000000401'::uuid]
where product_id = '0199b2c8-40b0-7000-8000-000000000201'
  and option_group_id = '0199b2c8-40b0-7000-8000-000000000301'
  and exists (
    select 1
    from public.options o
    where o.id = '0199b2c8-40b0-7000-8000-000000000401'
      and o.option_group_id = product_option_groups.option_group_id
      and o.is_available
  );

update public.products p
set is_published = false
where p.is_published
  and not private.product_configuration_is_valid(p.id);

do $$
begin
  if exists (
    select 1
    from public.products p
    where p.is_published
      and not private.product_configuration_is_valid(p.id)
  ) then
    raise exception using
      errcode = 'BB003',
      message = 'BB-03 migration left an invalid published product.';
  end if;
end;
$$;

create function private.enforce_valid_product_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_published
    and not private.product_configuration_is_valid(new.id)
  then
    raise exception using
      errcode = 'BB003',
      message = 'Published products require valid default option selections.';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_valid_product_publication()
from public, anon, authenticated;

create trigger products_validate_configuration_before_publish
before insert or update on public.products
for each row execute function private.enforce_valid_product_publication();

create function private.enforce_product_option_group_validity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.products p
    where p.id = new.product_id and p.is_published
  ) and not private.product_configuration_is_valid(new.product_id)
  then
    raise exception using
      errcode = 'BB003',
      message = 'Published products require valid default option selections.';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_product_option_group_validity()
from public, anon, authenticated;

create trigger product_option_groups_preserve_published_validity
after insert or update on public.product_option_groups
for each row execute function private.enforce_product_option_group_validity();

create function private.enforce_option_default_validity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_product_id uuid;
begin
  for affected_product_id in
    select distinct pog.product_id
    from public.product_option_groups pog
    join public.products p on p.id = pog.product_id
    where p.is_published
      and pog.option_group_id = any (
        case
          when tg_op = 'UPDATE'
            then array[old.option_group_id, new.option_group_id]
          else array[old.option_group_id]
        end
      )
  loop
    if not private.product_configuration_is_valid(affected_product_id)
    then
      raise exception using
        errcode = 'BB003',
        message = 'Published products require available default option selections.';
    end if;
  end loop;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_option_default_validity()
from public, anon, authenticated;

create trigger options_preserve_published_default_validity
after update of id, option_group_id, is_available or delete on public.options
for each row execute function private.enforce_option_default_validity();

create function private.enforce_option_group_cardinality_validity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_product_id uuid;
begin
  for affected_product_id in
    select distinct pog.product_id
    from public.product_option_groups pog
    join public.products p on p.id = pog.product_id
    where pog.option_group_id = new.id and p.is_published
  loop
    if not private.product_configuration_is_valid(affected_product_id)
    then
      raise exception using
        errcode = 'BB003',
        message = 'Published products require valid option-group cardinality.';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.enforce_option_group_cardinality_validity()
from public, anon, authenticated;

create trigger option_groups_preserve_published_cardinality_validity
after update of minimum_selections, maximum_selections, is_required
on public.option_groups
for each row execute function private.enforce_option_group_cardinality_validity();

create or replace function private.purge_expired_payment_data()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_attempts bigint := 0;
  deleted_quotes bigint := 0;
  deleted_events bigint := 0;
begin
  delete from public.payment_attempts pa
  where pa.created_at < now() - interval '90 days'
    or exists (
      select 1
      from public.payment_quotes pq
      where pq.id = pa.quote_id
        and pq.created_at < now() - interval '90 days'
    );
  get diagnostics deleted_attempts = row_count;

  delete from public.payment_quotes
  where created_at < now() - interval '90 days';
  get diagnostics deleted_quotes = row_count;

  delete from public.payment_webhook_events
  where received_at < now() - interval '90 days';
  get diagnostics deleted_events = row_count;

  return deleted_attempts + deleted_quotes + deleted_events;
end;
$$;
comment on function private.purge_expired_payment_data() is
  'Deletes quotes, Mercado Pago attempts, and webhook events older than the 90-day operational retention period.';
revoke all on function private.purge_expired_payment_data()
from public, anon, authenticated;
grant execute on function private.purge_expired_payment_data() to service_role;

alter table public.payment_quotes enable row level security;
alter table public.payment_webhook_events enable row level security;

revoke all on table public.payment_quotes, public.payment_webhook_events
from anon, authenticated;
grant select on table public.payment_quotes to authenticated;
grant all on table public.payment_quotes, public.payment_webhook_events
to service_role;

create policy payment_quotes_admin_read
on public.payment_quotes for select to authenticated
using (exists (
  select 1
  from public.admin_memberships m
  where m.store_id = payment_quotes.store_id
    and m.user_id = (select auth.uid())
    and m.is_active
));

drop policy payment_attempts_admin_read on public.payment_attempts;
create policy payment_attempts_admin_read
on public.payment_attempts for select to authenticated
using (exists (
  select 1
  from public.admin_memberships m
  where m.store_id = payment_attempts.store_id
    and m.user_id = (select auth.uid())
    and m.is_active
));

drop policy products_public_read on public.products;
create policy products_public_read
on public.products for select to anon, authenticated
using (
  is_published
  and exists (
    select 1
    from public.stores s
    where s.id = products.store_id and s.is_public
  )
  and exists (
    select 1
    from public.categories c
    where c.id = products.category_id
      and c.store_id = products.store_id
      and c.is_visible
  )
);

drop policy catalog_objects_public_read on storage.objects;
drop policy catalog_objects_admin_insert on storage.objects;
drop policy catalog_objects_admin_update on storage.objects;
drop policy catalog_objects_admin_delete on storage.objects;

create policy catalog_objects_public_read
on storage.objects for select to anon, authenticated
using (bucket_id = 'catalog');

create policy catalog_objects_admin_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'catalog'
  and lower(storage.extension(name)) = any (array['avif', 'jpeg', 'jpg', 'png', 'webp'])
  and exists (
    select 1
    from public.admin_memberships m
    where m.store_id::text = (storage.foldername(name))[1]
      and m.user_id = (select auth.uid())
      and m.is_active
  )
);

create policy catalog_objects_admin_update
on storage.objects for update to authenticated
using (
  bucket_id = 'catalog'
  and exists (
    select 1
    from public.admin_memberships m
    where m.store_id::text = (storage.foldername(name))[1]
      and m.user_id = (select auth.uid())
      and m.is_active
  )
)
with check (
  bucket_id = 'catalog'
  and lower(storage.extension(name)) = any (array['avif', 'jpeg', 'jpg', 'png', 'webp'])
  and exists (
    select 1
    from public.admin_memberships m
    where m.store_id::text = (storage.foldername(name))[1]
      and m.user_id = (select auth.uid())
      and m.is_active
  )
);

create policy catalog_objects_admin_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'catalog'
  and exists (
    select 1
    from public.admin_memberships m
    where m.store_id::text = (storage.foldername(name))[1]
      and m.user_id = (select auth.uid())
      and m.is_active
  )
);
