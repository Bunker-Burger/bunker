import type { z } from "zod";
import type { StoreOperatingSettings } from "@/domain/store-status";
import type {
  Category,
  FulfilmentMethod,
  OptionGroup,
  Product,
  ProductType,
  PromotionMechanic,
  PromotionRule,
  StoreSettings
} from "@/domain/types";
import { ok, type Result } from "@/lib/result";
import { catalogError, type CatalogError } from "./errors";
import type { CategoryRow, ProductRow, PromotionRow, StoreOperatingRow, StoreRow } from "./rows";

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "es");

const productTypeByKind: Record<CategoryRow["kind"], ProductType> = {
  burger: "burger",
  sandwich: "sandwich",
  side: "fries",
  drink: "beverage",
  other: "other"
};

/** Validates raw rows; the first broken row turns the whole read into an `invalid_data` error. */
export function parseRows<S extends z.ZodType>(
  table: string,
  schema: S,
  rows: unknown
): Result<Array<z.output<S>>, CatalogError> {
  if (!Array.isArray(rows)) return catalogError("invalid_data", `${table}: expected a list of rows`);
  const parsed: Array<z.output<S>> = [];
  for (const [index, row] of rows.entries()) {
    const result = schema.safeParse(row);
    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue?.path.join(".") || "(row)";
      return catalogError("invalid_data", `${table}[${index}].${path}: ${issue?.message ?? "invalid"}`, result.error);
    }
    parsed.push(result.data);
  }
  return ok(parsed);
}

export function toStoreOperatingSettings(row: StoreOperatingRow): StoreOperatingSettings {
  return {
    timezone: row.timezone,
    statusOverride: row.status_override,
    deliveryFeeCents: row.delivery_fee_cents,
    businessHours: row.store_business_hours
      .map((window) => ({ dayOfWeek: window.day_of_week, opensAt: window.opens_at, closesAt: window.closes_at }))
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.opensAt.localeCompare(b.opensAt))
  };
}

export function toStoreSettings(row: StoreRow): StoreSettings {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    whatsappE164: row.whatsapp_e164,
    currency: row.currency,
    isPublic: row.is_public,
    ...toStoreOperatingSettings(row),
    paymentMethods: row.store_payment_methods
      .map((method) => ({
        method: method.method,
        displayName: method.display_name,
        instructions: method.public_instructions,
        enabled: method.is_enabled,
        sortOrder: method.sort_order
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.method.localeCompare(b.method))
  };
}

export function toCategories(rows: CategoryRow[]): Category[] {
  return rows
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      type: productTypeByKind[row.kind],
      sortOrder: row.sort_order,
      visible: row.is_visible
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || byName(a, b));
}

interface ProductContext {
  categories: Category[];
  /** Public URL prefix of the `catalog` bucket, e.g. `https://<ref>.supabase.co/storage/v1/object/public/catalog`. */
  imageBaseUrl: string;
}

function toOptionGroups(row: ProductRow): Result<OptionGroup[], CatalogError> {
  const groups: Array<{ group: OptionGroup; order: [number, number] }> = [];
  for (const link of row.product_option_groups) {
    const group = link.option_groups;
    if (!group) {
      return catalogError("invalid_data", `products.${row.slug}: linked option group is not readable`);
    }
    groups.push({
      group: {
        id: group.id,
        name: group.name,
        selectionMode: group.selection_mode,
        required: group.is_required,
        minSelections: link.minimum_selections_override ?? group.minimum_selections,
        maxSelections: link.maximum_selections_override ?? group.maximum_selections,
        defaultOptionIds: [...link.default_option_ids],
        options: [...group.options]
          .sort((a, b) => a.sort_order - b.sort_order || byName(a, b))
          .map((option) => ({
            id: option.id,
            name: option.name,
            priceDeltaCents: option.price_delta_cents,
            available: option.is_available
          }))
      },
      order: [link.sort_order, group.sort_order]
    });
  }
  groups.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1] || byName(a.group, b.group));
  return ok(groups.map(({ group }) => group));
}

