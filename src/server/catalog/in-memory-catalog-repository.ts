import type { Category, Product, PromotionRule, StoreSettings } from "@/domain/types";
import { ok, type Result } from "@/lib/result";
import { catalogError, type CatalogError } from "./errors";
import type { CatalogRepository, CatalogScope } from "./ports";

export interface InMemoryCatalogData {
  store: StoreSettings;
  categories: Category[];
  products: Product[];
  promotions: PromotionRule[];
}

type Operation = "getStoreBySlug" | "listCategories" | "listProducts" | "listPromotions";

/**
 * Repository backed by plain domain objects, injected in unit tests instead of a Supabase
 * connection. `failures` makes a given operation return the provided error.
 */
export function createInMemoryCatalogRepository(
  data: InMemoryCatalogData,
  { scope = "public", failures = {} }: { scope?: CatalogScope; failures?: Partial<Record<Operation, CatalogError>> } = {}
): CatalogRepository {
  const respond = async <T>(operation: Operation, value: () => T): Promise<Result<T, CatalogError>> => {
    const failure = failures[operation];
    return failure ? { ok: false, error: failure } : ok(value());
  };
  const sameStore = (storeId: string) => storeId === data.store.id;

  return {
    scope,
    async getStoreBySlug(slug) {
      const visible = slug === data.store.slug && (scope === "admin" || data.store.isPublic);
      if (!visible && !failures.getStoreBySlug) return catalogError("not_found", `stores: no store "${slug}"`);
      return respond("getStoreBySlug", () => data.store);
    },
    listCategories: (storeId) => respond("listCategories", () => (sameStore(storeId) ? data.categories : [])),
    listProducts: (storeId) => respond("listProducts", () => (sameStore(storeId) ? data.products : [])),
    listPromotions: (storeId) => respond("listPromotions", () => (sameStore(storeId) ? data.promotions : []))
  };
}
