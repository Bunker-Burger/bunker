import type { Category, ConfigurableOptionGroup, ProductType } from "@/domain/types";
import type { Result } from "@/lib/result";
import type { CatalogError, CatalogErrorCode } from "@/server/catalog/errors";

/** The four product types the admin manages, as stored in `categories.kind`. */
export const ADMIN_CATEGORY_KINDS = ["burger", "sandwich", "side", "drink"] as const;
export type AdminCategoryKind = (typeof ADMIN_CATEGORY_KINDS)[number];

export const PRODUCT_TYPE_BY_KIND: Record<AdminCategoryKind, ProductType> = {
  burger: "burger",
  sandwich: "sandwich",
  side: "fries",
  drink: "beverage"
};

export type AdminErrorCode =
  | CatalogErrorCode
  /** A unique slug is taken, or the row is still referenced (products in a category, a product in a promotion). */
  | "conflict"
  /** The database rejected the values (check constraint, publication or drink rules). */
  | "rejected";

export interface AdminError {
  code: AdminErrorCode;
  message: string;
  cause?: unknown;
}

export type AdminResult<T> = Result<T, AdminError | CatalogError>;

export interface CategoryFields {
  name: string;
  slug: string;
  visible: boolean;
}

export interface ProductFields {
  categoryId: string;
  name: string;
  slug: string;
  description: string;
  priceCents: bigint;
  inStock: boolean;
  featured: boolean;
}

export type AdminOptionGroup = ConfigurableOptionGroup & { applicableTypes: readonly ProductType[] };

export interface OptionGroupLink {
  groupId: string;
  defaultOptionIds: string[];
}

export interface StoredProduct {
  id: string;
  categoryId: string;
  published: boolean;
  sortOrder: number;
  featured: boolean;
  name: string;
  optionGroups: OptionGroupLink[];
}

export interface StoredImage {
  id: string;
  storagePath: string;
  altText: string;
  focalX: number;
  focalY: number;
}

export interface ImageDetails {
  altText: string;
  focalX: number;
  focalY: number;
}

export interface OrderedRow {
  id: string;
  sortOrder: number;
}

/**
 * Catalog writes as the signed-in admin. Every method is scoped by `storeId`; the database's RLS
 * still decides, so a write that RLS filters out comes back as `not_found` (zero rows).
 */
export interface CatalogAdminRepository {
  listCategories(storeId: string): Promise<AdminResult<Array<Category & { kind: string }>>>;
  listOptionGroups(storeId: string): Promise<AdminResult<AdminOptionGroup[]>>;
  listProducts(storeId: string, categoryId: string): Promise<AdminResult<StoredProduct[]>>;
  getProduct(storeId: string, productId: string): Promise<AdminResult<StoredProduct | null>>;

  createCategory(storeId: string, fields: CategoryFields & { kind: AdminCategoryKind; sortOrder: number }): Promise<AdminResult<{ id: string }>>;
  updateCategory(storeId: string, categoryId: string, fields: CategoryFields): Promise<AdminResult<void>>;
  deleteCategory(storeId: string, categoryId: string): Promise<AdminResult<void>>;
  setCategoryOrder(storeId: string, rows: OrderedRow[]): Promise<AdminResult<void>>;

  createProduct(storeId: string, fields: ProductFields & { sortOrder: number }): Promise<AdminResult<{ id: string }>>;
  updateProduct(storeId: string, productId: string, fields: ProductFields & { published?: boolean; sortOrder?: number }): Promise<AdminResult<void>>;
  setProductPublished(storeId: string, productId: string, published: boolean): Promise<AdminResult<void>>;
  replaceOptionGroups(storeId: string, productId: string, links: OptionGroupLink[]): Promise<AdminResult<void>>;
  setProductOrder(storeId: string, rows: OrderedRow[]): Promise<AdminResult<void>>;
  isProductInPromotion(storeId: string, productId: string): Promise<AdminResult<boolean>>;
  deleteProduct(storeId: string, productId: string): Promise<AdminResult<void>>;

  getPrimaryImage(storeId: string, productId: string): Promise<AdminResult<StoredImage | null>>;
  /** Stores a new object; never overwrites an existing path. */
  putObject(path: string, bytes: Uint8Array, contentType: string): Promise<AdminResult<void>>;
  removeObjects(paths: string[]): Promise<AdminResult<void>>;
  /** Points the product's primary image at `storagePath` (inserting the row when there is none). */
  savePrimaryImage(productId: string, existingImageId: string | null, image: ImageDetails & { storagePath: string }): Promise<AdminResult<void>>;
  updateImageDetails(imageId: string, details: ImageDetails): Promise<AdminResult<void>>;
  deleteImage(imageId: string): Promise<AdminResult<void>>;
}
