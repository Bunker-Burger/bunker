import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { toPublicPromotion, type PublicPromotion } from "@/domain/public-promotions";
import type { PromotionRule } from "@/domain/types";
import { ok, type Result } from "@/lib/result";
import type { Database } from "@/server/supabase/database.types";
import { parseRows } from "./adapters";
import type { CatalogError } from "./errors";
import { run, type QueryResponse } from "./supabase-catalog-repository";

const productSlugRowSchema = z.object({ id: z.string(), slug: z.string() });

/**
 * Slugs of the public (published) products the rules mention. `client` must not cache (see
 * `createOperationalReadClient`), like the rules it accompanies.
 */
async function publicProductSlugs(
  client: SupabaseClient<Database>,
  storeId: string,
  rules: readonly PromotionRule[]
): Promise<Result<Map<string, string>, CatalogError>> {
  const ids = [...new Set(rules.flatMap((rule) => rule.items.map((item) => item.productId)))];
  if (ids.length === 0) return ok(new Map());
  const query = client.from("products").select("id, slug").eq("store_id", storeId).eq("is_published", true).in("id", ids);
  const response = await run("products.slugs.select", query as PromiseLike<QueryResponse>);
  if (!response.ok) return response;
  const rows = parseRows("products", productSlugRowSchema, response.value);
  return rows.ok ? ok(new Map(rows.value.map((row) => [row.id, row.slug]))) : rows;
}

/** The store's visible rules as the public endpoint publishes them. */
export async function toPublicPromotions(
  client: SupabaseClient<Database>,
  storeId: string,
  rules: readonly PromotionRule[]
): Promise<Result<PublicPromotion[], CatalogError>> {
  const slugs = await publicProductSlugs(client, storeId, rules);
  return slugs.ok ? ok(rules.map((rule) => toPublicPromotion(rule, slugs.value))) : slugs;
}

/**
 * HTTP response for `GET /api/store/promotions`. Never cached, so a pause or an edit is seen on
 * the next read. Failures expose only the error code and no rules: the menu then announces no
 * discount, and the server quote decides on its own.
 */
export function publicPromotionsResponse(result: Result<PublicPromotion[], CatalogError>): Response {
  const headers = { "Cache-Control": "no-store" };
  if (result.ok) return Response.json({ promotions: result.value }, { headers });
  const status = result.error.code === "not_found" ? 404 : 503;
  return Response.json({ error: result.error.code }, { status, headers });
}
