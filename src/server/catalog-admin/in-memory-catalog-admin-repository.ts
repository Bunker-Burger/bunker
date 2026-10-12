import type { ProductType } from "@/domain/types";
import { err, ok } from "@/lib/result";
import { catalogError } from "@/server/catalog/errors";
import type {
  AdminCategoryKind,
  AdminOptionGroup,
  AdminResult,
  CatalogAdminRepository,
  CategoryFields,
  OptionFields,
  OptionGroupLink,
  ProductFields,
  StoredImage
} from "./ports";

/* Test double: one store's catalog in memory, with the database rules the use cases rely on. */

const TYPE_BY_KIND: Record<string, ProductType> = { burger: "burger", sandwich: "sandwich", side: "fries", drink: "beverage", other: "other" };

export interface MemoryCategory extends CategoryFields {
  id: string;
  storeId: string;
  kind: AdminCategoryKind | "other";
  sortOrder: number;
}

export interface MemoryProduct extends ProductFields {
  id: string;
  storeId: string;
  published: boolean;
  sortOrder: number;
  containsAlcohol: boolean;
  optionGroups: OptionGroupLink[];
}

export interface MemoryImage extends StoredImage {
  productId: string;
}

export class InMemoryCatalogAdminRepository implements CatalogAdminRepository {
  categories: MemoryCategory[] = [];
  products: MemoryProduct[] = [];
  optionGroups: Array<AdminOptionGroup & { storeId: string }> = [];
  images: MemoryImage[] = [];
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  promotionProductIds = new Set<string>();
  promotions: Array<{ id: string; storeId: string; name: string; imagePath: string | null }> = [];
  /** False simulates a database without the promotion-photo migration. */
  promotionImagesSupported = true;
  /** Every mutating call, in order, for sequencing assertions. */
  writes: string[] = [];
  /** Method names that fail with `unavailable` (or the given error). */
  failing = new Map<string, { code: "unavailable" | "conflict" | "rejected"; message: string }>();
  private nextId = 1;

  private id(prefix: string) {
    return `${prefix}0000-0000-4000-8000-${String(this.nextId++).padStart(12, "0")}`;
  }

  private fail(method: string) {
    const failure = this.failing.get(method);
    if (!failure) return null;
    return failure.code === "unavailable" ? catalogError("unavailable", failure.message) : err(failure);
  }

  private record(entry: string) {
    this.writes.push(entry);
  }

  async listCategories(storeId: string) {
    return (
      this.fail("listCategories") ??
      ok(
        this.categories
          .filter((category) => category.storeId === storeId)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((category) => ({ id: category.id, slug: category.slug, name: category.name, kind: category.kind, type: TYPE_BY_KIND[category.kind]!, sortOrder: category.sortOrder, visible: category.visible }))
      )
    );
  }

  async createOption(groupId: string, fields: OptionFields & { sortOrder: number }): Promise<AdminResult<{ id: string }>> {
    const failed = this.fail("createOption");
    if (failed) return failed;
    const group = this.optionGroups.find((candidate) => candidate.id === groupId);
    if (!group) return catalogError("not_found", "no row");
    if (group.options.some((option) => option.name === fields.name)) return err({ code: "conflict" as const, message: "duplicate name" });
    const id = this.id("o");
    group.options = [...group.options, { id, name: fields.name, priceDeltaCents: fields.priceDeltaCents, available: fields.available }];
    this.record(`createOption:${id}`);
    return ok({ id });
  }

  async updateOption(groupId: string, optionId: string, fields: OptionFields): Promise<AdminResult<void>> {
    const failed = this.fail("updateOption");
    if (failed) return failed;
    const group = this.optionGroups.find((candidate) => candidate.id === groupId);
    const option = group?.options.find((candidate) => candidate.id === optionId);
    if (!group || !option) return catalogError("not_found", "no row");
    group.options = group.options.map((candidate) =>
      candidate.id === optionId ? { ...candidate, name: fields.name, priceDeltaCents: fields.priceDeltaCents, available: fields.available } : candidate
    );
    this.record(`updateOption:${optionId}`);
    return ok(undefined);
  }

  async setOptionOrder(groupId: string, rows: Array<{ id: string; sortOrder: number }>): Promise<AdminResult<void>> {
    const failed = this.fail("setOptionOrder");
    if (failed) return failed;
    const group = this.optionGroups.find((candidate) => candidate.id === groupId);
    if (!group) return catalogError("not_found", "no row");
    const position = new Map(rows.map((row) => [row.id, row.sortOrder]));
    group.options = [...group.options].sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
    this.record(`setOptionOrder:${groupId}`);
    return ok(undefined);
  }

  async listOptionGroups(storeId: string) {
    return this.fail("listOptionGroups") ?? ok(this.optionGroups.filter((group) => group.storeId === storeId));
  }

