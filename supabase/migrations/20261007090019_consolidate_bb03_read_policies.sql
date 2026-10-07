do $$
declare
  policy_pair record;
  public_qual text;
  admin_qual text;
  admin_check text;
begin
  for policy_pair in
    select *
    from (values
      ('stores', 'stores_public_read', 'stores_admin_read', false),
      ('categories', 'categories_public_read', 'categories_admin_all', true),
      ('products', 'products_public_read', 'products_admin_all', true),
      ('product_images', 'product_images_public_read', 'product_images_admin_all', true),
      ('option_groups', 'option_groups_public_read', 'option_groups_admin_all', true),
      ('options', 'options_public_read', 'options_admin_all', true),
      ('product_option_groups', 'product_option_groups_public_read', 'product_option_groups_admin_all', true),
      ('promotion_rules', 'promotion_rules_public_read', 'promotion_rules_admin_all', true),
      ('promotion_items', 'promotion_items_public_read', 'promotion_items_admin_all', true),
      ('promotion_schedule', 'promotion_schedule_public_read', 'promotion_schedule_admin_all', true),
      ('store_payment_methods', 'payment_methods_public_read', 'payment_methods_admin_all', true)
    ) as configured(table_name, public_policy, admin_policy, split_admin_writes)
  loop
    select p.qual
    into public_qual
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = policy_pair.table_name
      and p.policyname = policy_pair.public_policy;

    select p.qual, p.with_check
    into admin_qual, admin_check
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = policy_pair.table_name
      and p.policyname = policy_pair.admin_policy;

    if public_qual is null or admin_qual is null then
      raise exception 'Expected BB-03 policies are missing for public.%',
        policy_pair.table_name;
    end if;

    execute format(
      'drop policy %I on public.%I',
      policy_pair.public_policy,
      policy_pair.table_name
    );
    execute format(
      'drop policy %I on public.%I',
      policy_pair.admin_policy,
      policy_pair.table_name
    );
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using ((%s) or (%s))',
      policy_pair.table_name || '_read',
      policy_pair.table_name,
      public_qual,
      admin_qual
    );

    if policy_pair.split_admin_writes then
      if admin_check is null then
        raise exception 'Expected BB-03 admin check is missing for public.%',
          policy_pair.table_name;
      end if;

      execute format(
        'create policy %I on public.%I for insert to authenticated with check (%s)',
        policy_pair.table_name || '_admin_insert',
        policy_pair.table_name,
        admin_check
      );
      execute format(
        'create policy %I on public.%I for update to authenticated using (%s) with check (%s)',
        policy_pair.table_name || '_admin_update',
        policy_pair.table_name,
        admin_qual,
        admin_check
      );
      execute format(
        'create policy %I on public.%I for delete to authenticated using (%s)',
        policy_pair.table_name || '_admin_delete',
        policy_pair.table_name,
        admin_qual
      );
    end if;
  end loop;
end;
$$;
