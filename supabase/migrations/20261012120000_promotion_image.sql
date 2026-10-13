-- Issue #54: a promotion can carry a photo, shown in the banner at the top of the menu.
-- The object lives in the existing public `catalog` bucket under `<store_id>/promotions/…`, so the
-- storage policies already in place (admin of that store writes, everyone reads) apply as they are.
-- The app reads the column only when it exists: deploying the code before this migration is safe.

alter table public.promotion_rules
  add column image_path text
  check (image_path is null or (length(image_path) between 1 and 300 and image_path ~ '^[0-9a-f-]{36}/promotions/[^/]+$'));

comment on column public.promotion_rules.image_path is
  'Path of the promotion photo in the catalog bucket (<store_id>/promotions/<file>), or null.';
