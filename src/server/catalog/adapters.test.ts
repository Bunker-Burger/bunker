import { describe, expect, it } from "vitest";
import { parseRows, toCategories, toProducts, toPromotionRules, toStoreSettings } from "./adapters";
import { categoryRowSchema, productRowSchema, promotionRowSchema, storeRowSchema } from "./rows";

const IMAGE_BASE = "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/catalog/";

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "p-1",
    category_id: "c-burgers",
    name: "Smash Búnker Doble",
    slug: "smash-bunker-doble",
    description: "Doble medallón",
    base_price_cents: "960000",
    is_published: true,
    is_available: true,
    is_featured: false,
    contains_alcohol: false,
    product_images: [],
    product_option_groups: [],
    ...overrides
  };
}

function categoryRow(id: string, kind: string, sortOrder: number, name: string) {
  return { id, name, slug: id, kind, sort_order: sortOrder, is_visible: true };
}

function parsedProducts(rows: unknown[]) {
  const parsed = parseRows("products", productRowSchema, rows);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

function parsedCategories(rows: unknown[]) {
  const parsed = parseRows("categories", categoryRowSchema, rows);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

const categories = toCategories(
  parsedCategories([
    categoryRow("c-drinks", "drink", 40, "Bebidas"),
    categoryRow("c-burgers", "burger", 10, "Hamburguesas"),
    categoryRow("c-sides", "side", 30, "Papas"),
    categoryRow("c-sandwiches", "sandwich", 20, "Sándwiches")
  ])
);

describe("money as bigint", () => {
  it("keeps cents exact beyond Number.MAX_SAFE_INTEGER when the column arrives as text", () => {
    const [row] = parsedProducts([productRow({ base_price_cents: "9007199254740993" })]);
    expect(row?.base_price_cents).toBe(9007199254740993n);
  });

  it("accepts safe integer cents but rejects unsafe numbers, decimals and negatives", () => {
    expect(parsedProducts([productRow({ base_price_cents: 140000 })])[0]?.base_price_cents).toBe(140000n);
    for (const bad of [9007199254740993, 10.5, -1, "12.50", "-5"]) {
      const result = parseRows("products", productRowSchema, [productRow({ base_price_cents: bad })]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("invalid_data");
        expect(result.error.message).toContain("products[0].base_price_cents");
      }
    }
  });

  it("maps option deltas, delivery fee and fixed promotion prices to bigint", () => {
    const store = parseRows("stores", storeRowSchema, [storeRow()]);
    expect(store.ok && store.value[0] && toStoreSettings(store.value[0]).deliveryFeeCents).toBe(120000n);
  });
});

function storeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "s-1",
    name: "Búnker Burger",
    slug: "bunker-burger",
    whatsapp_e164: "+5493865207458",
    timezone: "America/Argentina/Tucuman",
    currency: "ARS",
    status_override: "auto",
    is_public: true,
    delivery_fee_cents: "120000",
    store_business_hours: [],
    store_payment_methods: [],
    ...overrides
  };
}

describe("store operating settings", () => {
  it("maps the override, a missing fee as null, and the weekly hours in day/opening order", () => {
    const parsed = parseRows("stores", storeRowSchema, [
      storeRow({
        status_override: "paused",
        delivery_fee_cents: null,
        store_business_hours: [
          { day_of_week: 5, opens_at: "19:30:00", closes_at: "01:30:00" },
          { day_of_week: 0, opens_at: "20:00:00", closes_at: "00:00:00" },
          { day_of_week: 0, opens_at: "12:00:00", closes_at: "15:00:00" }
        ]
      })
    ]);
    if (!parsed.ok || !parsed.value[0]) throw new Error("expected a parsed store row");
    expect(toStoreSettings(parsed.value[0])).toMatchObject({
      statusOverride: "paused",
      deliveryFeeCents: null,
      timezone: "America/Argentina/Tucuman",
      businessHours: [
        { dayOfWeek: 0, opensAt: "12:00:00", closesAt: "15:00:00" },
        { dayOfWeek: 0, opensAt: "20:00:00", closesAt: "00:00:00" },
        { dayOfWeek: 5, opensAt: "19:30:00", closesAt: "01:30:00" }
      ]
    });
  });

  it.each([
    ["an unknown time zone", { timezone: "America/Atlantis" }, "stores[0].timezone"],
    ["an unknown override", { status_override: "maybe" }, "stores[0].status_override"],
    ["a malformed shift", { store_business_hours: [{ day_of_week: 9, opens_at: "19:30", closes_at: "23:00" }] }, "store_business_hours"]
  ])("rejects %s as invalid_data", (_case, overrides, path) => {
    const parsed = parseRows("stores", storeRowSchema, [storeRow(overrides)]);
    expect(parsed).toMatchObject({ ok: false, error: { code: "invalid_data" } });
    if (!parsed.ok) expect(parsed.error.message).toContain(path);
  });
});

