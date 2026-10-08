import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateStoreStatus,
  toPublicStoreStatus,
  type StoreOperatingSettings,
  type StoreStatus
} from "@/domain/store-status";
import { ok, type Result } from "@/lib/result";
import type { Database } from "@/server/supabase/database.types";
import { parseRows, toStoreOperatingSettings } from "./adapters";
import { catalogError, type CatalogError } from "./errors";
import { STORE_OPERATING_SELECT, storeOperatingRowSchema } from "./rows";
import { run, type QueryResponse } from "./supabase-catalog-repository";

/**
 * Operational read of a public store: override, time zone, delivery fee and weekly hours.
 * Kept apart from the cacheable catalog so it can always hit the database.
 */
export interface StoreOperatingRepository {
  getOperatingSettings(storeSlug: string): Promise<Result<StoreOperatingSettings, CatalogError>>;
}

/** `client` must not cache (see `createOperationalReadClient`); only public stores are visible. */
export function createSupabaseStoreOperatingRepository(client: SupabaseClient<Database>): StoreOperatingRepository {
  return {
    async getOperatingSettings(storeSlug) {
      const query = client.from("stores").select(STORE_OPERATING_SELECT).eq("slug", storeSlug).eq("is_public", true);
      const response = await run("stores.operating.select", query.maybeSingle() as PromiseLike<QueryResponse>);
      if (!response.ok) return response;
      if (response.value === null) return catalogError("not_found", `stores: no public store "${storeSlug}"`);
      const rows = parseRows("stores", storeOperatingRowSchema, [response.value]);
      if (!rows.ok) return rows;
      const [row] = rows.value;
      return row ? ok(toStoreOperatingSettings(row)) : catalogError("invalid_data", "stores: empty row");
    }
  };
}

/** Store status at `now` from the persisted override, hours, time zone and fee. */
export async function loadStoreStatus(
  repository: StoreOperatingRepository,
  storeSlug: string,
  now: Date = new Date()
): Promise<Result<StoreStatus, CatalogError>> {
  const settings = await repository.getOperatingSettings(storeSlug);
  if (!settings.ok) return settings;
  return ok(evaluateStoreStatus(settings.value, now));
}

/**
 * HTTP response for the public status endpoint. Never cached: the answer depends on the clock.
 * Failures fail closed (`acceptingOrders: false`) and expose only the error code.
 */
export function storeStatusResponse(result: Result<StoreStatus, CatalogError>): Response {
  const headers = { "Cache-Control": "no-store" };
  if (result.ok) return Response.json(toPublicStoreStatus(result.value), { headers });
  const status = result.error.code === "not_found" ? 404 : 503;
  return Response.json({ acceptingOrders: false, error: result.error.code }, { status, headers });
}
