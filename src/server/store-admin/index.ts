import "server-only";

import { evaluateStoreStatus, toPublicStoreStatus, type PublicStoreStatus, type StoreStatus } from "@/domain/store-status";
import type { Catalog } from "@/domain/types";
import { ok, type Result } from "@/lib/result";
import type { AdminError } from "@/server/admin/use-case";
import { STORE_SLUG } from "@/server/catalog";
import { createSupabaseAdminAccess } from "@/server/catalog/admin-access";
import { loadAdminCatalog } from "@/server/catalog/catalog-service";
import { reportCatalogError, type CatalogError } from "@/server/catalog/errors";
import { createSupabaseCatalogRepository } from "@/server/catalog/supabase-catalog-repository";
import { getMercadoPagoAvailability, type MercadoPagoUnavailableReason } from "@/server/payments/mercado-pago-availability";
import { createSessionClient } from "@/server/supabase/clients";
import { catalogImageBaseUrl, readSupabaseConfig } from "@/server/supabase/config";
import type { StoreAdminDependencies } from "./store-admin-service";
import type { StoredShift } from "./ports";
import { createSupabaseStoreAdminRepository } from "./supabase-store-admin-repository";

export * from "./store-admin-service";
export { PAYMENT_METHODS, STATUS_OVERRIDES, type StoredShift } from "./ports";

/** Only whether Mercado Pago could start and, if not, why; never its configuration. */
function mercadoPagoState(catalog: Catalog): { available: boolean; reasons: MercadoPagoUnavailableReason[] } {
  const availability = getMercadoPagoAvailability({ storePaymentMethods: catalog.store.paymentMethods });
  return availability.available ? { available: true, reasons: [] } : { available: false, reasons: availability.reasons };
}

export async function storeAdminDependencies(): Promise<Result<StoreAdminDependencies, CatalogError>> {
  const config = readSupabaseConfig();
  if (!config.ok) {
    reportCatalogError("admin", config.error);
    return config;
  }
  const client = await createSessionClient(config.value);
  return ok({
    repository: createSupabaseStoreAdminRepository(client),
    access: createSupabaseAdminAccess(client),
    storeSlug: STORE_SLUG,
    // Without the store's methods the answer covers only the server side (config, persistence, quota).
    mercadoPagoConfigured: () => getMercadoPagoAvailability().available
  });
}

export interface StoreAdminView {
  catalog: Catalog;
  shifts: StoredShift[];
  status: StoreStatus;
  /** Exactly what `GET /api/store/status` gives customers. */
  publicStatus: PublicStoreStatus;
  mercadoPago: { available: boolean; reasons: MercadoPagoUnavailableReason[] };
}

/** Everything the store and promotion screens show, behind the same gate as the catalog admin. */
export async function getStoreAdminView(now: Date = new Date()): Promise<Result<StoreAdminView, CatalogError | AdminError>> {
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
  const shifts = await createSupabaseStoreAdminRepository(client).listShifts(catalog.value.store.id);
  if (!shifts.ok) {
    reportCatalogError("admin", { code: "unavailable", message: shifts.error.message });
    return shifts;
  }
  const status = evaluateStoreStatus(catalog.value.store, now);
  return ok({ catalog: catalog.value, shifts: shifts.value, status, publicStatus: toPublicStoreStatus(status), mercadoPago: mercadoPagoState(catalog.value) });
}