describe("nulls", () => {
  it("falls back to the group cardinality when product overrides are null", () => {
    const [row] = parsedProducts([
      productRow({
        product_option_groups: [
          {
            default_option_ids: ["o-simple"],
            minimum_selections_override: null,
            maximum_selections_override: 2,
            sort_order: 10,
            option_groups: {
              id: "g-1",
              name: "Medallones",
              selection_mode: "single",
              minimum_selections: 1,
              maximum_selections: 3,
              is_required: true,
              sort_order: 10,
              options: [{ id: "o-simple", name: "Simple", price_delta_cents: "0", is_available: true, sort_order: 10 }]
            }
          }
        ]
      })
    ]);
    const result = toProducts([row!], { categories, imageBaseUrl: IMAGE_BASE });
    expect(result.ok && result.value[0]?.optionGroups[0]).toMatchObject({ minSelections: 1, maxSelections: 2, required: true });
  });

  it("returns a null image URL without photos and a public URL from the primary image", () => {
    const rows = parsedProducts([
      productRow({ id: "no-photo", slug: "sin-foto" }),
      productRow({
        id: "with-photo",
        slug: "con-foto",
        product_images: [
          { storage_path: "0199b2c8-40b0-7000-8000-000000000001/secundaria.webp", alt_text: "Otra", sort_order: 0, is_primary: false },
          { storage_path: "0199b2c8-40b0-7000-8000-000000000001/principal.webp", alt_text: "Hamburguesa", sort_order: 5, is_primary: true }
        ]
      })
    ]);
    const result = toProducts(rows, { categories, imageBaseUrl: IMAGE_BASE });
    if (!result.ok) throw new Error(result.error.message);
    const bySlug = Object.fromEntries(result.value.map((product) => [product.slug, product]));
    expect(bySlug["sin-foto"]?.imageUrl).toBeNull();
    expect(bySlug["sin-foto"]).not.toHaveProperty("imageAlt");
    expect(bySlug["con-foto"]).toMatchObject({
      imageUrl: "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/catalog/0199b2c8-40b0-7000-8000-000000000001/principal.webp",
      imageAlt: "Hamburguesa"
    });
  });

  it("rejects a product whose linked option group is hidden (null embed)", () => {
    const [row] = parsedProducts([
      productRow({
        product_option_groups: [
          { default_option_ids: [], minimum_selections_override: null, maximum_selections_override: null, sort_order: 0, option_groups: null }
        ]
      })
    ]);
    const result = toProducts([row!], { categories, imageBaseUrl: IMAGE_BASE });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatchObject({ code: "invalid_data" });
  });

  it("keeps a null badge and rejects promotions missing their mechanic parameters", () => {
    const base = {
      id: "promo-1",
      slug: "martes",
      name: "Martes",
      description: "",
      badge_text: null,
      priority: 1,
      is_active: true,
      starts_at: "2026-10-01T03:00:00+00:00",
      ends_at: "2026-12-31T03:00:00+00:00",
      fixed_price_cents: null,
      percent_off: null,
      buy_quantity: null,
      get_quantity: null,
      applies_to_delivery: true,
      applies_to_pickup: false,
      promotion_items: [],
      promotion_schedule: []
    };
    const valid = parseRows("promotion_rules", promotionRowSchema, [{ ...base, promotion_type: "percent_off", percent_off: "15.00" }]);
    const rules = valid.ok ? toPromotionRules(valid.value) : valid;
    expect(rules.ok && rules.value[0]).toMatchObject({ badgeText: null, mechanic: { type: "percent_off", percentOff: 15 }, channels: ["delivery"] });

    const broken = parseRows("promotion_rules", promotionRowSchema, [{ ...base, promotion_type: "fixed_price" }]);
    const result = broken.ok ? toPromotionRules(broken.value) : broken;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_data");
  });
});

describe("selection mode", () => {
  const group = (id: string, selectionMode: "single" | "multiple", minimum: number, maximum: number) => ({
    default_option_ids: [],
    minimum_selections_override: null,
    maximum_selections_override: null,
    sort_order: id === "salsa" ? 10 : 20,
    option_groups: {
      id,
      name: id,
      selection_mode: selectionMode,
      minimum_selections: minimum,
      maximum_selections: maximum,
      is_required: minimum > 0,
      sort_order: 0,
      options: []
    }
  });

  it("transports the persisted mode instead of inferring it from cardinality", () => {
    const [row] = parsedProducts([
      productRow({
        product_option_groups: [
          // A checkbox group that happens to allow one pick is still "multiple".
          group("salsa", "multiple", 0, 1),
          group("medallones", "single", 1, 1)
        ]
      })
    ]);
    const result = toProducts([row!], { categories, imageBaseUrl: IMAGE_BASE });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value[0]?.optionGroups.map((g) => [g.id, g.selectionMode, g.maxSelections])).toEqual([
      ["salsa", "multiple", 1],
      ["medallones", "single", 1]
    ]);
  });

  it("rejects rows without a valid selection_mode", () => {
    for (const mode of [undefined, "radio"]) {
      const result = parseRows("products", productRowSchema, [
        productRow({ product_option_groups: [{ ...group("x", "single", 1, 1), option_groups: { ...group("x", "single", 1, 1).option_groups, selection_mode: mode } }] })
      ]);
      expect(result).toMatchObject({ ok: false, error: { code: "invalid_data" } });
    }
  });
});