  private stored(product: MemoryProduct) {
    return {
      id: product.id,
      categoryId: product.categoryId,
      published: product.published,
      sortOrder: product.sortOrder,
      featured: product.featured,
      name: product.name,
      optionGroups: product.optionGroups.map((link) => ({ ...link, defaultOptionIds: [...link.defaultOptionIds] }))
    };
  }

  async listProducts(storeId: string, categoryId: string) {
    return this.fail("listProducts") ?? ok(this.products.filter((p) => p.storeId === storeId && p.categoryId === categoryId).map((p) => this.stored(p)));
  }

  async getProduct(storeId: string, productId: string) {
    const product = this.products.find((p) => p.storeId === storeId && p.id === productId);
    return this.fail("getProduct") ?? ok(product ? this.stored(product) : null);
  }

  private slugTaken(rows: Array<{ storeId: string; slug: string; id: string }>, storeId: string, slug: string, exceptId?: string) {
    return rows.some((row) => row.storeId === storeId && row.slug === slug && row.id !== exceptId);
  }

  async createCategory(storeId: string, fields: CategoryFields & { kind: AdminCategoryKind; sortOrder: number }) {
    const failed = this.fail("createCategory");
    if (failed) return failed;
    if (this.slugTaken(this.categories, storeId, fields.slug)) return err({ code: "conflict" as const, message: "duplicate slug" });
    const id = this.id("c");
    this.categories.push({ id, storeId, ...fields });
    this.record(`createCategory:${id}`);
    return ok({ id });
  }

  async updateCategory(storeId: string, categoryId: string, fields: CategoryFields): Promise<AdminResult<void>> {
    const failed = this.fail("updateCategory");
    if (failed) return failed;
    const category = this.categories.find((c) => c.storeId === storeId && c.id === categoryId);
    if (!category) return catalogError("not_found", "no row");
    if (this.slugTaken(this.categories, storeId, fields.slug, categoryId)) return err({ code: "conflict" as const, message: "duplicate slug" });
    Object.assign(category, fields);
    this.record(`updateCategory:${categoryId}`);
    return ok(undefined);
  }

  async deleteCategory(storeId: string, categoryId: string): Promise<AdminResult<void>> {
    const failed = this.fail("deleteCategory");
    if (failed) return failed;
    if (this.products.some((p) => p.categoryId === categoryId)) return err({ code: "conflict" as const, message: "fk" });
    const before = this.categories.length;
    this.categories = this.categories.filter((c) => !(c.storeId === storeId && c.id === categoryId));
    if (before === this.categories.length) return catalogError("not_found", "no row");
    this.record(`deleteCategory:${categoryId}`);
    return ok(undefined);
  }

  async setCategoryOrder(storeId: string, rows: Array<{ id: string; sortOrder: number }>): Promise<AdminResult<void>> {
    const failed = this.fail("setCategoryOrder");
    if (failed) return failed;
    for (const row of rows) {
      const category = this.categories.find((c) => c.storeId === storeId && c.id === row.id);
      if (!category) return catalogError("not_found", "no row");
      category.sortOrder = row.sortOrder;
    }
    this.record(`setCategoryOrder:${rows.map((row) => `${row.id}=${row.sortOrder}`).join(",")}`);
    return ok(undefined);
  }

  async createProduct(storeId: string, fields: ProductFields & { sortOrder: number }) {
    const failed = this.fail("createProduct");
    if (failed) return failed;
    if (this.slugTaken(this.products, storeId, fields.slug)) return err({ code: "conflict" as const, message: "duplicate slug" });
    const id = this.id("p");
    this.products.push({ id, storeId, ...fields, published: false, containsAlcohol: false, optionGroups: [] });
    this.record(`createProduct:${id}`);
    return ok({ id });
  }

  async updateProduct(storeId: string, productId: string, fields: ProductFields & { published?: boolean; sortOrder?: number }): Promise<AdminResult<void>> {
    const failed = this.fail("updateProduct");
    if (failed) return failed;
    const product = this.products.find((p) => p.storeId === storeId && p.id === productId);
    if (!product) return catalogError("not_found", "no row");
    if (this.slugTaken(this.products, storeId, fields.slug, productId)) return err({ code: "conflict" as const, message: "duplicate slug" });
    Object.assign(product, fields, { containsAlcohol: false });
    this.record(`updateProduct:${productId}:published=${String(fields.published)}`);
    return ok(undefined);
  }

  async setProductPublished(storeId: string, productId: string, published: boolean): Promise<AdminResult<void>> {
    const failed = this.fail("setProductPublished");
    if (failed) return failed;
    const product = this.products.find((p) => p.storeId === storeId && p.id === productId);
    if (!product) return catalogError("not_found", "no row");
    product.published = published;
    this.record(`setProductPublished:${productId}:${published}`);
    return ok(undefined);
  }

