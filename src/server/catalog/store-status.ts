import { evaluateStoreStatus, type StoreState, type StoreStatus, type StoreStatusReason } from "@/domain/store-status";
import { ok, type Result } from "@/lib/result";
import { catalogError, type CatalogError } from "./errors";
import type { CatalogRepository } from "./ports";

/**
 * Store status at `now` from the store's persisted override, hours, time zone and fee.
 * Only public reads: the status shown to customers must never depend on who asks.
 */
export async function loadStoreStatus(
  repository: CatalogRepository,
  storeSlug: string,
  now: Date = new Date()
): Promise<Result<StoreStatus, CatalogError>> {
  if (repository.scope !== "public") {
    return catalogError("misconfigured", `store status: expected a public repository, got ${repository.scope}`);
  }
  const store = await repository.getStoreBySlug(storeSlug);
  if (!store.ok) return store;
  return ok(evaluateStoreStatus(store.value, now));
}

/** Minimal public shape: no hours table, no override details beyond the reason. Money as string. */
export interface PublicStoreStatus {
  state: StoreState;
  acceptingOrders: boolean;
  reason: StoreStatusReason;
  closesAt: string | null;
  nextOpeningAt: string | null;
  deliveryFeeCents: string | null;
  timezone: string;
}

export function toPublicStoreStatus(status: StoreStatus): PublicStoreStatus {
  return {
    state: status.state,
    acceptingOrders: status.acceptingOrders,
    reason: status.reason,
    closesAt: status.closesAt?.toISOString() ?? null,
    nextOpeningAt: status.nextOpeningAt?.toISOString() ?? null,
    deliveryFeeCents: status.deliveryFeeCents?.toString() ?? null,
    timezone: status.timezone
  };
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
