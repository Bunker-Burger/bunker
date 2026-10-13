-- Issue #54: the promotion photo is recentred like product photos, by dragging it in the admin.
-- Percentages (0–100) of the photo kept in view when the banner crops it; centred by default.

alter table public.promotion_rules
  add column image_focal_x smallint not null default 50 check (image_focal_x between 0 and 100),
  add column image_focal_y smallint not null default 50 check (image_focal_y between 0 and 100);
