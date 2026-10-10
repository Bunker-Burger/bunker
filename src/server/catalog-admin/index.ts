import "server-only";

import type { Catalog } from "@/domain/types";
import { ok, type Result } from "@/lib/result";
import { STORE_SLUG } from "@/server/catalog";
import { createSupabaseAdminAccess } from "@/server/catalog/admin-access";
import { loadAdminCatalog } from "@/server/catalog/catalog-service";
import { reportCatalogError, type CatalogError } from "@/server/catalog/errors";
import { createSupabaseCatalogRepository } from "@/server/catalog/supabase-catalog-repository";
import { createSessionClient } from "@/server/supabase/clients";
import { catalogImageBaseUrl, readSupabaseConfig } from "@/server/supabase/config";
import type { CatalogAdminDependencies } from "./catalog-admin-service";
import type { AdminError, AdminOptionGroup } from "./ports";
import { createSupabaseCatalogAdminRepository } from "./supabase-catalog-admin-repository";

export * from "./catalog-admin-service";
export { ADMIN_CATEGORY_KINDS, type AdminCategoryKind, type AdminOptionGroup } from "./ports";
export { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, MIN_IMAGE_SIDE } from "./image";

/** Writes as the signed-in user (session cookies): RLS and the admin gate decide, never a service role. */
export async function catalogAdminDependencies(): Promise<Result<CatalogAdminDependencies, CatalogError>> {
  const config = readSupabaseConfig();
  if (!config.ok) {
    reportCatalogError("admin", config.error);
    return config;
  }
  const client = await createSessionClient(config.value);
  return ok({
    repository: createSupabaseCatalogAdminRepository(client),
    access: createSupabaseAdminAccess(client),
    storeSlug: STORE_SLUG
  });
}

export interface CatalogAdminView {
  catalog: Catalog;
  optionGroups: AdminOptionGroup[];
}

/**
 * Everything the catalog admin screens show: the full catalog (drafts, hidden categories) and
 * the store's option groups. Same gate as `getAdminCatalog`; never cached.
 */
export async function getCatalogAdminView(): Promise<Result<CatalogAdminView, CatalogError | AdminError>> {
  const config = readSupabaseConfig();
  if (!config.ok) {
    reportCatalogError("admin", config.error);
    return config;
  }
  const client = await createSessionClient(config.value);
  const repository = createSupabaseCatalogRepository(client, { scope: "admin", imageBaseUrl: catalogImageBaseUrl(config.value) });
  const catalog = await loadAdminCatalog(repository, createSupabaseAdminAccess(client), STORE_SLUG);
  if (!catalog.ok) {
    reportCatalogError("admin", catalog.error);
    return catalog;
  }
  const optionGroups = await createSupabaseCatalogAdminRepository(client).listOptionGroups(catalog.value.store.id);
  if (!optionGroups.ok) {
    reportCatalogError("admin", { code: "unavailable", message: optionGroups.error.message });
    return optionGroups;
  }
  return ok({ catalog: catalog.value, optionGroups: optionGroups.value });
}
