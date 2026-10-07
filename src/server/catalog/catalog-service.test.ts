import { describe, expect, it, vi } from "vitest";
import type { Category, Product, PromotionRule, StoreSettings } from "@/domain/types";
import { loadCatalog } from "./catalog-service";
import { reportCatalogError, type CatalogError } from "./errors";
import { createInMemoryCatalogRepository, type InMemoryCatalogData } from "./in-memory-catalog-repository";

const NOW = new Date("2026-10-07T18:00:00Z");

const store: StoreSettings = {
  id: "store-1",
  slug: "bunker-burger",
  name: "Búnker Burger",
  whatsappE164: "+5493865207458",
  timezone: "America/Argentina/Buenos_Aires",
  currency: "ARS",
  isOpen: true,
  isPublic: true,
  deliveryFeeCents: 120000n,
  businessHours: {},
  paymentMethods: []
};

const category = (id: string, visible = true): Category => ({ id, slug: id, name: id, type: "burger", sortOrder: 0, visible });

const product = (slug: string, categoryId: string, overrides: Partial<Product> = {}): Product => ({
  id: slug,
  slug,
  categoryId,
  type: "burger",
  name: slug,
  description: "",
  priceCents: 100000n,
  imageUrl: null,
  published: true,
  featured: false,
  inStock: true,
  optionGroups: [],
  ...overrides
});

const promotion = (id: string, startsAt: string, endsAt: string, active = true): PromotionRule => ({
  id,
  slug: id,
  name: id,
  description: "",
  badgeText: null,
  priority: 1,
  active,
  startsAt: new Date(startsAt),
  endsAt: new Date(endsAt),
  mechanic: { type: "free_delivery" },
  channels: ["delivery"],
  items: [],
  schedule: []
});

const data: InMemoryCatalogData = {
  store,
  categories: [category("burgers"), category("secret", false)],
  products: [
    product("smash", "burgers"),
    product("agotada", "burgers", { inStock: false }),
    product("borrador", "burgers", { published: false }),
    product("escondida", "secret")
  ],
  promotions: [
    promotion("vigente", "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z"),
    promotion("vencida", "2026-09-01T00:00:00Z", "2026-10-07T18:00:00Z"),
    promotion("futura", "2026-10-08T00:00:00Z", "2026-11-01T00:00:00Z"),
    promotion("pausada", "2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", false)
  ]
};

describe("loadCatalog", () => {
  it("public reads keep visible categories, published products (sold out included) and running promotions", async () => {
    const result = await loadCatalog(createInMemoryCatalogRepository(data), "bunker-burger", NOW);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.categories.map((c) => c.id)).toEqual(["burgers"]);
    expect(result.value.products.map((p) => [p.slug, p.inStock])).toEqual([
      ["smash", true],
      ["agotada", false]
    ]);
    expect(result.value.promotions.map((p) => p.id)).toEqual(["vigente"]);
    expect(result.value.store.deliveryFeeCents).toBe(120000n);
  });

  it("admin reads keep drafts, hidden categories and inactive promotions", async () => {
    const result = await loadCatalog(createInMemoryCatalogRepository(data, { scope: "admin" }), "bunker-burger", NOW);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.products).toHaveLength(4);
    expect(result.value.categories).toHaveLength(2);
    expect(result.value.promotions).toHaveLength(4);
  });

  it("returns not_found for an unknown or non-public store", async () => {
    const unknown = await loadCatalog(createInMemoryCatalogRepository(data), "otra-tienda", NOW);
    expect(unknown).toMatchObject({ ok: false, error: { code: "not_found" } });

    const hidden = await loadCatalog(createInMemoryCatalogRepository({ ...data, store: { ...store, isPublic: false } }), "bunker-burger", NOW);
    expect(hidden).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it.each(["listCategories", "listProducts", "listPromotions"] as const)(
    "propagates a %s failure instead of returning a partial catalog",
    async (operation) => {
      const failure: CatalogError = { code: "unavailable", message: `${operation} failed: timeout` };
      const result = await loadCatalog(createInMemoryCatalogRepository(data, { failures: { [operation]: failure } }), "bunker-burger", NOW);
      expect(result).toEqual({ ok: false, error: failure });
    }
  );
});

describe("reportCatalogError", () => {
  it("logs the code and message so failures are never silent", () => {
    const log = { error: vi.fn() };
    reportCatalogError("public", { code: "unavailable", message: "products.select failed: fetch failed" }, log);
    expect(log.error).toHaveBeenCalledWith("[catalog:public] unavailable: products.select failed: fetch failed");
  });
});
