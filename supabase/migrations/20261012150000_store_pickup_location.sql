-- Issue #54: where to pick up an order, shown at checkout when "Retiro en local" is chosen.
-- Both are optional; the app reads them only when the columns exist (deploying first is safe).

alter table public.stores
  add column pickup_address text check (pickup_address is null or length(pickup_address) between 1 and 200),
  add column pickup_maps_url text check (pickup_maps_url is null or (length(pickup_maps_url) <= 500 and pickup_maps_url ~ '^https://'));

comment on column public.stores.pickup_address is 'Address shown for pickup orders, e.g. "San Lorenzo 877, Aguilares, Tucumán".';
comment on column public.stores.pickup_maps_url is 'Link to the store on a map (https), shown as "Cómo llegar".';