function primaryImage(row: ProductRow) {
  const [image] = [...row.product_images].sort(
    (a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order
  );
  return image ?? null;
}

/**
 * Orders products by category order, featured first, then name. Products whose category is
 * not readable keep type "other" and sort last instead of being dropped silently.
 */
export function toProducts(rows: ProductRow[], context: ProductContext): Result<Product[], CatalogError> {
  const categoryIndex = new Map(context.categories.map((category, index) => [category.id, { category, index }]));
  const base = context.imageBaseUrl.replace(/\/+$/, "");
  const products: Array<{ product: Product; categoryOrder: number }> = [];

  for (const row of rows) {
    const optionGroups = toOptionGroups(row);
    if (!optionGroups.ok) return optionGroups;
    const category = categoryIndex.get(row.category_id);
    const image = primaryImage(row);
    products.push({
      categoryOrder: category?.index ?? Number.MAX_SAFE_INTEGER,
      product: {
        id: row.id,
        slug: row.slug,
        categoryId: row.category_id,
        type: category?.category.type ?? "other",
        name: row.name,
        description: row.description,
        priceCents: row.base_price_cents,
        imageUrl: image ? `${base}/${image.storage_path.split("/").map(encodeURIComponent).join("/")}` : null,
        ...(image ? { imageAlt: image.alt_text } : {}),
        published: row.is_published,
        featured: row.is_featured,
        inStock: row.is_available,
        containsAlcohol: row.contains_alcohol,
        optionGroups: optionGroups.value
      }
    });
  }

  products.sort(
    (a, b) =>
      a.categoryOrder - b.categoryOrder ||
      Number(b.product.featured) - Number(a.product.featured) ||
      byName(a.product, b.product)
  );
  return ok(products.map(({ product }) => product));
}

function toMechanic(row: PromotionRow): Result<PromotionMechanic, CatalogError> {
  const broken = () =>
    catalogError("invalid_data", `promotion_rules.${row.slug}: ${row.promotion_type} is missing its parameters`);
  switch (row.promotion_type) {
    case "fixed_price":
      return row.fixed_price_cents === null
        ? broken()
        : ok({ type: "fixed_price", fixedPriceCents: row.fixed_price_cents });
    case "percent_off":
      return row.percent_off === null || Number.isNaN(row.percent_off)
        ? broken()
        : ok({ type: "percent_off", percentOff: row.percent_off });
    case "buy_x_get_y":
      return row.buy_quantity === null || row.get_quantity === null
        ? broken()
        : ok({
            type: "buy_x_get_y",
            buyQuantity: row.buy_quantity,
            getQuantity: row.get_quantity
          });
    case "free_delivery":
      return ok({ type: "free_delivery" });
  }
}

/** Ordered by ascending `priority` (the store-wide unique rank configured by the admin). */
export function toPromotionRules(rows: PromotionRow[]): Result<PromotionRule[], CatalogError> {
  const rules: PromotionRule[] = [];
  for (const row of rows) {
    const mechanic = toMechanic(row);
    if (!mechanic.ok) return mechanic;
    const channels: FulfilmentMethod[] = [];
    if (row.applies_to_delivery) channels.push("delivery");
    if (row.applies_to_pickup) channels.push("pickup");
    rules.push({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      badgeText: row.badge_text,
      priority: row.priority,
      active: row.is_active,
      startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at),
      mechanic: mechanic.value,
      channels,
      items: row.promotion_items
        .map((item) => ({
          productId: item.product_id,
          quantity: item.quantity
        }))
        .sort((a, b) => a.productId.localeCompare(b.productId)),
      schedule: row.promotion_schedule
        .map((window) => ({
          dayOfWeek: window.day_of_week,
          startsAt: window.starts_at,
          endsAt: window.ends_at
        }))
        .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startsAt.localeCompare(b.startsAt))
    });
  }
  return ok(rules.sort((a, b) => a.priority - b.priority));
}
