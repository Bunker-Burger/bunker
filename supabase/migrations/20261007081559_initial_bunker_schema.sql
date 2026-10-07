create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.category_kind as enum ('burger', 'sandwich', 'side', 'drink', 'other');
create type public.admin_role as enum ('owner', 'admin');
create type public.option_selection_mode as enum ('single', 'multiple');
create type public.promotion_type as enum ('fixed_price', 'percent_off', 'buy_x_get_y', 'free_delivery');
create type public.fulfillment_channel as enum ('delivery', 'pickup');
create type public.payment_method_kind as enum ('cash', 'bank_transfer', 'mercado_pago');
create type public.payment_attempt_status as enum (
  'created', 'pending', 'approved', 'rejected', 'cancelled', 'refunded', 'expired'
);

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  whatsapp_e164 text not null check (whatsapp_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  timezone text not null default 'America/Argentina/Buenos_Aires'
    check (length(btrim(timezone)) between 1 and 64),
  currency text not null default 'ARS' check (currency ~ '^[A-Z]{3}$'),
  is_open boolean not null default false,
  is_public boolean not null default false,
  delivery_fee_cents bigint not null default 0 check (delivery_fee_cents >= 0),
  business_hours jsonb not null default '{}'::jsonb check (jsonb_typeof(business_hours) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.admin_memberships (
  store_id uuid not null references public.stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.admin_role not null default 'admin',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (store_id, user_id)
);
create index admin_memberships_user_id_idx on public.admin_memberships(user_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  kind public.category_kind not null,
  sort_order integer not null default 0,
  is_visible boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, slug),
  unique (id, store_id)
);
create index categories_public_idx on public.categories(store_id, is_visible, sort_order);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  category_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 100),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text not null default '' check (length(description) <= 1000),
  base_price_cents bigint not null default 0 check (base_price_cents >= 0),
  is_published boolean not null default false,
  is_available boolean not null default true,
  is_featured boolean not null default false,
  contains_alcohol boolean not null default false,
  alcohol_by_volume numeric(5,2) not null default 0
    check (alcohol_by_volume >= 0 and alcohol_by_volume <= 100),
  requires_age_verification boolean not null default false,
  dietary_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(dietary_metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_category_store_fk
    foreign key (category_id, store_id) references public.categories(id, store_id),
  constraint products_publication_valid_check check (
    not is_published or (
      base_price_cents > 0
      and length(btrim(name)) > 0
      and length(btrim(description)) > 0
    )
  ),
  constraint products_alcohol_rules_check check (
    (
      not contains_alcohol
      and alcohol_by_volume = 0
      and not requires_age_verification
    ) or (
      contains_alcohol
      and alcohol_by_volume > 0
      and requires_age_verification
    )
  ),
  unique (store_id, slug),
  unique (id, store_id)
);
create index products_public_idx
  on public.products(store_id, category_id, is_published, is_available);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null unique
    check (storage_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_-]+\.(avif|jpe?g|png|webp)$'),
  alt_text text not null check (length(btrim(alt_text)) between 1 and 180),
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
create index product_images_product_idx on public.product_images(product_id, sort_order);
create unique index product_images_one_primary_idx
  on public.product_images(product_id) where is_primary;

create table public.option_groups (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  selection_mode public.option_selection_mode not null,
  minimum_selections smallint not null default 0 check (minimum_selections >= 0),
  maximum_selections smallint not null default 1 check (maximum_selections >= 1),
  is_required boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint option_groups_cardinality_check check (
    minimum_selections <= maximum_selections
    and (not is_required or minimum_selections >= 1)
    and (selection_mode <> 'single' or maximum_selections = 1)
  ),
  unique (id, store_id)
);

