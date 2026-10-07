import "server-only";

import type { Catalog } from "@/domain/types";
import type { Result } from "@/lib/result";
import { createPublicReadClient, createSessionClient } from "@/server/supabase/clients";
import { catalogImageBaseUrl, readSupabaseConfig } from "@/server/supabase/config";
import { createSupabaseAdminAccess } from "./admin-access";
import { loadAdminCatalog, loadPublicCatalog } from "./catalog-service";
import { reportCatalogError, type CatalogError } from "./errors";
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
