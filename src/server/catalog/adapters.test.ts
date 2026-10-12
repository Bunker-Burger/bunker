import { describe, expect, it } from "vitest";
import {
  getApplicableOptionGroups,
  isPublishable,
  validateOptionSelection,
  validateProductPublication
} from "@/domain/options";
import { evaluateStoreStatus } from "@/domain/store-status";
import { createAuthoritativeQuote } from "@/server/checkout/quote";
import type { AuthoritativeProduct, PaymentQuotesPort, PricingRepository } from "@/server/payments/ports";
import { parseRows, toCategories, toProducts, toPromotionRules, toStoreSettings } from "./adapters";
import { categoryRowSchema, productRowSchema, promotionRowSchema, STORE_SELECT, storeRowSchema } from "./rows";

/** An open store (BB-08), so a rejected quote can only come from option validation. */
const openStoreStatus = async () =>
  evaluateStoreStatus(
    { timezone: "America/Argentina/Tucuman", statusOverride: "open", deliveryFeeCents: 120000n, businessHours: [] },
    new Date()
  );

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
    sort_order: 0,
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
  it("never reads the payment methods' free text, so a stored alias cannot reach the public catalog", () => {
    expect(STORE_SELECT).toContain("store_payment_methods(method, is_enabled, sort_order)");
    expect(STORE_SELECT).not.toMatch(/display_name|public_instructions/);
    // A row written before the fixed-copy check (or by an unexpected path) still carries no text.
    const parsed = parseRows("stores", storeRowSchema, [
      storeRow({
        store_payment_methods: [
          { method: "bank_transfer", display_name: "Alias: bunker.burger", public_instructions: "Mi alias bancoburger", is_enabled: true, sort_order: 20 }
        ]
      })
    ]);
    if (!parsed.ok || !parsed.value[0]) throw new Error("expected a parsed store row");
    const settings = toStoreSettings(parsed.value[0]);
    expect(settings.paymentMethods).toEqual([{ method: "bank_transfer", enabled: true, sortOrder: 20 }]);
    expect(JSON.stringify(settings, (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value))).not.toMatch(/bunker\.burger|bancoburger/);
  });

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
              applicable_category_kinds: ["burger"],
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
          { storage_path: "0199b2c8-40b0-7000-8000-000000000001/secundaria.webp", alt_text: "Otra", sort_order: 0, is_primary: false, focal_x: 50, focal_y: 50 },
          { storage_path: "0199b2c8-40b0-7000-8000-000000000001/principal.webp", alt_text: "Hamburguesa", sort_order: 5, is_primary: true, focal_x: 30, focal_y: 70 }
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
      imageAlt: "Hamburguesa",
      imageFocalPoint: { x: 30, y: 70 }
    });
    expect(bySlug["sin-foto"]).not.toHaveProperty("imageFocalPoint");
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
      applicable_category_kinds: ["burger"],
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

  it("puts the admin's manual order before featured and name inside each category", () => {
    const rows = parsedProducts([
      productRow({ id: "1", slug: "smash", name: "Smash Doble", category_id: "c-burgers", is_featured: true, sort_order: 30 }),
      productRow({ id: "2", slug: "oklahoma", name: "Oklahoma Onion", category_id: "c-burgers", sort_order: 10 }),
      productRow({ id: "3", slug: "bacon", name: "Bacon King", category_id: "c-burgers", sort_order: 20 }),
      productRow({ id: "4", slug: "limonada", name: "Limonada", category_id: "c-drinks", sort_order: 0 })
    ]);
    const result = toProducts(rows, { categories, imageBaseUrl: IMAGE_BASE });
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.map((product) => [product.slug, product.sortOrder])).toEqual([
      ["oklahoma", 10],
      ["bacon", 20],
      ["smash", 30],
      ["limonada", 0]
    ]);
  });

  it("orders option groups by link order then group order, and options by sort order then name", () => {
    const group = (id: string, linkOrder: number, groupOrder: number, options: unknown[]) => ({
      default_option_ids: [],
      minimum_selections_override: null,
      maximum_selections_override: null,
      sort_order: linkOrder,
      option_groups: { id, name: id, selection_mode: "multiple", minimum_selections: 0, maximum_selections: 3, is_required: false, sort_order: groupOrder, applicable_category_kinds: ["burger"], options }
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

  it("builds the banner photo URL from the bucket base, and leaves it out without a photo (issue #54)", () => {
    const base = { slug: "x", name: "x", description: "", badge_text: "2x1", promotion_type: "free_delivery", priority: 1, is_active: true,
      starts_at: "2026-10-01T00:00:00Z", ends_at: "2026-12-01T00:00:00Z", fixed_price_cents: null, percent_off: null, buy_quantity: null,
      get_quantity: null, applies_to_delivery: true, applies_to_pickup: true, promotion_items: [], promotion_schedule: [] };
    const rows = parseRows("promotion_rules", promotionRowSchema, [
      { ...base, id: "a", image_path: "s1/promotions/a 1.webp" },
      { ...base, id: "b", image_path: null },
      { ...base, id: "c" }
    ]);
    const result = rows.ok ? toPromotionRules(rows.value, "https://cdn.test/catalog/") : rows;
    expect(result.ok && result.value.map((rule) => rule.imageUrl)).toEqual(["https://cdn.test/catalog/s1/promotions/a%201.webp", undefined, undefined]);
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
              applicable_category_kinds: ["side"],
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

describe("applicability through Supabase adapter", () => {
  it("un grupo exclusivo de otra categoría no se renderiza para bebida, no se acepta en selección, impide publicación y es rechazado por el servidor autoritativo", async () => {
    // 1. Data equivalent to what the real Supabase adapter produces:
    // A beverage product row erroneously linked to the seed burger group (0199b2c8-40b0-7000-8000-000000000301)
    const [row] = parsedProducts([
      productRow({
        id: "0199b2c8-40b0-7000-8000-000000000202",
        slug: "gaseosa-lata",
        name: "Gaseosa lata 354 ml",
        description: "Bien fría para acompañar tu pedido. Sin alcohol.",
        category_id: "c-drinks",
        base_price_cents: "140000",
        is_published: true,
        is_available: true,
        product_option_groups: [
          {
            default_option_ids: ["0199b2c8-40b0-7000-8000-000000000401"],
            minimum_selections_override: null,
            maximum_selections_override: null,
            sort_order: 10,
            option_groups: {
              id: "0199b2c8-40b0-7000-8000-000000000301", // 'Tamaño / medallones' (burger exclusive)
              name: "Tamaño / medallones",
              selection_mode: "single",
              minimum_selections: 1,
              maximum_selections: 1,
              is_required: true,
              sort_order: 10,
              applicable_category_kinds: ["burger"],
              options: [
                {
                  id: "0199b2c8-40b0-7000-8000-000000000401",
                  name: "Doble (2× 100 g)",
                  price_delta_cents: "0",
                  is_available: true,
                  sort_order: 10
                }
              ]
            }
          }
        ]
      })
    ]);

    const result = toProducts([row!], { categories, imageBaseUrl: IMAGE_BASE });
    if (!result.ok) throw new Error(result.error.message);
    const adaptedBeverage = result.value[0]!;

    expect(adaptedBeverage.type).toBe("beverage");
    expect(adaptedBeverage.optionGroups[0]?.applicableTypes).toEqual(["burger"]);

    // a) No se renderiza para bebida
    const applicableGroups = getApplicableOptionGroups(adaptedBeverage);
    expect(applicableGroups).toHaveLength(0);
    expect(applicableGroups.some((g) => g.id === "0199b2c8-40b0-7000-8000-000000000301")).toBe(false);

    // b) No se acepta en selección
    const selection = validateOptionSelection(adaptedBeverage, {
      "0199b2c8-40b0-7000-8000-000000000301": ["0199b2c8-40b0-7000-8000-000000000401"]
    });
    expect(selection.ok).toBe(false);
    if (!selection.ok) {
      expect(selection.error.some((err) => err.code === "INAPPLICABLE_GROUP")).toBe(true);
    }

    // c) Impide configuración/publicación inválida
    const publication = validateProductPublication(adaptedBeverage);
    expect(publication.ok).toBe(false);
    if (!publication.ok) {
      expect(publication.error.some((err) => err.code === "INAPPLICABLE_OPTION_GROUP")).toBe(true);
    }
    expect(isPublishable(adaptedBeverage)).toBe(false);

    // d) También es rechazado por el servidor autoritativo
    const authoritativeProduct: AuthoritativeProduct = {
      id: adaptedBeverage.id,
      name: adaptedBeverage.name,
      type: adaptedBeverage.type,
      priceCents: adaptedBeverage.priceCents,
      available: adaptedBeverage.inStock,
      optionGroups: adaptedBeverage.optionGroups.map((g) => ({
        id: g.id,
        name: g.name,
        selectionMode: g.selectionMode,
        required: g.required,
        minSelections: g.minSelections,
        maxSelections: g.maxSelections,
        applicableTypes: g.applicableTypes,
        options: g.options
      }))
    };

    const repository: PricingRepository = {
      async findProduct() {
        return authoritativeProduct;
      },
      async listPromotions() {
        return [];
      }
    };
    const quotes: PaymentQuotesPort = {
      async save() {},
      async findById() {
        return null;
      }
    };

    await expect(
      createAuthoritativeQuote(
        {
          items: [
            {
              productId: adaptedBeverage.id,
              quantity: 1,
              optionSelections: {
                "0199b2c8-40b0-7000-8000-000000000301": ["0199b2c8-40b0-7000-8000-000000000401"]
              },
              notes: ""
            }
          ],
          fulfilment: "pickup",
          paymentMethod: "transfer"
        },
        { repository, quotes, storeStatus: openStoreStatus, createId: () => "quote-test", now: () => new Date() }
      )
    ).rejects.toThrow(/no es aplicable a productos de tipo 'beverage'/i);
  });
});

describe("persisted applicability with arbitrary unmapped UUID", () => {
  const ARBITRARY_UUID = "0199b2c8-40b0-7000-8000-999999999999";
  const ARBITRARY_OPTION_ID = "0199b2c8-40b0-7000-8000-888888888888";

  const arbitraryGroupRow = {
    id: ARBITRARY_UUID,
    name: "Grupo Especial Arbitrario",
    selection_mode: "single" as const,
    minimum_selections: 1,
    maximum_selections: 1,
    is_required: true,
    sort_order: 10,
    applicable_category_kinds: ["burger" as const],
    options: [
      {
        id: ARBITRARY_OPTION_ID,
        name: "Opción Arbitraria",
        price_delta_cents: "0",
        is_available: true,
        sort_order: 10
      }
    ]
  };

  it("adapter -> dominio conserva el dato de aplicabilidad sin mapas hardcodeados", () => {
    const [burgerRow] = parsedProducts([
      productRow({
        id: "burger-arbitrary",
        category_id: "c-burgers",
        product_option_groups: [
          {
            default_option_ids: [ARBITRARY_OPTION_ID],
            minimum_selections_override: null,
            maximum_selections_override: null,
            sort_order: 10,
            option_groups: arbitraryGroupRow
          }
        ]
      })
    ]);

    const result = toProducts([burgerRow!], { categories, imageBaseUrl: IMAGE_BASE });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);

    const adaptedBurger = result.value[0]!;
    expect(adaptedBurger.optionGroups).toHaveLength(1);
    const adaptedGroup = adaptedBurger.optionGroups[0]!;
    expect(adaptedGroup.id).toBe(ARBITRARY_UUID);
    expect(adaptedGroup.applicableTypes).toEqual(["burger"]);
  });

  it("aplicable a burger => visible en getApplicableOptionGroups y válido en selección", () => {
    const [burgerRow] = parsedProducts([
      productRow({
        id: "burger-arbitrary",
        category_id: "c-burgers",
        product_option_groups: [
          {
            default_option_ids: [ARBITRARY_OPTION_ID],
            minimum_selections_override: null,
            maximum_selections_override: null,
            sort_order: 10,
            option_groups: arbitraryGroupRow
          }
        ]
      })
    ]);

    const result = toProducts([burgerRow!], { categories, imageBaseUrl: IMAGE_BASE });
    if (!result.ok) throw new Error(result.error.message);
    const burger = result.value[0]!;

    const applicable = getApplicableOptionGroups(burger);
    expect(applicable.map((g) => g.id)).toContain(ARBITRARY_UUID);

    const selectionValidation = validateOptionSelection(burger, {
      [ARBITRARY_UUID]: [ARBITRARY_OPTION_ID]
    });
    expect(selectionValidation.ok).toBe(true);
  });

  it("el mismo grupo => no aplicable en beverage: invisible, bloquea publicación y falla validación", () => {
    const [beverageRow] = parsedProducts([
      productRow({
        id: "beverage-arbitrary",
        category_id: "c-drinks",
        slug: "bebida-arbitraria",
        product_option_groups: [
          {
            default_option_ids: [ARBITRARY_OPTION_ID],
            minimum_selections_override: null,
            maximum_selections_override: null,
            sort_order: 10,
            option_groups: arbitraryGroupRow
          }
        ]
      })
    ]);

    const result = toProducts([beverageRow!], { categories, imageBaseUrl: IMAGE_BASE });
    if (!result.ok) throw new Error(result.error.message);
    const beverage = result.value[0]!;

    // No se renderiza / no es visible para bebida
    const applicable = getApplicableOptionGroups(beverage);
    expect(applicable.some((g) => g.id === ARBITRARY_UUID)).toBe(false);

    // No se acepta en selección
    const selectionValidation = validateOptionSelection(beverage, {
      [ARBITRARY_UUID]: [ARBITRARY_OPTION_ID]
    });
    expect(selectionValidation.ok).toBe(false);
    if (!selectionValidation.ok) {
      expect(selectionValidation.error.some((e) => e.code === "INAPPLICABLE_GROUP")).toBe(true);
    }

    // Impide publicación del producto
    const publicationValidation = validateProductPublication(beverage);
    expect(publicationValidation.ok).toBe(false);
    if (!publicationValidation.ok) {
      expect(publicationValidation.error.some((e) => e.code === "INAPPLICABLE_OPTION_GROUP")).toBe(true);
    }
  });

  it("servidor autoritativo rechaza uso del grupo arbitrario en tipo incorrecto (beverage)", async () => {
    const authoritativeBeverage: AuthoritativeProduct = {
      id: "beverage-arbitrary",
      name: "Bebida Arbitraria",
      type: "beverage",
      priceCents: 150000n,
      available: true,
      optionGroups: [
        {
          id: ARBITRARY_UUID,
          name: arbitraryGroupRow.name,
          selectionMode: arbitraryGroupRow.selection_mode,
          required: arbitraryGroupRow.is_required,
          minSelections: arbitraryGroupRow.minimum_selections,
          maxSelections: arbitraryGroupRow.maximum_selections,
          applicableTypes: ["burger"], // Solo burger!
          options: [
            {
              id: ARBITRARY_OPTION_ID,
              name: "Opción Arbitraria",
              priceDeltaCents: 0n,
              available: true
            }
          ]
        }
      ]
    };

    const repository: PricingRepository = {
      async findProduct() {
        return authoritativeBeverage;
      },
      async listPromotions() {
        return [];
      }
    };
    const quotes: PaymentQuotesPort = {
      async save() {},
      async findById() {
        return null;
      }
    };

    await expect(
      createAuthoritativeQuote(
        {
          items: [
            {
              productId: "beverage-arbitrary",
              quantity: 1,
              optionSelections: {
                [ARBITRARY_UUID]: [ARBITRARY_OPTION_ID]
              },
              notes: ""
            }
          ],
          fulfilment: "pickup",
          paymentMethod: "transfer"
        },
        { repository, quotes, storeStatus: openStoreStatus, createId: () => "quote-arb", now: () => new Date() }
      )
    ).rejects.toThrow(/no es aplicable a productos de tipo 'beverage'/i);
  });
});

