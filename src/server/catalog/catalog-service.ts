import type { Catalog, PromotionRule } from "@/domain/types";
import { ok, type Result } from "@/lib/result";
import type { CatalogError } from "./errors";
import type { CatalogRepository } from "./ports";

function isRunning(promotion: PromotionRule, now: Date) {
  return promotion.active && promotion.startsAt <= now && now < promotion.endsAt;
}

/**
 * Assembles the catalog of one store from a repository. Public reads only keep what a
 * customer may see right now (visible categories, running promotions); admin reads keep
 * everything the repository returns.
 */
export async function loadCatalog(
  repository: CatalogRepository,
  storeSlug: string,
  now: Date = new Date()
): Promise<Result<Catalog, CatalogError>> {
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

  if (repository.scope === "admin") {
    return ok({ store: store.value, categories: categories.value, products: products.value, promotions: promotions.value });
  }

  const visibleCategoryIds = new Set(categories.value.filter((category) => category.visible).map((category) => category.id));
  return ok({
    store: store.value,
    categories: categories.value.filter((category) => category.visible),
    products: products.value.filter((product) => product.published && visibleCategoryIds.has(product.categoryId)),
    promotions: promotions.value.filter((promotion) => isRunning(promotion, now))
  });
}
