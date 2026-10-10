-- Signed-in catalog reads timed out (statement_timeout, 57014): every `authenticated` read policy
-- is "(public rule) OR (admin rule)", and the public rule does EXISTS on other tables that apply
-- their own RLS, so reading `options` re-evaluated the policies of option_groups,
-- product_option_groups, products, categories, stores and admin_memberships at every hop.
--
-- The cross-table checks move into small SECURITY DEFINER functions that read those tables
-- directly (no nested RLS). Each function encodes exactly the rule the old nested EXISTS applied,
-- so what every role can read or write does not change. `anon` policies are untouched.

-- Own schema for the helpers: `private` stays closed to browser roles (bb03_security), and
-- PostgREST does not expose this schema, so the helpers are only reachable from policies.
create schema catalog_rls;
revoke all on schema catalog_rls from public, anon, authenticated;
grant usage on schema catalog_rls to authenticated;

-- Active admin of the store (same rule as every *_admin_* policy).
create function catalog_rls.is_store_admin(target_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_memberships m
    where m.store_id = target_store_id
      and m.user_id = (select auth.uid())
      and m.is_active
  );
$$;

create function catalog_rls.store_is_public(target_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.stores s where s.id = target_store_id and s.is_public);
$$;

create function catalog_rls.category_is_visible(target_category_id uuid, target_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.categories c
    where c.id = target_category_id and c.store_id = target_store_id and c.is_visible
  );
$$;

-- What `products_authenticated_read` allows: published in a public store and visible category,
-- or any product of a store the caller administers.
create function catalog_rls.product_is_readable(target_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.products p
    where p.id = target_product_id
      and (
        (
          p.is_published
          and catalog_rls.store_is_public(p.store_id)
          and catalog_rls.category_is_visible(p.category_id, p.store_id)
        )
        or catalog_rls.is_store_admin(p.store_id)
      )
  );
$$;

create function catalog_rls.is_product_admin(target_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.products p
    where p.id = target_product_id and catalog_rls.is_store_admin(p.store_id)
  );
$$;

-- An option group is readable through any link to a readable product.
create function catalog_rls.option_group_is_readable(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.product_option_groups pog
    where pog.option_group_id = target_group_id and catalog_rls.product_is_readable(pog.product_id)
  );
$$;

create function catalog_rls.is_option_group_admin(target_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.option_groups og
    where og.id = target_group_id and catalog_rls.is_store_admin(og.store_id)
  );
$$;

-- What `promotion_rules_authenticated_read` allows.
create function catalog_rls.promotion_is_readable(target_promotion_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.promotion_rules pr
    where pr.id = target_promotion_id
      and (
        (pr.is_active and now() between pr.starts_at and pr.ends_at and catalog_rls.store_is_public(pr.store_id))
        or catalog_rls.is_store_admin(pr.store_id)
      )
  );
$$;

create function catalog_rls.is_promotion_admin(target_promotion_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.promotion_rules pr
    where pr.id = target_promotion_id and catalog_rls.is_store_admin(pr.store_id)
  );
$$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'catalog_rls.is_store_admin(uuid)',
    'catalog_rls.store_is_public(uuid)',
    'catalog_rls.category_is_visible(uuid, uuid)',
    'catalog_rls.product_is_readable(uuid)',
    'catalog_rls.is_product_admin(uuid)',
    'catalog_rls.option_group_is_readable(uuid)',
    'catalog_rls.is_option_group_admin(uuid)',
    'catalog_rls.promotion_is_readable(uuid)',
    'catalog_rls.is_promotion_admin(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

-- Signed-in reads: same "(public rule) OR (admin rule)" as before, without nested RLS.

drop policy categories_authenticated_read on public.categories;
create policy categories_authenticated_read on public.categories for select to authenticated
using ((is_visible and catalog_rls.store_is_public(store_id)) or catalog_rls.is_store_admin(store_id));

drop policy products_authenticated_read on public.products;
create policy products_authenticated_read on public.products for select to authenticated
using (
  (is_published and catalog_rls.store_is_public(store_id) and catalog_rls.category_is_visible(category_id, store_id))
  or catalog_rls.is_store_admin(store_id)
);

