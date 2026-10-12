import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { err, ok, type Result } from "@/lib/result";
import { parseRows, productTypeByKind } from "@/server/catalog/adapters";
import { catalogError } from "@/server/catalog/errors";
import { CATEGORY_SELECT, categoryRowSchema, optionGroupRowSchema } from "@/server/catalog/rows";
import { fromWriteError, write, writeOne } from "@/server/admin/supabase-writes";
import type { QueryResponse } from "@/server/catalog/supabase-catalog-repository";
import type { Database } from "@/server/supabase/database.types";
import type { AdminError, AdminOptionGroup, AdminResult, CatalogAdminRepository, OptionGroupLink, StoredImage, StoredProduct } from "./ports";

/*
 * Catalog writes through the signed-in admin's session client: no service role. RLS decides on
 * every statement, and each update/delete asks for the affected ids back, so a row RLS hides
 * (or from another store) is reported as `not_found` instead of a silent no-op.
 */

export const CATALOG_BUCKET = "catalog";

export { fromWriteError };

function storageError(operation: string, error: unknown): Result<never, AdminError> {
  const record = (typeof error === "object" && error !== null ? error : {}) as { status?: unknown; statusCode?: unknown; message?: unknown };
  const status = Number(record.status ?? record.statusCode);
  const message = typeof record.message === "string" ? record.message : String(error);
  if (status === 409 || /already exists/i.test(message)) return err({ code: "conflict", message: `${operation}: object exists`, cause: error });
  if (status === 401 || status === 403 || /row-level security|unauthorized/i.test(message)) {
    return catalogError("unauthorized", `${operation}: permission denied`, error);
  }
  if (status === 400 || status === 413 || status === 415) return err({ code: "rejected", message: `${operation}: ${message}`, cause: error });
  return catalogError("unavailable", `${operation} failed: ${message}`, error);
}

function toSafeNumber(cents: bigint) {
  // PostgREST receives JSON numbers; prices are capped far below 2^53 by the form.
  return Number.isSafeInteger(Number(cents)) ? Number(cents) : null;
}

const STORED_PRODUCT_SELECT = "id, category_id, name, is_published, is_featured, sort_order, product_option_groups(option_group_id, default_option_ids, sort_order)";

const storedProductRowSchema = z.object({
  id: z.string(),
  category_id: z.string(),
  name: z.string(),
  is_published: z.boolean(),
  is_featured: z.boolean(),
  sort_order: z.number().int(),
  product_option_groups: z.array(z.object({ option_group_id: z.string(), default_option_ids: z.array(z.string()), sort_order: z.number().int() }))
});

function toStoredProduct(row: z.output<typeof storedProductRowSchema>): StoredProduct {
  return {
    id: row.id,
    categoryId: row.category_id,
    name: row.name,
    published: row.is_published,
    featured: row.is_featured,
    sortOrder: row.sort_order,
    optionGroups: [...row.product_option_groups]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((link) => ({ groupId: link.option_group_id, defaultOptionIds: [...link.default_option_ids] }))
  };
}

export const OPTION_GROUP_SELECT =
  "id, name, selection_mode, minimum_selections, maximum_selections, is_required, sort_order, applicable_category_kinds, " +
  "options(id, name, price_delta_cents:price_delta_cents::text, is_available, sort_order)";

const LINK_SELECT = "option_group_id, default_option_ids";

const linkRowSchema = z.object({ option_group_id: z.string(), default_option_ids: z.array(z.string()) });

async function readLinks(operation: string, query: PromiseLike<QueryResponse>): Promise<AdminResult<OptionGroupLink[]>> {
  const response = await write(operation, query);
  if (!response.ok) return response;
  const rows = parseRows("product_option_groups", linkRowSchema, response.value ?? []);
  return rows.ok ? ok(rows.value.map((row) => ({ groupId: row.option_group_id, defaultOptionIds: row.default_option_ids }))) : rows;
}

/** Same groups with the same defaults; order is irrelevant. */
function sameLinks(a: OptionGroupLink[], b: OptionGroupLink[]) {
  const key = (links: OptionGroupLink[]) => JSON.stringify(links.map((link) => [link.groupId, [...link.defaultOptionIds].sort()]).sort());
  return key(a) === key(b);
}

const imageRowSchema = z.object({
  id: z.string(),
  storage_path: z.string(),
  alt_text: z.string(),
  focal_x: z.number().int(),
  focal_y: z.number().int(),
  is_primary: z.boolean(),
  sort_order: z.number().int()
});

