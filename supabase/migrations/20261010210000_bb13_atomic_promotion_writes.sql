-- BB-13: a promotion is saved and reordered in one transaction.
-- Until now the admin wrote a promotion in several requests (row, products, windows, activation)
-- and reordered two promotions with three updates through a free priority. A failure in the
-- middle left the intermediate state stored, and a quote could read it. These two functions do
-- each operation as a single statement: either everything is stored or nothing is.
--
-- Additive only: two functions, no table, policy or data change.
-- SECURITY INVOKER: they run as the signed-in admin, so RLS (admin_memberships) still decides
-- every read and write, exactly as the separate requests did. The store id comes from the
-- server's membership check, never from the browser; RLS re-checks it on every row.
-- They first require the caller to administer the store (catalog_rls.is_store_admin, the same
-- helper the policies use). A per-store transaction advisory lock then serializes saves and
-- reorders of one store, so two admins never compute the same free or new priority from a stale
-- read; the rows being moved are also locked against concurrent edits or deletes.

create function public.admin_save_promotion(
  target_store_id uuid,
  target_promotion_id uuid,
  promotion jsonb,
  items jsonb,
  schedule jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved_id uuid;
  next_priority integer;
begin
  if target_store_id is null
    or pg_catalog.jsonb_typeof(promotion) is distinct from 'object'
    or pg_catalog.jsonb_typeof(items) is distinct from 'array'
    or pg_catalog.jsonb_typeof(schedule) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'admin_save_promotion: malformed arguments';
  end if;

  -- Active promotions are publicly readable, so "can see it" is not "administers it": the caller
  -- must administer the store before anything is read or written (RLS still checks every row).
  if not catalog_rls.is_store_admin(target_store_id) then
    raise exception using errcode = '42501', message = 'not an admin of this store';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('promotion_rules:' || target_store_id::text, 0));

  if target_promotion_id is null then
    select coalesce(max(pr.priority), 0) + 1 into next_priority
    from public.promotion_rules pr
    where pr.store_id = target_store_id;
    if next_priority > 32767 then
      raise exception using errcode = 'BB013', message = 'admin_save_promotion: no free priority left';
    end if;

    insert into public.promotion_rules (
      store_id, priority, name, slug, description, badge_text, promotion_type,
      fixed_price_cents, percent_off, buy_quantity, get_quantity,
      applies_to_delivery, applies_to_pickup, starts_at, ends_at, is_active
    ) values (
      target_store_id,
      next_priority,
      promotion->>'name',
      promotion->>'slug',
      coalesce(promotion->>'description', ''),
      promotion->>'badge_text',
      (promotion->>'promotion_type')::public.promotion_type,
      (promotion->>'fixed_price_cents')::bigint,
      (promotion->>'percent_off')::numeric,
      (promotion->>'buy_quantity')::smallint,
      (promotion->>'get_quantity')::smallint,
      (promotion->>'applies_to_delivery')::boolean,
      (promotion->>'applies_to_pickup')::boolean,
      (promotion->>'starts_at')::timestamptz,
      (promotion->>'ends_at')::timestamptz,
      (promotion->>'is_active')::boolean
    )
    returning id into saved_id;
  else
    update public.promotion_rules pr set
      name = promotion->>'name',
      slug = promotion->>'slug',
      description = coalesce(promotion->>'description', ''),
      badge_text = promotion->>'badge_text',
      promotion_type = (promotion->>'promotion_type')::public.promotion_type,
      fixed_price_cents = (promotion->>'fixed_price_cents')::bigint,
      percent_off = (promotion->>'percent_off')::numeric,
      buy_quantity = (promotion->>'buy_quantity')::smallint,
      get_quantity = (promotion->>'get_quantity')::smallint,
      applies_to_delivery = (promotion->>'applies_to_delivery')::boolean,
      applies_to_pickup = (promotion->>'applies_to_pickup')::boolean,
      starts_at = (promotion->>'starts_at')::timestamptz,
      ends_at = (promotion->>'ends_at')::timestamptz,
      is_active = (promotion->>'is_active')::boolean
    where pr.store_id = target_store_id and pr.id = target_promotion_id
    returning pr.id into saved_id;
    -- Not this store's, or RLS hides it from this session.
    if saved_id is null then
      raise exception using errcode = 'P0002', message = 'admin_save_promotion: promotion not in this store';
    end if;
  end if;

  delete from public.promotion_items pi
  where pi.store_id = target_store_id and pi.promotion_id = saved_id;
  insert into public.promotion_items (promotion_id, product_id, store_id, quantity)
  select saved_id, item.product_id, target_store_id, item.quantity
  from pg_catalog.jsonb_to_recordset(items) as item(product_id uuid, quantity smallint);

  delete from public.promotion_schedule ps where ps.promotion_id = saved_id;
  insert into public.promotion_schedule (promotion_id, day_of_week, starts_at, ends_at)
  select saved_id, window_row.day_of_week, window_row.starts_at, window_row.ends_at
  from pg_catalog.jsonb_to_recordset(schedule) as window_row(day_of_week smallint, starts_at time, ends_at time);

  return saved_id;
