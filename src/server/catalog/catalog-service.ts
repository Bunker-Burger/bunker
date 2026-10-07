import type { Catalog, PromotionRule } from "@/domain/types";
import { ok, type Result } from "@/lib/result";
import type { AdminAccessGate } from "./admin-access";
import { catalogError, type CatalogError } from "./errors";
import type { CatalogRepository, CatalogScope } from "./ports";

function isRunning(promotion: PromotionRule, now: Date) {
  return promotion.active && promotion.startsAt <= now && now < promotion.endsAt;
}

function requireScope(repository: CatalogRepository, scope: CatalogScope) {
  return repository.scope === scope
    ? null
    : catalogError("misconfigured", `catalog: expected a ${scope} repository, got ${repository.scope}`);
}

/** Reads every part of one store's catalog; any failure fails the whole read (never partial). */
async function readCatalog(repository: CatalogRepository, storeSlug: string): Promise<Result<Catalog, CatalogError>> {
  const store = await repository.getStoreBySlug(storeSlug);
  if (!store.ok) return store;

  const [categories, promotions] = await Promise.all([
    repository.listCategories(store.value.id),
    repository.listPromotions(store.value.id)
  ]);
  if (!categories.ok) return categories;
  if (!promotions.ok) return promotions;

  const products = await repository.listProducts(store.value.id, categories.value);
  if (!products.ok) return products;

  return ok({ store: store.value, categories: categories.value, products: products.value, promotions: promotions.value });
}

/**
 * Customer catalog: visible categories, published products (sold out included) and the
 * promotions running at `now`.
 */
export async function loadPublicCatalog(
  repository: CatalogRepository,
  storeSlug: string,
  now: Date = new Date()
): Promise<Result<Catalog, CatalogError>> {
  const wrongScope = requireScope(repository, "public");
  if (wrongScope) return wrongScope;

  const catalog = await readCatalog(repository, storeSlug);
  if (!catalog.ok) return catalog;

  const { store, categories, products, promotions } = catalog.value;
  const visibleCategoryIds = new Set(categories.filter((category) => category.visible).map((category) => category.id));
  return ok({
    store,
    categories: categories.filter((category) => category.visible),
    products: products.filter((product) => product.published && visibleCategoryIds.has(product.categoryId)),
    promotions: promotions.filter((promotion) => isRunning(promotion, now))
  });
}

/**
 * Full catalog (drafts, hidden categories, inactive promotions) for an active admin of the
 * store. Without a valid admin session the result is `unauthorized` and nothing is read, so
 * the public subset can never come back as an "admin" catalog.
 */
export async function loadAdminCatalog(
  repository: CatalogRepository,
  access: AdminAccessGate,
  storeSlug: string
): Promise<Result<Catalog, CatalogError>> {
  const wrongScope = requireScope(repository, "admin");
  if (wrongScope) return wrongScope;

  const membership = await access.requireStoreAdmin(storeSlug);
  if (!membership.ok) return membership;

  const catalog = await readCatalog(repository, storeSlug);
  if (!catalog.ok) return catalog;
  if (catalog.value.store.id !== membership.value.storeId) {
    return catalogError("unauthorized", `catalog: "${storeSlug}" is not the store this admin belongs to`);
  }
  return catalog;
}
