do $$
declare
  configured record;
  authenticated_qual text;
begin
  for configured in
    select *
    from (values
      ('stores', $policy$is_public$policy$),
      ('categories', $policy$
        is_visible and exists (
          select 1 from public.stores s
          where s.id = categories.store_id and s.is_public
        )
      $policy$),
      ('products', $policy$
        is_published
        and exists (
          select 1 from public.stores s
          where s.id = products.store_id and s.is_public
        )
        and exists (
          select 1 from public.categories c
          where c.id = products.category_id
            and c.store_id = products.store_id
            and c.is_visible
        )
      $policy$),
      ('product_images', $policy$
        exists (
          select 1 from public.products p
          where p.id = product_images.product_id
        )
      $policy$),
      ('option_groups', $policy$
        exists (
          select 1
          from public.product_option_groups pog
          join public.products p on p.id = pog.product_id
          where pog.option_group_id = option_groups.id
        )
      $policy$),
      ('options', $policy$
        is_available and exists (
          select 1 from public.option_groups og
          where og.id = options.option_group_id
        )
      $policy$),
      ('product_option_groups', $policy$
        exists (
          select 1 from public.products p
          where p.id = product_option_groups.product_id
        )
      $policy$),
      ('promotion_rules', $policy$
        is_active and now() between starts_at and ends_at
        and exists (
          select 1 from public.stores s
          where s.id = promotion_rules.store_id and s.is_public
        )
      $policy$),
      ('promotion_items', $policy$
        exists (
          select 1 from public.promotion_rules pr
          where pr.id = promotion_items.promotion_id
        )
      $policy$),
      ('promotion_schedule', $policy$
        exists (
          select 1 from public.promotion_rules pr
          where pr.id = promotion_schedule.promotion_id
        )
      $policy$),
      ('store_payment_methods', $policy$
        is_enabled and exists (
          select 1 from public.stores s
          where s.id = store_payment_methods.store_id and s.is_public
        )
      $policy$)
    ) as policies(table_name, anonymous_qual)
  loop
    select p.qual
    into authenticated_qual
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = configured.table_name
      and p.policyname = configured.table_name || '_read';

    if authenticated_qual is null then
      raise exception 'Expected consolidated read policy is missing for public.%',
        configured.table_name;
    end if;

    execute format(
      'drop policy %I on public.%I',
      configured.table_name || '_read',
      configured.table_name
    );
    execute format(
      'create policy %I on public.%I for select to anon using (%s)',
      configured.table_name || '_anon_read',
      configured.table_name,
      configured.anonymous_qual
    );
    execute format(
      'create policy %I on public.%I for select to authenticated using (%s)',
      configured.table_name || '_authenticated_read',
      configured.table_name,
      authenticated_qual
    );
  end loop;
end;
$$;
