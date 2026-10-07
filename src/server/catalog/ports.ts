import type { Category, Product, PromotionRule, StoreSettings } from "@/domain/types";
import type { Result } from "@/lib/result";
import type { CatalogError } from "./errors";

/**
 * - `public`: anonymous reads, filtered to what customers may see (RLS enforces it too).
 * - `admin`: reads as the signed-in user; RLS decides which stores they administer.
 */
export type CatalogScope = "public" | "admin";

/** Catalog persistence boundary. Implementations translate every failure into a `CatalogError`. */
export interface CatalogRepository {
  readonly scope: CatalogScope;
  getStoreBySlug(slug: string): Promise<Result<StoreSettings, CatalogError>>;
  listCategories(storeId: string): Promise<Result<Category[], CatalogError>>;
  /** `categories` resolves each product's type and ordering. */
  listProducts(storeId: string, categories: Category[]): Promise<Result<Product[], CatalogError>>;
  listPromotions(storeId: string): Promise<Result<PromotionRule[], CatalogError>>;
}
