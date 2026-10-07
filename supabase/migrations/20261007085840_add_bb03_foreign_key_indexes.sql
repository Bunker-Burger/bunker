create index option_groups_store_id_idx
  on public.option_groups(store_id);

create index payment_attempts_quote_store_idx
  on public.payment_attempts(quote_id, store_id);

create index product_option_groups_group_store_idx
  on public.product_option_groups(option_group_id, store_id);

create index product_option_groups_product_store_idx
  on public.product_option_groups(product_id, store_id);

create index products_category_store_idx
  on public.products(category_id, store_id);

create index promotion_items_product_store_idx
  on public.promotion_items(product_id, store_id);

create index promotion_items_promotion_store_idx
  on public.promotion_items(promotion_id, store_id);