drop policy product_images_authenticated_read on public.product_images;
create policy product_images_authenticated_read on public.product_images for select to authenticated
using (catalog_rls.product_is_readable(product_id));

drop policy product_option_groups_authenticated_read on public.product_option_groups;
create policy product_option_groups_authenticated_read on public.product_option_groups for select to authenticated
using (catalog_rls.product_is_readable(product_id) or catalog_rls.is_store_admin(store_id));

drop policy option_groups_authenticated_read on public.option_groups;
create policy option_groups_authenticated_read on public.option_groups for select to authenticated
using (catalog_rls.option_group_is_readable(id) or catalog_rls.is_store_admin(store_id));

drop policy options_authenticated_read on public.options;
create policy options_authenticated_read on public.options for select to authenticated
using (
  (is_available and catalog_rls.option_group_is_readable(option_group_id))
  or catalog_rls.is_option_group_admin(option_group_id)
);

drop policy promotion_rules_authenticated_read on public.promotion_rules;
create policy promotion_rules_authenticated_read on public.promotion_rules for select to authenticated
using (
  (is_active and now() between starts_at and ends_at and catalog_rls.store_is_public(store_id))
  or catalog_rls.is_store_admin(store_id)
);

drop policy promotion_items_authenticated_read on public.promotion_items;
create policy promotion_items_authenticated_read on public.promotion_items for select to authenticated
using (catalog_rls.promotion_is_readable(promotion_id) or catalog_rls.is_store_admin(store_id));

drop policy promotion_schedule_authenticated_read on public.promotion_schedule;
create policy promotion_schedule_authenticated_read on public.promotion_schedule for select to authenticated
using (catalog_rls.promotion_is_readable(promotion_id));

drop policy store_payment_methods_authenticated_read on public.store_payment_methods;
create policy store_payment_methods_authenticated_read on public.store_payment_methods for select to authenticated
using ((is_enabled and catalog_rls.store_is_public(store_id)) or catalog_rls.is_store_admin(store_id));

drop policy store_business_hours_authenticated_read on public.store_business_hours;
create policy store_business_hours_authenticated_read on public.store_business_hours for select to authenticated
using (catalog_rls.store_is_public(store_id) or catalog_rls.is_store_admin(store_id));

-- Admin writes whose rule joined a table with its own RLS.

drop policy product_images_admin_insert on public.product_images;
drop policy product_images_admin_update on public.product_images;
drop policy product_images_admin_delete on public.product_images;
create policy product_images_admin_insert on public.product_images for insert to authenticated
with check (catalog_rls.is_product_admin(product_id));
create policy product_images_admin_update on public.product_images for update to authenticated
using (catalog_rls.is_product_admin(product_id)) with check (catalog_rls.is_product_admin(product_id));
create policy product_images_admin_delete on public.product_images for delete to authenticated
using (catalog_rls.is_product_admin(product_id));

drop policy options_admin_insert on public.options;
drop policy options_admin_update on public.options;
drop policy options_admin_delete on public.options;
create policy options_admin_insert on public.options for insert to authenticated
with check (catalog_rls.is_option_group_admin(option_group_id));
create policy options_admin_update on public.options for update to authenticated
using (catalog_rls.is_option_group_admin(option_group_id)) with check (catalog_rls.is_option_group_admin(option_group_id));
create policy options_admin_delete on public.options for delete to authenticated
using (catalog_rls.is_option_group_admin(option_group_id));

drop policy promotion_schedule_admin_insert on public.promotion_schedule;
drop policy promotion_schedule_admin_update on public.promotion_schedule;
drop policy promotion_schedule_admin_delete on public.promotion_schedule;
create policy promotion_schedule_admin_insert on public.promotion_schedule for insert to authenticated
with check (catalog_rls.is_promotion_admin(promotion_id));
create policy promotion_schedule_admin_update on public.promotion_schedule for update to authenticated
using (catalog_rls.is_promotion_admin(promotion_id)) with check (catalog_rls.is_promotion_admin(promotion_id));
create policy promotion_schedule_admin_delete on public.promotion_schedule for delete to authenticated
using (catalog_rls.is_promotion_admin(promotion_id));
