import type { SupabaseClient } from "@supabase/supabase-js";
import { ok, type Result } from "@/lib/result";
import type { Database } from "@/server/supabase/database.types";
import { parseRows, toCategories, toProducts, toPromotionRules, toStoreSettings } from "./adapters";
import { catalogError, fromSupabaseError, type CatalogError } from "./errors";
import type { CatalogRepository, CatalogScope } from "./ports";
import {
  CATEGORY_SELECT,
  categoryRowSchema,
  PRODUCT_SELECT,
  productRowSchema,
  PROMOTION_SELECT,
  PROMOTION_SELECT_WITH_FOCAL,
  PROMOTION_SELECT_WITH_IMAGE,
  promotionRowSchema,
  STORE_SELECT,
  PICKUP_COLUMNS,
  storeRowSchema
} from "./rows";

interface SupabaseCatalogRepositoryOptions {
  scope: CatalogScope;
  /** Public URL prefix of the `catalog` storage bucket. */
  imageBaseUrl: string;
}

export interface QueryResponse {
  data: unknown;
  error: unknown;
  status: number;
}

/** PostgREST answer for a column the database does not have (yet). */
export function isMissingColumn(cause: unknown) {
  const code = typeof cause === "object" && cause !== null && "code" in cause ? String((cause as { code: unknown }).code) : "";
  return code === "42703" || code === "PGRST204";
}

/** Runs a PostgREST query, turning both returned errors and thrown network failures into results. */
export async function run(operation: string, query: PromiseLike<QueryResponse>): Promise<Result<unknown, CatalogError>> {
  try {
    const { data, error, status } = await query;
    return error ? fromSupabaseError(operation, error, status) : ok(data);
  } catch (thrown) {
    return fromSupabaseError(operation, thrown);
  }
}

export function createSupabaseCatalogRepository(
  client: SupabaseClient<Database>,
  { scope, imageBaseUrl }: SupabaseCatalogRepositoryOptions
): CatalogRepository {
  const isPublic = scope === "public";

  return {
    scope,

    async getStoreBySlug(slug) {
      const read = (columns: string) => {
        let query = client.from("stores").select(columns).eq("slug", slug);
        if (isPublic) query = query.eq("is_public", true).eq("store_payment_methods.is_enabled", true);
        return run("stores.select", query.maybeSingle() as PromiseLike<QueryResponse>);
      };
      let response = await read(STORE_SELECT + PICKUP_COLUMNS);
      // Before the pickup-location migration the columns do not exist: read as before.
      if (!response.ok && isMissingColumn(response.error.cause)) response = await read(STORE_SELECT);
      if (!response.ok) return response;
      if (response.value === null) return catalogError("not_found", `stores: no store "${slug}" for ${scope} reads`);
      const rows = parseRows("stores", storeRowSchema, [response.value]);
      if (!rows.ok) return rows;
      const [row] = rows.value;
      return row ? ok(toStoreSettings(row)) : catalogError("invalid_data", "stores: empty row");
    },

    async listCategories(storeId) {
      let query = client.from("categories").select(CATEGORY_SELECT).eq("store_id", storeId);
      if (isPublic) query = query.eq("is_visible", true);
      const response = await run("categories.select", query.order("sort_order") as PromiseLike<QueryResponse>);
      if (!response.ok) return response;
      const rows = parseRows("categories", categoryRowSchema, response.value);
      return rows.ok ? ok(toCategories(rows.value)) : rows;
    },

    async listProducts(storeId, categories) {
      let query = client.from("products").select(PRODUCT_SELECT).eq("store_id", storeId);
      if (isPublic) query = query.eq("is_published", true);
      const response = await run("products.select", query.order("name") as PromiseLike<QueryResponse>);
      if (!response.ok) return response;
      const rows = parseRows("products", productRowSchema, response.value);
      return rows.ok ? toProducts(rows.value, { categories, imageBaseUrl }) : rows;
    },

    async listPromotions(storeId) {
      // The validity window is applied by the caller at read time, so cached responses never
      // keep an expired promotion alive.
      const read = (columns: string) => {
        let query = client.from("promotion_rules").select(columns).eq("store_id", storeId);
        if (isPublic) query = query.eq("is_active", true);
        return run("promotion_rules.select", query.order("priority") as PromiseLike<QueryResponse>);
      };
      // Newest columns first; a database without the photo (or framing) migrations reads as before.
      let response = await read(PROMOTION_SELECT_WITH_FOCAL);
      for (const older of [PROMOTION_SELECT_WITH_IMAGE, PROMOTION_SELECT]) {
        if (response.ok || !isMissingColumn(response.error.cause)) break;
        response = await read(older);
      }
      if (!response.ok) return response;
      const rows = parseRows("promotion_rules", promotionRowSchema, response.value);
      return rows.ok ? toPromotionRules(rows.value, imageBaseUrl) : rows;
    }
  };
}