describe("ordering", () => {
  it("orders categories by sort order and maps kinds to product types", () => {
    expect(categories.map((category) => [category.id, category.type])).toEqual([
      ["c-burgers", "burger"],
      ["c-sandwiches", "sandwich"],
      ["c-sides", "fries"],
      ["c-drinks", "beverage"]
    ]);
  });

  it("orders products by category, featured first, then name; unknown categories go last as 'other'", () => {
    const rows = parsedProducts([
      productRow({ id: "1", slug: "limonada", name: "Limonada", category_id: "c-drinks" }),
      productRow({ id: "2", slug: "oklahoma", name: "Oklahoma Onion", category_id: "c-burgers" }),
      productRow({ id: "3", slug: "smash", name: "Smash Doble", category_id: "c-burgers", is_featured: true }),
      productRow({ id: "4", slug: "aros", name: "Aros de cebolla", category_id: "c-sides" }),
      productRow({ id: "5", slug: "huerfano", name: "Huérfano", category_id: "c-hidden" }),
      productRow({ id: "6", slug: "crispy", name: "Crispy Chicken", category_id: "c-sandwiches" })
    ]);
    const result = toProducts(rows, { categories, imageBaseUrl: IMAGE_BASE });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.map((product) => product.slug)).toEqual(["smash", "oklahoma", "crispy", "aros", "limonada", "huerfano"]);
    expect(result.value.at(-1)?.type).toBe("other");
  });

  it("orders option groups by link order then group order, and options by sort order then name", () => {
    const group = (id: string, linkOrder: number, groupOrder: number, options: unknown[]) => ({
      default_option_ids: [],
      minimum_selections_override: null,
      maximum_selections_override: null,
      sort_order: linkOrder,
      option_groups: { id, name: id, selection_mode: "multiple", minimum_selections: 0, maximum_selections: 3, is_required: false, sort_order: groupOrder, options }
    });
    const option = (id: string, sortOrder: number) => ({ id, name: id, price_delta_cents: "0", is_available: true, sort_order: sortOrder });
    const [row] = parsedProducts([
      productRow({
        product_option_groups: [
          group("extras", 20, 1, [option("huevo", 30), option("bacon", 10), option("cheddar", 10)]),
          group("salsas", 10, 99, []),
          group("medallones", 10, 5, [])
        ]
      })
    ]);
    const result = toProducts([row!], { categories, imageBaseUrl: IMAGE_BASE });
    if (!result.ok) throw new Error(result.error.message);
    const groups = result.value[0]?.optionGroups ?? [];
    expect(groups.map((g) => g.id)).toEqual(["medallones", "salsas", "extras"]);
    expect(groups[2]?.options.map((o) => o.id)).toEqual(["bacon", "cheddar", "huevo"]);
  });

  it("orders promotions by priority", () => {
    const promotion = (id: string, priority: number) => ({
      id,
      slug: id,
      name: id,
      description: "",
      badge_text: null,
      promotion_type: "free_delivery",
      priority,
      is_active: true,
      starts_at: "2026-10-01T00:00:00Z",
      ends_at: "2026-12-01T00:00:00Z",
      fixed_price_cents: null,
      percent_off: null,
      buy_quantity: null,
      get_quantity: null,
      applies_to_delivery: true,
      applies_to_pickup: true,
      promotion_items: [],
      promotion_schedule: []
    });
    const rows = parseRows("promotion_rules", promotionRowSchema, [promotion("b", 20), promotion("a", 5)]);
    const result = rows.ok ? toPromotionRules(rows.value) : rows;
    expect(result.ok && result.value.map((rule) => rule.id)).toEqual(["a", "b"]);
  });
});

describe("sold out", () => {
  it("keeps sold-out products and unavailable options in the result, flagged instead of dropped", () => {
    const [row] = parsedProducts([
      productRow({
        slug: "papas",
        category_id: "c-sides",
        is_available: false,
        product_option_groups: [
          {
            default_option_ids: [],
            minimum_selections_override: null,
            maximum_selections_override: null,
            sort_order: 0,
            option_groups: {
              id: "g-extras",
              name: "Extras",
              selection_mode: "multiple",
              minimum_selections: 0,
              maximum_selections: 2,
              is_required: false,
              sort_order: 0,
              options: [{ id: "o-cheddar", name: "Cheddar", price_delta_cents: "80000", is_available: false, sort_order: 0 }]
            }
          }
        ]
      })
    ]);
    const result = toProducts([row!], { categories, imageBaseUrl: IMAGE_BASE });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value[0]).toMatchObject({ slug: "papas", inStock: false, published: true, type: "fries" });
    expect(result.value[0]?.optionGroups[0]?.options[0]).toMatchObject({ available: false, priceDeltaCents: 80000n });
  });
});
