-- BB-12: catalog administration.
-- Additive only: manual product order, image focal point and a database rule that drinks never
-- contain alcohol. Existing rows keep their current order (sort_order 0 falls back to name) and
-- a centred focal point.

alter table public.products
  add column sort_order integer not null default 0;
create index products_admin_order_idx
  on public.products(store_id, category_id, sort_order);

alter table public.product_images
  add column focal_x smallint not null default 50
    constraint product_images_focal_x_check check (focal_x between 0 and 100),
  add column focal_y smallint not null default 50
    constraint product_images_focal_y_check check (focal_y between 0 and 100);

-- A product in a drink category can never be stored as alcoholic, whoever writes it.
create function private.enforce_drinks_without_alcohol()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.contains_alcohol and exists (
    select 1
    from public.categories c
    where c.id = new.category_id and c.store_id = new.store_id and c.kind = 'drink'
  ) then
    raise exception using
      errcode = 'BB012',
      message = 'Drinks must not contain alcohol.';
  end if;
  return new;
end;
$$;
revoke all on function private.enforce_drinks_without_alcohol()
from public, anon, authenticated;

create trigger products_drinks_without_alcohol
before insert or update of contains_alcohol, category_id on public.products
for each row execute function private.enforce_drinks_without_alcohol();
