import type { Category, ConfigurableOptionGroup, ProductType } from "@/domain/types";

/** The four product types the admin manages, as stored in `categories.kind`. */
export const PRODUCT_CATEGORY_KINDS = ["burger", "sandwich", "side", "drink"] as const;
/**
 * Kinds of section the admin can create: the product types plus "other", the menu's "Combos"
 * section (issue #54). It holds no products: the menu shows the store's combos in its place, so
 * the admin orders, hides or renames it like any other category.
 */
export const ADMIN_CATEGORY_KINDS = [...PRODUCT_CATEGORY_KINDS, "other"] as const;
export type AdminCategoryKind = (typeof ADMIN_CATEGORY_KINDS)[number];

export const PRODUCT_TYPE_BY_KIND: Record<AdminCategoryKind, ProductType> = {
  burger: "burger",
  sandwich: "sandwich",
  side: "fries",
  drink: "beverage",
  other: "other"
};

export type { AdminError, AdminErrorCode, AdminResult } from "@/server/admin/use-case";
import type { AdminResult } from "@/server/admin/use-case";

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

/** One choice of an option group, e.g. "Medallón extra" at +$ 1.400 (issue #54). */
export interface OptionFields {
  name: string;
  priceDeltaCents: bigint;
  available: boolean;
}

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

/** A promotion's photo for the menu banner (issue #54). */
export interface StoredPromotionImage {
  name: string;
  imagePath: string | null;
  /** False until the promotion-photo migration is applied: there is nowhere to store the path. */
  supported: boolean;
  /** Where the banner centres the photo; null until the framing migration is applied. */
  focal: { x: number; y: number } | null;
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

  /** Options belong to a group of the store; the service checks that before calling these. */
  createOption(groupId: string, fields: OptionFields & { sortOrder: number }): Promise<AdminResult<{ id: string }>>;
  updateOption(groupId: string, optionId: string, fields: OptionFields): Promise<AdminResult<void>>;
  setOptionOrder(groupId: string, rows: OrderedRow[]): Promise<AdminResult<void>>;
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

  /** The promotion of the store with its photo path, or null when it is not in the store. */
  getPromotionImage(storeId: string, promotionId: string): Promise<AdminResult<StoredPromotionImage | null>>;
  /** `focal` is written only when given (databases with the framing migration). */
  setPromotionImage(storeId: string, promotionId: string, imagePath: string | null, focal?: { x: number; y: number }): Promise<AdminResult<void>>;
  setPromotionFocal(storeId: string, promotionId: string, focal: { x: number; y: number }): Promise<AdminResult<void>>;
}