export function createSupabaseCatalogAdminRepository(client: SupabaseClient<Database>): CatalogAdminRepository {
  const bucket = () => client.storage.from(CATALOG_BUCKET);

  async function readProducts(operation: string, query: PromiseLike<QueryResponse>) {
    const response = await write(operation, query);
    if (!response.ok) return response;
    const rows = parseRows("products", storedProductRowSchema, response.value);
    return rows.ok ? ok(rows.value.map(toStoredProduct)) : rows;
  }

  return {
    async listCategories(storeId) {
      const response = await write("categories.select", client.from("categories").select(CATEGORY_SELECT).eq("store_id", storeId).order("sort_order") as PromiseLike<QueryResponse>);
      if (!response.ok) return response;
      const rows = parseRows("categories", categoryRowSchema, response.value);
      if (!rows.ok) return rows;
      return ok(
        rows.value
          .map((row) => ({
            id: row.id,
            slug: row.slug,
            name: row.name,
            kind: row.kind,
            type: productTypeByKind[row.kind],
            sortOrder: row.sort_order,
            visible: row.is_visible
          }))
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "es"))
      );
    },

    async listOptionGroups(storeId) {
      const response = await write("option_groups.select", client.from("option_groups").select(OPTION_GROUP_SELECT).eq("store_id", storeId).order("sort_order") as PromiseLike<QueryResponse>);
      if (!response.ok) return response;
      const rows = parseRows("option_groups", optionGroupRowSchema, response.value);
      if (!rows.ok) return rows;
      return ok(
        rows.value.map(
          (group): AdminOptionGroup => ({
            id: group.id,
            name: group.name,
            selectionMode: group.selection_mode,
            required: group.is_required,
            minSelections: group.minimum_selections,
            maxSelections: group.maximum_selections,
            applicableTypes: group.applicable_category_kinds.map((kind) => productTypeByKind[kind]),
            options: [...group.options]
              .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "es"))
              .map((option) => ({ id: option.id, name: option.name, priceDeltaCents: option.price_delta_cents, available: option.is_available }))
          })
        )
      );
    },

    listProducts(storeId, categoryId) {
      return readProducts(
        "products.select",
        client.from("products").select(STORED_PRODUCT_SELECT).eq("store_id", storeId).eq("category_id", categoryId) as PromiseLike<QueryResponse>
      );
    },

    async getProduct(storeId, productId) {
      const rows = await readProducts(
        "products.select",
        client.from("products").select(STORED_PRODUCT_SELECT).eq("store_id", storeId).eq("id", productId) as PromiseLike<QueryResponse>
      );
      return rows.ok ? ok(rows.value[0] ?? null) : rows;
    },

    async createCategory(storeId, fields) {
      const response = await write(
        "categories.insert",
        client
          .from("categories")
          .insert({ store_id: storeId, name: fields.name, slug: fields.slug, kind: fields.kind, sort_order: fields.sortOrder, is_visible: fields.visible })
          .select("id")
          .single() as PromiseLike<QueryResponse>
      );
      if (!response.ok) return response;
      const id = (response.value as { id?: unknown } | null)?.id;
      return typeof id === "string" ? ok({ id }) : catalogError("invalid_data", "categories.insert: no id returned");
    },

    updateCategory(storeId, categoryId, fields) {
      return writeOne(
        "categories.update",
        client
          .from("categories")
          .update({ name: fields.name, slug: fields.slug, is_visible: fields.visible })
          .eq("store_id", storeId)
          .eq("id", categoryId)
          .select("id") as PromiseLike<QueryResponse>
      );
    },

    deleteCategory(storeId, categoryId) {
      return writeOne("categories.delete", client.from("categories").delete().eq("store_id", storeId).eq("id", categoryId).select("id") as PromiseLike<QueryResponse>);
    },

    async setCategoryOrder(storeId, rows) {
      for (const row of rows) {
        const saved = await writeOne(
          "categories.update",
          client.from("categories").update({ sort_order: row.sortOrder }).eq("store_id", storeId).eq("id", row.id).select("id") as PromiseLike<QueryResponse>
        );
        if (!saved.ok) return saved;
      }
      return ok(undefined);
    },

    async createProduct(storeId, fields) {
      const price = toSafeNumber(fields.priceCents);
      if (price === null) return err({ code: "rejected", message: "products.insert: price out of range" });
      const response = await write(
        "products.insert",
        client
          .from("products")
          .insert({
            store_id: storeId,
            category_id: fields.categoryId,
            name: fields.name,
            slug: fields.slug,
            description: fields.description,
            base_price_cents: price,
            is_available: fields.inStock,
            is_featured: fields.featured,
            is_published: false,
            contains_alcohol: false,
            sort_order: fields.sortOrder
          })
          .select("id")
          .single() as PromiseLike<QueryResponse>
      );
      if (!response.ok) return response;
      const id = (response.value as { id?: unknown } | null)?.id;
      return typeof id === "string" ? ok({ id }) : catalogError("invalid_data", "products.insert: no id returned");
    },

    updateProduct(storeId, productId, fields) {
      const price = toSafeNumber(fields.priceCents);
      if (price === null) return Promise.resolve(err({ code: "rejected", message: "products.update: price out of range" }));
      return writeOne(
        "products.update",
        client
          .from("products")
          .update({
            category_id: fields.categoryId,
            name: fields.name,
            slug: fields.slug,
            description: fields.description,
            base_price_cents: price,
            is_available: fields.inStock,
            is_featured: fields.featured,
            contains_alcohol: false,
            ...(fields.published === undefined ? {} : { is_published: fields.published }),
            ...(fields.sortOrder === undefined ? {} : { sort_order: fields.sortOrder })
          })
          .eq("store_id", storeId)
          .eq("id", productId)
          .select("id") as PromiseLike<QueryResponse>
      );
    },

    setProductPublished(storeId, productId, published) {
      return writeOne(
        "products.update",
        client.from("products").update({ is_published: published }).eq("store_id", storeId).eq("id", productId).select("id") as PromiseLike<QueryResponse>
      );
    },

    /*
     * Not atomic (PostgREST runs one statement per request), so each step is checked instead of
     * trusted: the delete must remove every link that was there, the insert must store every new
     * one, and reading back must give exactly the requested links. A step that RLS filters out
     * (zero rows, no error) or a concurrent change fails the whole replacement.
     */
    async replaceOptionGroups(storeId, productId, links) {
      const read = () =>
        readLinks(
          "product_option_groups.select",
          client.from("product_option_groups").select(LINK_SELECT).eq("store_id", storeId).eq("product_id", productId) as PromiseLike<QueryResponse>
        );

      const before = await read();
      if (!before.ok) return before;
      const removed = await readLinks(
        "product_option_groups.delete",
        client.from("product_option_groups").delete().eq("store_id", storeId).eq("product_id", productId).select(LINK_SELECT) as PromiseLike<QueryResponse>
      );
      if (!removed.ok) return removed;
      const removedIds = new Set(removed.value.map((link) => link.groupId));
      if (before.value.some((link) => !removedIds.has(link.groupId))) {
        return catalogError("unauthorized", "product_option_groups.delete: existing links were not removed (RLS or concurrent change)");
      }

      if (links.length > 0) {
        const inserted = await readLinks(
          "product_option_groups.insert",
          client
            .from("product_option_groups")
            .insert(
              links.map((link, index) => ({
                store_id: storeId,
                product_id: productId,
                option_group_id: link.groupId,
                default_option_ids: link.defaultOptionIds,
                sort_order: (index + 1) * 10
              }))
            )
            .select(LINK_SELECT) as PromiseLike<QueryResponse>
        );
        if (!inserted.ok) return inserted;
        if (inserted.value.length !== links.length) {
          return catalogError("unauthorized", `product_option_groups.insert: stored ${inserted.value.length} of ${links.length} links`);
        }
      }

      const after = await read();
      if (!after.ok) return after;
      return sameLinks(after.value, links)
        ? ok(undefined)
        : catalogError("unavailable", "product_option_groups: links read back differ from the requested ones");
    },

    async createOption(groupId, fields) {
      const price = toSafeNumber(fields.priceDeltaCents);
      if (price === null) return err({ code: "rejected" as const, message: "options.insert: price out of range" });
      const response = await write(
        "options.insert",
        client
          .from("options")
          .insert({ option_group_id: groupId, name: fields.name, price_delta_cents: price, is_available: fields.available, sort_order: fields.sortOrder })
          .select("id")
          .single() as PromiseLike<QueryResponse>
      );
      if (!response.ok) return response;
      const id = (response.value as { id?: unknown } | null)?.id;
      return typeof id === "string" ? ok({ id }) : catalogError("invalid_data", "options.insert: no id returned");
    },

    updateOption(groupId, optionId, fields) {
      const price = toSafeNumber(fields.priceDeltaCents);
      if (price === null) return Promise.resolve(err({ code: "rejected" as const, message: "options.update: price out of range" }));
      return writeOne(
        "options.update",
        client
          .from("options")
          .update({ name: fields.name, price_delta_cents: price, is_available: fields.available })
          .eq("option_group_id", groupId)
          .eq("id", optionId)
          .select("id") as PromiseLike<QueryResponse>
      );
    },

    async setOptionOrder(groupId, rows) {
      for (const row of rows) {
        const saved = await writeOne(
          "options.update",
          client.from("options").update({ sort_order: row.sortOrder }).eq("option_group_id", groupId).eq("id", row.id).select("id") as PromiseLike<QueryResponse>
        );
        if (!saved.ok) return saved;
      }
      return ok(undefined);
    },

    async setProductOrder(storeId, rows) {
      for (const row of rows) {
        const saved = await writeOne(
          "products.update",
          client.from("products").update({ sort_order: row.sortOrder }).eq("store_id", storeId).eq("id", row.id).select("id") as PromiseLike<QueryResponse>
        );
        if (!saved.ok) return saved;
      }
      return ok(undefined);
    },

    async isProductInPromotion(storeId, productId) {
      const response = await write(
        "promotion_items.select",
        client.from("promotion_items").select("promotion_id").eq("store_id", storeId).eq("product_id", productId).limit(1) as PromiseLike<QueryResponse>
      );
      return response.ok ? ok(Array.isArray(response.value) && response.value.length > 0) : response;
    },

    deleteProduct(storeId, productId) {
      return writeOne("products.delete", client.from("products").delete().eq("store_id", storeId).eq("id", productId).select("id") as PromiseLike<QueryResponse>);
    },

    async getPrimaryImage(storeId, productId) {
      const response = await write(
        "product_images.select",
        client
          .from("product_images")
          .select("id, storage_path, alt_text, focal_x, focal_y, is_primary, sort_order, products!inner(store_id)")
          .eq("product_id", productId)
          .eq("products.store_id", storeId) as PromiseLike<QueryResponse>
      );
      if (!response.ok) return response;
      const rows = parseRows("product_images", imageRowSchema, response.value);
      if (!rows.ok) return rows;
      const [primary] = [...rows.value].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order);
      const image: StoredImage | null = primary
        ? { id: primary.id, storagePath: primary.storage_path, altText: primary.alt_text, focalX: primary.focal_x, focalY: primary.focal_y }
        : null;
      return ok(image);
    },

    async putObject(path, bytes, contentType) {
      try {
        const { error } = await bucket().upload(path, bytes, { contentType, upsert: false, cacheControl: "31536000" });
        return error ? storageError("storage.upload", error) : ok(undefined);
      } catch (thrown) {
        return storageError("storage.upload", thrown);
      }
    },

    async removeObjects(paths) {
      try {
        const { error } = await bucket().remove(paths);
        return error ? storageError("storage.remove", error) : ok(undefined);
      } catch (thrown) {
        return storageError("storage.remove", thrown);
      }
    },

    async savePrimaryImage(productId, existingImageId, image) {
      const values = { storage_path: image.storagePath, alt_text: image.altText, focal_x: image.focalX, focal_y: image.focalY };
      if (existingImageId) {
        return writeOne(
          "product_images.update",
          client.from("product_images").update({ ...values, is_primary: true }).eq("id", existingImageId).eq("product_id", productId).select("id") as PromiseLike<QueryResponse>
        );
      }
      return writeOne(
        "product_images.insert",
        client.from("product_images").insert({ ...values, product_id: productId, is_primary: true, sort_order: 0 }).select("id") as PromiseLike<QueryResponse>
      );
    },

    updateImageDetails(imageId, details) {
      return writeOne(
        "product_images.update",
        client
          .from("product_images")
          .update({ alt_text: details.altText, focal_x: details.focalX, focal_y: details.focalY })
          .eq("id", imageId)
          .select("id") as PromiseLike<QueryResponse>
      );
    },

    deleteImage(imageId) {
      return writeOne("product_images.delete", client.from("product_images").delete().eq("id", imageId).select("id") as PromiseLike<QueryResponse>);
    }
  };
}
