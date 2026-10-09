import type { PaymentMethodSetting } from "@/domain/types";
import { rateLimitBackendKind } from "@/server/rate-limit";
import { detectMercadoPagoConfig, type MercadoPagoConfig } from "./mercado-pago";
import { isPaymentPersistenceConfigured } from "./payment-repository";

export type MercadoPagoUnavailableReason =
  /** Access Token or public return URL (`APP_URL`) absent or invalid. */
  | "config"
  /** The store did not enable Mercado Pago, or its payment methods could not be read. */
  | "payment_method_disabled"
  /** No durable storage for quotes and attempts (service role / Supabase project). */
  | "persistence"
  /** Production requires a distributed quota backend (`RATE_LIMIT_UPSTREAM_URL`) and there is none. */
  | "rate_limit_backend";

export type MercadoPagoAvailability =
  | { available: true; config: MercadoPagoConfig }
  | { available: false; reasons: MercadoPagoUnavailableReason[] };

/**
 * The single server-side answer to "can a Mercado Pago checkout start right now?", used by the
 * storefront to decide whether to offer it and by the route as a first guard. It mirrors the
 * route's own fail-closed checks (config, durable persistence, distributed quota in production),
 * which stay in place as defense in depth. Never throws; only the boolean reaches the browser.
 *
 * `storePaymentMethods`: the store's methods when known; `null` when they could not be read
 * (unavailable); omitted when the caller checks the method itself (the route, after loading
 * the catalog).
 */
export function getMercadoPagoAvailability(
  options: {
    storePaymentMethods?: readonly PaymentMethodSetting[] | null;
    environment?: Readonly<Record<string, string | undefined>>;
  } = {}
): MercadoPagoAvailability {
  const environment = options.environment ?? process.env;
  const reasons: MercadoPagoUnavailableReason[] = [];

  const detection = detectMercadoPagoConfig(environment);
  if (!detection.enabled) reasons.push("config");

  if (options.storePaymentMethods !== undefined) {
    const method = options.storePaymentMethods?.find((candidate) => candidate.method === "mercado_pago");
    if (!method?.enabled) reasons.push("payment_method_disabled");
  }

  if (!isPaymentPersistenceConfigured(environment)) reasons.push("persistence");

  // Same requirement as the route's limiter: distributed quota whenever running in production.
  if (rateLimitBackendKind({ requireDistributed: environment.NODE_ENV === "production" }, environment) === "unavailable") {
    reasons.push("rate_limit_backend");
  }

  return detection.enabled && reasons.length === 0 ? { available: true, config: detection.config } : { available: false, reasons };
}
