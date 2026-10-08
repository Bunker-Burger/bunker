import { describe, expect, it, vi } from "vitest";
import type { Category, Product, PromotionRule, StoreSettings } from "@/domain/types";
import { loadAdminCatalog, loadPublicCatalog } from "./catalog-service";
import { reportCatalogError, type CatalogError } from "./errors";
import { createInMemoryAdminAccess, type InMemoryMembership } from "./in-memory-admin-access";
import { createInMemoryCatalogRepository, type InMemoryCatalogData } from "./in-memory-catalog-repository";
import type { CatalogRepository } from "./ports";

const NOW = new Date("2026-10-07T18:00:00Z");

const store: StoreSettings = {
  id: "store-1",
  slug: "bunker-burger",
  name: "Búnker Burger",
  whatsappE164: "+5493865207458",
  timezone: "America/Argentina/Tucuman",
  currency: "ARS",
  statusOverride: "auto",
  isPublic: true,
  deliveryFeeCents: 120000n,
  businessHours: [{ dayOfWeek: 3, opensAt: "19:30", closesAt: "00:00" }],
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

describe("loadPublicCatalog", () => {
  it("public reads keep visible categories, published products (sold out included) and running promotions", async () => {
    const result = await loadPublicCatalog(createInMemoryCatalogRepository(data), "bunker-burger", NOW);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.categories.map((c) => c.id)).toEqual(["burgers"]);
    expect(result.value.products.map((p) => [p.slug, p.inStock])).toEqual([
      ["smash", true],
      ["agotada", false]
    ]);
    expect(result.value.promotions.map((p) => p.id)).toEqual(["vigente"]);
    expect(result.value.store.deliveryFeeCents).toBe(120000n);
  });

  it("returns not_found for an unknown or non-public store", async () => {
    const unknown = await loadPublicCatalog(createInMemoryCatalogRepository(data), "otra-tienda", NOW);
    expect(unknown).toMatchObject({ ok: false, error: { code: "not_found" } });

    const hidden = await loadPublicCatalog(createInMemoryCatalogRepository({ ...data, store: { ...store, isPublic: false } }), "bunker-burger", NOW);
    expect(hidden).toMatchObject({ ok: false, error: { code: "not_found" } });
  });

  it.each(["listCategories", "listProducts", "listPromotions"] as const)(
    "propagates a %s failure instead of returning a partial catalog",
    async (operation) => {
      const failure: CatalogError = { code: "unavailable", message: `${operation} failed: timeout` };
      const result = await loadPublicCatalog(createInMemoryCatalogRepository(data, { failures: { [operation]: failure } }), "bunker-burger", NOW);
      expect(result).toEqual({ ok: false, error: failure });
    }
  );
});

/** Wraps a repository so tests can assert that nothing was read. */
function spiedRepository(repository: CatalogRepository) {
  const calls: string[] = [];
  const spied: CatalogRepository = {
    scope: repository.scope,
    getStoreBySlug: (slug) => (calls.push("getStoreBySlug"), repository.getStoreBySlug(slug)),
    listCategories: (id) => (calls.push("listCategories"), repository.listCategories(id)),
    listProducts: (id, categories) => (calls.push("listProducts"), repository.listProducts(id, categories)),
    listPromotions: (id) => (calls.push("listPromotions"), repository.listPromotions(id))
  };
  return { spied, calls };
}

const ADMIN = "user-admin";
const memberships: InMemoryMembership[] = [
  { userId: ADMIN, storeId: store.id, storeSlug: store.slug, role: "owner", active: true },
  { userId: "user-former", storeId: store.id, storeSlug: store.slug, role: "admin", active: false },
  { userId: "user-other-store", storeId: "store-2", storeSlug: "otra-tienda", role: "admin", active: true }
];

describe("loadAdminCatalog", () => {
  it("returns the full catalog (drafts, hidden categories, inactive promotions) to an active admin", async () => {
    const result = await loadAdminCatalog(
      createInMemoryCatalogRepository(data, { scope: "admin" }),
      createInMemoryAdminAccess({ userId: ADMIN }, memberships),
      "bunker-burger"
    );
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value.products.map((p) => p.slug)).toEqual(["smash", "agotada", "borrador", "escondida"]);
    expect(result.value.categories).toHaveLength(2);
    expect(result.value.promotions).toHaveLength(4);
  });

  it.each([
    ["anonymous (no session)", null],
    ["expired session", { userId: ADMIN, expired: true }],
    ["authenticated user without membership", { userId: "user-customer" }],
    ["user whose membership is inactive", { userId: "user-former" }],
    ["admin of another store", { userId: "user-other-store" }]
  ])("rejects %s as unauthorized without reading the catalog", async (_case, session) => {
    const { spied, calls } = spiedRepository(createInMemoryCatalogRepository(data, { scope: "admin" }));
    const result = await loadAdminCatalog(spied, createInMemoryAdminAccess(session, memberships), "bunker-burger");
    expect(result).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(calls).toEqual([]);
  });

  it("rejects a membership that does not match the store actually read", async () => {
    const mismatched = createInMemoryAdminAccess({ userId: ADMIN }, [
      { userId: ADMIN, storeId: "store-2", storeSlug: "bunker-burger", role: "admin", active: true }
    ]);
    const result = await loadAdminCatalog(createInMemoryCatalogRepository(data, { scope: "admin" }), mismatched, "bunker-burger");
    expect(result).toMatchObject({ ok: false, error: { code: "unauthorized" } });
  });

  it("propagates gate and repository failures instead of degrading to a public catalog", async () => {
    const outage = { code: "unavailable" as const, message: "auth.getUser failed: fetch failed" };
    const failingGate = { requireStoreAdmin: async () => ({ ok: false as const, error: outage }) };
    expect(await loadAdminCatalog(createInMemoryCatalogRepository(data, { scope: "admin" }), failingGate, "bunker-burger")).toEqual({
      ok: false,
      error: outage
    });

    const failure: CatalogError = { code: "unavailable", message: "products.select failed: timeout" };
    const result = await loadAdminCatalog(
      createInMemoryCatalogRepository(data, { scope: "admin", failures: { listProducts: failure } }),
      createInMemoryAdminAccess({ userId: ADMIN }, memberships),
      "bunker-burger"
    );
    expect(result).toEqual({ ok: false, error: failure });
  });

  it("refuses a repository built for the other scope", async () => {
    const admin = createInMemoryAdminAccess({ userId: ADMIN }, memberships);
    expect(await loadAdminCatalog(createInMemoryCatalogRepository(data), admin, "bunker-burger")).toMatchObject({
      ok: false,
      error: { code: "misconfigured" }
    });
    expect(await loadPublicCatalog(createInMemoryCatalogRepository(data, { scope: "admin" }), "bunker-burger", NOW)).toMatchObject({
      ok: false,
      error: { code: "misconfigured" }
    });
  });
});

describe("reportCatalogError", () => {
  it("logs the code and message so failures are never silent", () => {
    const log = { error: vi.fn() };
    reportCatalogError("public", { code: "unavailable", message: "products.select failed: fetch failed" }, log);
    expect(log.error).toHaveBeenCalledWith("[catalog:public] unavailable: products.select failed: fetch failed");
  });
});
