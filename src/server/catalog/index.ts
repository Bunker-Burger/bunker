import "server-only";

import type { StoreStatus } from "@/domain/store-status";
import type { Catalog, PromotionRule } from "@/domain/types";
import type { PublicPromotion } from "@/domain/public-promotions";
import { ok, type Result } from "@/lib/result";
import { createOperationalReadClient, createPublicReadClient, createSessionClient } from "@/server/supabase/clients";
import { catalogImageBaseUrl, readSupabaseConfig } from "@/server/supabase/config";
import { createSupabaseAdminAccess } from "./admin-access";
import { loadAdminCatalog, loadPublicCatalog } from "./catalog-service";
import { reportCatalogError, type CatalogError } from "./errors";
import { toPublicPromotions } from "./public-promotions";
import { createSupabaseStoreOperatingRepository, loadStoreStatus } from "./store-status";
import { createSupabaseCatalogRepository } from "./supabase-catalog-repository";

export { CATALOG_CACHE_TAG } from "@/server/supabase/clients";
export type { CatalogError, CatalogErrorCode } from "./errors";

/** Slug of the single store this deployment serves. */
export const STORE_SLUG = "bunker-burger";

/** Customer-facing catalog: anonymous and cacheable. Failures are logged and returned. */
export async function getPublicCatalog(storeSlug: string = STORE_SLUG): Promise<Result<Catalog, CatalogError>> {
  const config = readSupabaseConfig();
  if (!config.ok) {
    reportCatalogError("public", config.error);
    return config;
  }
  const repository = createSupabaseCatalogRepository(createPublicReadClient(config.value), {
    scope: "public",
    imageBaseUrl: catalogImageBaseUrl(config.value)
  });
  const catalog = await loadPublicCatalog(repository, storeSlug);
  if (!catalog.ok) reportCatalogError("public", catalog.error);
  return catalog;
}

/**
 * Customer-facing catalog read with real freshness (never cached by Next data cache)
 * for authoritative cart revalidation, price checks and option availability.
 */
export async function getOperationalPublicCatalog(storeSlug: string = STORE_SLUG): Promise<Result<Catalog, CatalogError>> {
  const config = readSupabaseConfig();
  if (!config.ok) {
    reportCatalogError("public", config.error);
    return config;
  }
  const repository = createSupabaseCatalogRepository(createOperationalReadClient(config.value), {
    scope: "public",
    imageBaseUrl: catalogImageBaseUrl(config.value)
  });
  const catalog = await loadPublicCatalog(repository, storeSlug);
  if (!catalog.ok) reportCatalogError("public", catalog.error);
  return catalog;
}

/**
 * Whether the store takes orders right now, and its delivery fee, decided on the server from
 * the persisted override, weekly hours (store time zone) and fee. Anonymous and never cached:
 * every call reads the database, so a pause, closure or fee change applies to the next check,
 * quote or payment without depending on catalog cache invalidation.
 */
export async function getStoreStatus(
  storeSlug: string = STORE_SLUG,
  now: Date = new Date()
): Promise<Result<StoreStatus, CatalogError>> {
  const config = readSupabaseConfig();
  if (!config.ok) {
    reportCatalogError("public", config.error);
    return config;
  }
  const repository = createSupabaseStoreOperatingRepository(createOperationalReadClient(config.value));
  const status = await loadStoreStatus(repository, storeSlug, now);
  if (!status.ok) reportCatalogError("public", status.error);
  return status;
}

/**
 * Promotion rules to quote with: read fresh on every call (never from the catalog cache), so a
 * paused or edited promotion applies to the next quote. RLS only exposes active rules inside
 * their date range; the quote still re-checks window, schedule, channel and priority.
 */
export async function getPromotionsForQuote(storeSlug: string = STORE_SLUG): Promise<Result<PromotionRule[], CatalogError>> {
  const read = await readPublicPromotionRules(storeSlug);
  return read.ok ? ok(read.value.rules) : read;
}

/**
 * The same fresh rules as `getPromotionsForQuote`, in the public shape the menu and checkout
 * estimate read from `GET /api/store/promotions`: the browser never advertises a promotion
 * the quote would not apply. Anonymous: only data RLS already shows to anyone.
 */
export async function getPublicPromotions(storeSlug: string = STORE_SLUG): Promise<Result<PublicPromotion[], CatalogError>> {
  const read = await readPublicPromotionRules(storeSlug);
  if (!read.ok) return read;
  const promotions = await toPublicPromotions(read.value.client, read.value.storeId, read.value.rules);
  if (!promotions.ok) reportCatalogError("public", promotions.error);
  return promotions;
}

async function readPublicPromotionRules(storeSlug: string) {
  const config = readSupabaseConfig();
  if (!config.ok) {
    reportCatalogError("public", config.error);
    return config;
  }
  const client = createOperationalReadClient(config.value);
  const repository = createSupabaseCatalogRepository(client, { scope: "public", imageBaseUrl: catalogImageBaseUrl(config.value) });
  const store = await repository.getStoreBySlug(storeSlug);
  if (!store.ok) {
    reportCatalogError("public", store.error);
    return store;
  }
  const rules = await repository.listPromotions(store.value.id);
  if (!rules.ok) {
    reportCatalogError("public", rules.error);
    return rules;
  }
  return ok({ client, storeId: store.value.id, rules: rules.value });
}

/**
 * Full catalog (unpublished, hidden, inactive) for an active admin of the store; never cached.
 * No session, an expired session or a user without an active membership yields `unauthorized`.
 */
export async function getAdminCatalog(storeSlug: string = STORE_SLUG): Promise<Result<Catalog, CatalogError>> {
  const config = readSupabaseConfig();
  if (!config.ok) {
    reportCatalogError("admin", config.error);
    return config;
  }
  const client = await createSessionClient(config.value);
  const repository = createSupabaseCatalogRepository(client, {
    scope: "admin",
    imageBaseUrl: catalogImageBaseUrl(config.value)
  });
  const catalog = await loadAdminCatalog(repository, createSupabaseAdminAccess(client), storeSlug);
  if (!catalog.ok) reportCatalogError("admin", catalog.error);
  return catalog;
}