  async replaceOptionGroups(storeId: string, productId: string, links: OptionGroupLink[]): Promise<AdminResult<void>> {
    const failed = this.fail("replaceOptionGroups");
    if (failed) return failed;
    const product = this.products.find((p) => p.storeId === storeId && p.id === productId);
    if (!product) return catalogError("not_found", "no row");
    product.optionGroups = links.map((link) => ({ ...link, defaultOptionIds: [...link.defaultOptionIds] }));
    this.record(`replaceOptionGroups:${productId}:published=${product.published}`);
    return ok(undefined);
  }

  async setProductOrder(storeId: string, rows: Array<{ id: string; sortOrder: number }>): Promise<AdminResult<void>> {
    const failed = this.fail("setProductOrder");
    if (failed) return failed;
    for (const row of rows) {
      const product = this.products.find((p) => p.storeId === storeId && p.id === row.id);
      if (!product) return catalogError("not_found", "no row");
      product.sortOrder = row.sortOrder;
    }
    this.record(`setProductOrder:${rows.map((row) => `${row.id}=${row.sortOrder}`).join(",")}`);
    return ok(undefined);
  }

  async isProductInPromotion(_storeId: string, productId: string) {
    return this.fail("isProductInPromotion") ?? ok(this.promotionProductIds.has(productId));
  }

  async deleteProduct(storeId: string, productId: string): Promise<AdminResult<void>> {
    const failed = this.fail("deleteProduct");
    if (failed) return failed;
    const before = this.products.length;
    this.products = this.products.filter((p) => !(p.storeId === storeId && p.id === productId));
    if (before === this.products.length) return catalogError("not_found", "no row");
    this.images = this.images.filter((image) => image.productId !== productId);
    this.record(`deleteProduct:${productId}`);
    return ok(undefined);
  }

  async getPrimaryImage(storeId: string, productId: string) {
    const product = this.products.find((p) => p.storeId === storeId && p.id === productId);
    const image = product ? this.images.find((candidate) => candidate.productId === productId) : undefined;
    return this.fail("getPrimaryImage") ?? ok(image ? { id: image.id, storagePath: image.storagePath, altText: image.altText, focalX: image.focalX, focalY: image.focalY } : null);
  }

  async putObject(path: string, bytes: Uint8Array, contentType: string): Promise<AdminResult<void>> {
    const failed = this.fail("putObject");
    if (failed) return failed;
    if (this.objects.has(path)) return err({ code: "conflict" as const, message: "exists" });
    this.objects.set(path, { bytes, contentType });
    this.record(`putObject:${path}`);
    return ok(undefined);
  }

  async removeObjects(paths: string[]): Promise<AdminResult<void>> {
    const failed = this.fail("removeObjects");
    if (failed) return failed;
    for (const path of paths) this.objects.delete(path);
    this.record(`removeObjects:${paths.join(",")}`);
    return ok(undefined);
  }

  async savePrimaryImage(productId: string, existingImageId: string | null, image: { storagePath: string; altText: string; focalX: number; focalY: number }): Promise<AdminResult<void>> {
    const failed = this.fail("savePrimaryImage");
    if (failed) return failed;
    if (existingImageId) {
      const current = this.images.find((candidate) => candidate.id === existingImageId);
      if (!current) return catalogError("not_found", "no row");
      Object.assign(current, image);
    } else {
      this.images.push({ id: this.id("i"), productId, ...image });
    }
    this.record(`savePrimaryImage:${image.storagePath}`);
    return ok(undefined);
  }

  async updateImageDetails(imageId: string, details: { altText: string; focalX: number; focalY: number }): Promise<AdminResult<void>> {
    const failed = this.fail("updateImageDetails");
    if (failed) return failed;
    const current = this.images.find((candidate) => candidate.id === imageId);
    if (!current) return catalogError("not_found", "no row");
    Object.assign(current, details);
    this.record(`updateImageDetails:${imageId}`);
    return ok(undefined);
  }

  async deleteImage(imageId: string): Promise<AdminResult<void>> {
    const failed = this.fail("deleteImage");
    if (failed) return failed;
    this.images = this.images.filter((candidate) => candidate.id !== imageId);
    this.record(`deleteImage:${imageId}`);
    return ok(undefined);
  }

  async getPromotionImage(storeId: string, promotionId: string) {
    const promotion = this.promotions.find((candidate) => candidate.storeId === storeId && candidate.id === promotionId);
    const supported = this.promotionImagesSupported;
    return this.fail("getPromotionImage") ?? ok(promotion ? { name: promotion.name, imagePath: supported ? promotion.imagePath : null, supported } : null);
  }

  async setPromotionImage(storeId: string, promotionId: string, imagePath: string | null): Promise<AdminResult<void>> {
    const failed = this.fail("setPromotionImage");
    if (failed) return failed;
    const promotion = this.promotions.find((candidate) => candidate.storeId === storeId && candidate.id === promotionId);
    if (!promotion) return catalogError("not_found", "no row");
    promotion.imagePath = imagePath;
    this.record(`setPromotionImage:${imagePath}`);
    return ok(undefined);
  }
}