end;
$$;

comment on function public.admin_save_promotion(uuid, uuid, jsonb, jsonb, jsonb) is
  'BB-13: creates (null id) or updates a promotion with its products and weekly windows in one transaction. Runs as the caller: RLS decides.';

-- "up" swaps with the next higher priority (applies earlier), "down" with the next lower one.
-- Returns false when the promotion is already at that end. The three updates go through a free
-- value above every priority because (store_id, priority) is unique and not deferrable; nobody
-- else sees the intermediate values. Both rows are locked (FOR UPDATE) and the caller administers
-- the store, so each update changes exactly its row.
create function public.admin_move_promotion(
  target_store_id uuid,
  target_promotion_id uuid,
  direction text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_priority smallint;
  neighbour_id uuid;
  neighbour_priority smallint;
  free_priority integer;
begin
  if target_store_id is null or target_promotion_id is null or direction is null or direction not in ('up', 'down') then
    raise exception using errcode = '22023', message = 'admin_move_promotion: malformed arguments';
  end if;

  -- Active promotions are publicly readable, so "can see it" is not "administers it": the caller
  -- must administer the store before anything is read or written (RLS still checks every row).
  if not catalog_rls.is_store_admin(target_store_id) then
    raise exception using errcode = '42501', message = 'not an admin of this store';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('promotion_rules:' || target_store_id::text, 0));

  select pr.priority into current_priority
  from public.promotion_rules pr
  where pr.store_id = target_store_id and pr.id = target_promotion_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'admin_move_promotion: promotion not in this store';
  end if;

  if direction = 'up' then
    select pr.id, pr.priority into neighbour_id, neighbour_priority
    from public.promotion_rules pr
    where pr.store_id = target_store_id and pr.priority > current_priority
    order by pr.priority asc
    limit 1
    for update;
  else
    select pr.id, pr.priority into neighbour_id, neighbour_priority
    from public.promotion_rules pr
    where pr.store_id = target_store_id and pr.priority < current_priority
    order by pr.priority desc
    limit 1
    for update;
  end if;
  if neighbour_id is null then
    return false;
  end if;

  select max(pr.priority) + 1 into free_priority
  from public.promotion_rules pr
  where pr.store_id = target_store_id;
  if free_priority > 32767 then
    raise exception using errcode = 'BB013', message = 'admin_move_promotion: no free priority left';
  end if;

  update public.promotion_rules pr set priority = free_priority
  where pr.store_id = target_store_id and pr.id = target_promotion_id;

  update public.promotion_rules pr set priority = current_priority
  where pr.store_id = target_store_id and pr.id = neighbour_id;

  update public.promotion_rules pr set priority = neighbour_priority
  where pr.store_id = target_store_id and pr.id = target_promotion_id;

  return true;
end;
$$;

comment on function public.admin_move_promotion(uuid, uuid, text) is
  'BB-13: swaps the priority of a promotion with its neighbour in one transaction. Runs as the caller: RLS decides.';

-- Only signed-in sessions call them; anonymous visitors and the service role do not.
revoke all on function public.admin_save_promotion(uuid, uuid, jsonb, jsonb, jsonb) from public, anon, service_role;
revoke all on function public.admin_move_promotion(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.admin_save_promotion(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;
grant execute on function public.admin_move_promotion(uuid, uuid, text) to authenticated;