create table public.options (
  id uuid primary key default gen_random_uuid(),
  option_group_id uuid not null references public.option_groups(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  description text not null default '' check (length(description) <= 300),
  price_delta_cents bigint not null default 0 check (price_delta_cents >= 0),
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (option_group_id, name)
);
create index options_group_idx on public.options(option_group_id, sort_order);

create table public.product_option_groups (
  product_id uuid not null,
  option_group_id uuid not null,
  store_id uuid not null,
  minimum_selections_override smallint check (minimum_selections_override >= 0),
  maximum_selections_override smallint check (maximum_selections_override >= 1),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (product_id, option_group_id),
  constraint product_option_groups_product_fk
    foreign key (product_id, store_id) references public.products(id, store_id) on delete cascade,
  constraint product_option_groups_group_fk
    foreign key (option_group_id, store_id) references public.option_groups(id, store_id) on delete cascade,
  constraint product_option_groups_cardinality_check check (
    minimum_selections_override is null
    or maximum_selections_override is null
    or minimum_selections_override <= maximum_selections_override
  )
);
create index product_option_groups_group_idx on public.product_option_groups(option_group_id);

create table public.promotion_rules (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text not null default '' check (length(description) <= 1000),
  badge_text text check (badge_text is null or length(btrim(badge_text)) between 1 and 24),
  promotion_type public.promotion_type not null,
  priority smallint not null check (priority >= 0),
  is_active boolean not null default false,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  fixed_price_cents bigint check (fixed_price_cents > 0),
  percent_off numeric(5,2) check (percent_off > 0 and percent_off <= 100),
  buy_quantity smallint check (buy_quantity > 0),
  get_quantity smallint check (get_quantity > 0),
  applies_to_delivery boolean not null default true,
  applies_to_pickup boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint promotion_rules_window_check check (ends_at > starts_at),
  constraint promotion_rules_channel_check check (applies_to_delivery or applies_to_pickup),
  constraint promotion_rules_mechanic_check check (
    (promotion_type = 'fixed_price' and fixed_price_cents is not null and percent_off is null and buy_quantity is null and get_quantity is null)
    or (promotion_type = 'percent_off' and fixed_price_cents is null and percent_off is not null and buy_quantity is null and get_quantity is null)
    or (promotion_type = 'buy_x_get_y' and fixed_price_cents is null and percent_off is null and buy_quantity is not null and get_quantity is not null)
    or (promotion_type = 'free_delivery' and fixed_price_cents is null and percent_off is null and buy_quantity is null and get_quantity is null)
  ),
  unique (store_id, slug),
  unique (store_id, priority),
  unique (id, store_id)
);
create index promotion_rules_public_idx
  on public.promotion_rules(store_id, is_active, starts_at, ends_at, priority);

create table public.promotion_items (
  promotion_id uuid not null,
  product_id uuid not null,
  store_id uuid not null,
  quantity smallint not null default 1 check (quantity > 0),
  created_at timestamptz not null default now(),
  primary key (promotion_id, product_id),
  constraint promotion_items_promotion_fk
    foreign key (promotion_id, store_id) references public.promotion_rules(id, store_id) on delete cascade,
  constraint promotion_items_product_fk
    foreign key (product_id, store_id) references public.products(id, store_id) on delete cascade
);
create index promotion_items_product_idx on public.promotion_items(product_id);

create table public.promotion_schedule (
  id uuid primary key default gen_random_uuid(),
  promotion_id uuid not null references public.promotion_rules(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  created_at timestamptz not null default now(),
  unique (promotion_id, day_of_week, starts_at, ends_at)
);
create index promotion_schedule_promotion_idx on public.promotion_schedule(promotion_id);

create table public.store_payment_methods (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  method public.payment_method_kind not null,
  display_name text not null check (length(btrim(display_name)) between 1 and 60),
  public_instructions text not null default '' check (length(public_instructions) <= 500),
  is_enabled boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, method)
);
create index store_payment_methods_public_idx
  on public.store_payment_methods(store_id, is_enabled, sort_order);

create table public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  provider text not null default 'mercado_pago' check (provider = 'mercado_pago'),
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  idempotency_key text not null unique check (length(idempotency_key) between 16 and 128),
  external_reference text not null unique check (length(external_reference) between 8 and 128),
  provider_preference_id text unique,
  provider_payment_id text unique,
  status public.payment_attempt_status not null default 'created',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index payment_attempts_store_created_idx on public.payment_attempts(store_id, created_at desc);
create index payment_attempts_retention_idx on public.payment_attempts(created_at);

create function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function private.set_updated_at() from public, anon, authenticated;

create trigger stores_set_updated_at before update on public.stores
for each row execute function private.set_updated_at();
create trigger categories_set_updated_at before update on public.categories
for each row execute function private.set_updated_at();
create trigger products_set_updated_at before update on public.products
for each row execute function private.set_updated_at();
create trigger option_groups_set_updated_at before update on public.option_groups
for each row execute function private.set_updated_at();
create trigger options_set_updated_at before update on public.options
for each row execute function private.set_updated_at();
create trigger promotion_rules_set_updated_at before update on public.promotion_rules
for each row execute function private.set_updated_at();
create trigger store_payment_methods_set_updated_at before update on public.store_payment_methods
for each row execute function private.set_updated_at();
create trigger payment_attempts_set_updated_at before update on public.payment_attempts
for each row execute function private.set_updated_at();

create function private.purge_expired_payment_data()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count bigint;
begin
  delete from public.payment_attempts
  where created_at < now() - interval '90 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
comment on function private.purge_expired_payment_data() is
  'Deletes Mercado Pago attempt data older than the 90-day operational retention period.';
revoke all on function private.purge_expired_payment_data() from public, anon, authenticated;
grant execute on function private.purge_expired_payment_data() to service_role;

alter table public.stores enable row level security;
alter table public.admin_memberships enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;
alter table public.option_groups enable row level security;
alter table public.options enable row level security;
alter table public.product_option_groups enable row level security;
alter table public.promotion_rules enable row level security;
alter table public.promotion_items enable row level security;
alter table public.promotion_schedule enable row level security;
alter table public.store_payment_methods enable row level security;
alter table public.payment_attempts enable row level security;

revoke all on table public.stores, public.admin_memberships, public.categories,
  public.products, public.product_images, public.option_groups, public.options,
  public.product_option_groups, public.promotion_rules, public.promotion_items,
  public.promotion_schedule, public.store_payment_methods, public.payment_attempts
from anon, authenticated;

grant select on table public.stores, public.categories, public.products,
  public.product_images, public.option_groups, public.options,
  public.product_option_groups, public.promotion_rules, public.promotion_items,
  public.promotion_schedule, public.store_payment_methods
to anon;

grant select, insert, update, delete on table public.stores, public.categories,
  public.products, public.product_images, public.option_groups, public.options,
  public.product_option_groups, public.promotion_rules, public.promotion_items,
  public.promotion_schedule, public.store_payment_methods
to authenticated;
grant select on table public.admin_memberships, public.payment_attempts to authenticated;

grant all on table public.stores, public.admin_memberships, public.categories,
  public.products, public.product_images, public.option_groups, public.options,
  public.product_option_groups, public.promotion_rules, public.promotion_items,
  public.promotion_schedule, public.store_payment_methods, public.payment_attempts
to service_role;

create policy stores_public_read on public.stores for select to anon, authenticated
using (is_public);
create policy stores_admin_read on public.stores for select to authenticated
using (exists (
  select 1 from public.admin_memberships m
  where m.store_id = stores.id and m.user_id = (select auth.uid()) and m.is_active
));
create policy stores_admin_update on public.stores for update to authenticated
using (exists (
  select 1 from public.admin_memberships m
  where m.store_id = stores.id and m.user_id = (select auth.uid()) and m.is_active
))
with check (exists (
  select 1 from public.admin_memberships m
  where m.store_id = stores.id and m.user_id = (select auth.uid()) and m.is_active
));

create policy memberships_read_self on public.admin_memberships for select to authenticated
using ((select auth.uid()) is not null and user_id = (select auth.uid()));

create policy categories_public_read on public.categories for select to anon, authenticated
using (is_visible and exists (
  select 1 from public.stores s where s.id = categories.store_id and s.is_public
));
create policy categories_admin_all on public.categories for all to authenticated
using (exists (
  select 1 from public.admin_memberships m
  where m.store_id = categories.store_id and m.user_id = (select auth.uid()) and m.is_active
))
with check (exists (
  select 1 from public.admin_memberships m
  where m.store_id = categories.store_id and m.user_id = (select auth.uid()) and m.is_active
));

create policy products_public_read on public.products for select to anon, authenticated
using (
  is_published and is_available
  and exists (
    select 1 from public.stores s where s.id = products.store_id and s.is_public
  )
  and exists (
    select 1 from public.categories c
    where c.id = products.category_id and c.store_id = products.store_id and c.is_visible
  )
);
create policy products_admin_all on public.products for all to authenticated
using (exists (
  select 1 from public.admin_memberships m
  where m.store_id = products.store_id and m.user_id = (select auth.uid()) and m.is_active
))
with check (exists (
  select 1 from public.admin_memberships m
  where m.store_id = products.store_id and m.user_id = (select auth.uid()) and m.is_active
));

create policy product_images_public_read on public.product_images for select to anon, authenticated
using (exists (select 1 from public.products p where p.id = product_images.product_id));
create policy product_images_admin_all on public.product_images for all to authenticated
using (exists (
  select 1 from public.products p join public.admin_memberships m on m.store_id = p.store_id
  where p.id = product_images.product_id and m.user_id = (select auth.uid()) and m.is_active
))
with check (exists (
  select 1 from public.products p join public.admin_memberships m on m.store_id = p.store_id
  where p.id = product_images.product_id and m.user_id = (select auth.uid()) and m.is_active
));

create policy option_groups_public_read on public.option_groups for select to anon, authenticated
using (exists (
  select 1 from public.product_option_groups pog
  join public.products p on p.id = pog.product_id
  where pog.option_group_id = option_groups.id
));
create policy option_groups_admin_all on public.option_groups for all to authenticated
using (exists (
  select 1 from public.admin_memberships m
  where m.store_id = option_groups.store_id and m.user_id = (select auth.uid()) and m.is_active
))
with check (exists (
  select 1 from public.admin_memberships m
  where m.store_id = option_groups.store_id and m.user_id = (select auth.uid()) and m.is_active
));

create policy options_public_read on public.options for select to anon, authenticated
using (is_available and exists (
  select 1 from public.option_groups og where og.id = options.option_group_id
));
create policy options_admin_all on public.options for all to authenticated
using (exists (
  select 1 from public.option_groups og
  join public.admin_memberships m on m.store_id = og.store_id
  where og.id = options.option_group_id and m.user_id = (select auth.uid()) and m.is_active
))
with check (exists (
  select 1 from public.option_groups og
  join public.admin_memberships m on m.store_id = og.store_id
  where og.id = options.option_group_id and m.user_id = (select auth.uid()) and m.is_active
));

create policy product_option_groups_public_read on public.product_option_groups for select to anon, authenticated
using (exists (select 1 from public.products p where p.id = product_option_groups.product_id));
create policy product_option_groups_admin_all on public.product_option_groups for all to authenticated
using (exists (
  select 1 from public.admin_memberships m
  where m.store_id = product_option_groups.store_id and m.user_id = (select auth.uid()) and m.is_active
))
with check (exists (
  select 1 from public.admin_memberships m
  where m.store_id = product_option_groups.store_id and m.user_id = (select auth.uid()) and m.is_active
));

create policy promotion_rules_public_read on public.promotion_rules for select to anon, authenticated
using (
  is_active and now() between starts_at and ends_at
  and exists (select 1 from public.stores s where s.id = promotion_rules.store_id and s.is_public)
);
create policy promotion_rules_admin_all on public.promotion_rules for all to authenticated
using (exists (
  select 1 from public.admin_memberships m
  where m.store_id = promotion_rules.store_id and m.user_id = (select auth.uid()) and m.is_active
))
with check (exists (
  select 1 from public.admin_memberships m
  where m.store_id = promotion_rules.store_id and m.user_id = (select auth.uid()) and m.is_active
));

create policy promotion_items_public_read on public.promotion_items for select to anon, authenticated
using (exists (select 1 from public.promotion_rules pr where pr.id = promotion_items.promotion_id));
create policy promotion_items_admin_all on public.promotion_items for all to authenticated
using (exists (
  select 1 from public.admin_memberships m
  where m.store_id = promotion_items.store_id and m.user_id = (select auth.uid()) and m.is_active
))
with check (exists (
  select 1 from public.admin_memberships m
  where m.store_id = promotion_items.store_id and m.user_id = (select auth.uid()) and m.is_active
));

create policy promotion_schedule_public_read on public.promotion_schedule for select to anon, authenticated
using (exists (select 1 from public.promotion_rules pr where pr.id = promotion_schedule.promotion_id));
create policy promotion_schedule_admin_all on public.promotion_schedule for all to authenticated
using (exists (
  select 1 from public.promotion_rules pr
  join public.admin_memberships m on m.store_id = pr.store_id
  where pr.id = promotion_schedule.promotion_id and m.user_id = (select auth.uid()) and m.is_active
))
with check (exists (
  select 1 from public.promotion_rules pr
  join public.admin_memberships m on m.store_id = pr.store_id
  where pr.id = promotion_schedule.promotion_id and m.user_id = (select auth.uid()) and m.is_active
));

create policy payment_methods_public_read on public.store_payment_methods for select to anon, authenticated
using (is_enabled and exists (
  select 1 from public.stores s where s.id = store_payment_methods.store_id and s.is_public
));
create policy payment_methods_admin_all on public.store_payment_methods for all to authenticated
using (exists (
  select 1 from public.admin_memberships m
  where m.store_id = store_payment_methods.store_id and m.user_id = (select auth.uid()) and m.is_active
))
with check (exists (
  select 1 from public.admin_memberships m
  where m.store_id = store_payment_methods.store_id and m.user_id = (select auth.uid()) and m.is_active
));

create policy payment_attempts_admin_read on public.payment_attempts for select to authenticated
using (exists (
  select 1 from public.admin_memberships m
  where m.store_id = payment_attempts.store_id and m.user_id = (select auth.uid()) and m.is_active
));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'catalog', 'catalog', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy catalog_objects_public_read on storage.objects for select to anon, authenticated
using (bucket_id = 'catalog');
create policy catalog_objects_admin_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'catalog'
  and exists (
    select 1 from public.admin_memberships m
    where m.store_id::text = (storage.foldername(name))[1]
      and m.user_id = (select auth.uid()) and m.is_active
  )
);
create policy catalog_objects_admin_update on storage.objects for update to authenticated
using (
  bucket_id = 'catalog'
  and exists (
    select 1 from public.admin_memberships m
    where m.store_id::text = (storage.foldername(name))[1]
      and m.user_id = (select auth.uid()) and m.is_active
  )
)
with check (
  bucket_id = 'catalog'
  and exists (
    select 1 from public.admin_memberships m
    where m.store_id::text = (storage.foldername(name))[1]
      and m.user_id = (select auth.uid()) and m.is_active
  )
);
create policy catalog_objects_admin_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'catalog'
  and exists (
    select 1 from public.admin_memberships m
    where m.store_id::text = (storage.foldername(name))[1]
      and m.user_id = (select auth.uid()) and m.is_active
  )
);
