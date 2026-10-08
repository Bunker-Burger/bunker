import { z } from "zod";
import { isValidTimeZone } from "@/domain/store-status";
import { Constants } from "@/server/supabase/database.types";

/*
 * Runtime shapes of the PostgREST selects below. Money columns are cast to text in the
 * select so `bigint` values never pass through a JS number; the schemas still accept safe
 * integers in case a column is read without the cast.
 */

const enums = Constants.public.Enums;

const cents = z
  .union([z.string().regex(/^\d+$/, "expected non-negative integer cents"), z.number().int().nonnegative().refine(Number.isSafeInteger, "unsafe integer cents")])
  .transform((value) => BigInt(value));

const smallInt = z.number().int();
const timestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "invalid timestamp");
const wallClock = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "invalid time of day");

export const STORE_SELECT =
  "id, name, slug, whatsapp_e164, timezone, currency, status_override, is_public, delivery_fee_cents:delivery_fee_cents::text, " +
  "store_business_hours(day_of_week, opens_at, closes_at), store_payment_methods(method, display_name, public_instructions, is_enabled, sort_order)";

export const storeRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  whatsapp_e164: z.string(),
  timezone: z.string().refine(isValidTimeZone, "unknown time zone"),
  currency: z.string(),
  status_override: z.enum(enums.store_status_override),
  is_public: z.boolean(),
  delivery_fee_cents: cents.nullable(),
  store_business_hours: z.array(
    z.object({ day_of_week: z.number().int().min(0).max(6), opens_at: wallClock, closes_at: wallClock })
  ),
  store_payment_methods: z.array(
    z.object({
      method: z.enum(enums.payment_method_kind),
      display_name: z.string(),
      public_instructions: z.string(),
      is_enabled: z.boolean(),
      sort_order: smallInt
    })
  )
});
export type StoreRow = z.output<typeof storeRowSchema>;

/** Only what the store status needs; a separate (uncached) read from the catalog's store row. */
export const STORE_OPERATING_SELECT =
  "id, slug, timezone, status_override, delivery_fee_cents:delivery_fee_cents::text, store_business_hours(day_of_week, opens_at, closes_at)";

export const storeOperatingRowSchema = storeRowSchema.pick({
  id: true,
  slug: true,
  timezone: true,
  status_override: true,
  delivery_fee_cents: true,
  store_business_hours: true
});
export type StoreOperatingRow = z.output<typeof storeOperatingRowSchema>;

export const CATEGORY_SELECT = "id, name, slug, kind, sort_order, is_visible";

export const categoryRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  kind: z.enum(enums.category_kind),
  sort_order: smallInt,
  is_visible: z.boolean()
});
export type CategoryRow = z.output<typeof categoryRowSchema>;

export const PRODUCT_SELECT = [
  "id, category_id, name, slug, description, base_price_cents:base_price_cents::text",
  "is_published, is_available, is_featured, contains_alcohol",
  "product_images(storage_path, alt_text, sort_order, is_primary)",
  "product_option_groups(default_option_ids, minimum_selections_override, maximum_selections_override, sort_order, " +
    "option_groups(id, name, selection_mode, minimum_selections, maximum_selections, is_required, sort_order, " +
    "options(id, name, price_delta_cents:price_delta_cents::text, is_available, sort_order)))"
].join(", ");

const optionRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  price_delta_cents: cents,
  is_available: z.boolean(),
  sort_order: smallInt
});

const optionGroupRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  selection_mode: z.enum(enums.option_selection_mode),
  minimum_selections: smallInt,
  maximum_selections: smallInt,
  is_required: z.boolean(),
  sort_order: smallInt,
  options: z.array(optionRowSchema)
});

export const productRowSchema = z.object({
  id: z.string(),
  category_id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  base_price_cents: cents,
  is_published: z.boolean(),
  is_available: z.boolean(),
  is_featured: z.boolean(),
  contains_alcohol: z.boolean(),
  product_images: z.array(
    z.object({ storage_path: z.string(), alt_text: z.string(), sort_order: smallInt, is_primary: z.boolean() })
  ),
  product_option_groups: z.array(
    z.object({
      default_option_ids: z.array(z.string()),
      minimum_selections_override: smallInt.nullable(),
      maximum_selections_override: smallInt.nullable(),
      sort_order: smallInt,
      // Null when RLS hides the group; the adapter rejects that as inconsistent data.
      option_groups: optionGroupRowSchema.nullable()
    })
  )
});
export type ProductRow = z.output<typeof productRowSchema>;

export const PROMOTION_SELECT = [
  "id, slug, name, description, badge_text, promotion_type, priority, is_active, starts_at, ends_at",
  "fixed_price_cents:fixed_price_cents::text, percent_off, buy_quantity, get_quantity",
  "applies_to_delivery, applies_to_pickup",
  "promotion_items(product_id, quantity), promotion_schedule(day_of_week, starts_at, ends_at)"
].join(", ");

export const promotionRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  badge_text: z.string().nullable(),
  promotion_type: z.enum(enums.promotion_type),
  priority: smallInt,
  is_active: z.boolean(),
  starts_at: timestamp,
  ends_at: timestamp,
  fixed_price_cents: cents.nullable(),
  percent_off: z.union([z.number(), z.string()]).nullable().transform((value) => (value === null ? null : Number(value))),
  buy_quantity: smallInt.nullable(),
  get_quantity: smallInt.nullable(),
  applies_to_delivery: z.boolean(),
  applies_to_pickup: z.boolean(),
  promotion_items: z.array(z.object({ product_id: z.string(), quantity: smallInt })),
  promotion_schedule: z.array(z.object({ day_of_week: smallInt, starts_at: wallClock, ends_at: wallClock }))
});
export type PromotionRow = z.output<typeof promotionRowSchema>;
