import { StoreNotAcceptingOrdersError, type StoreStatus } from "@/domain/store-status";
import type { Catalog } from "@/domain/types";
import { err, ok, type Result } from "@/lib/result";
import type { CatalogError } from "@/server/catalog/errors";
import {
  createCheckoutProPreference,
  detectMercadoPagoConfig,
  type MercadoPagoConfigDetection
} from "@/server/payments/mercado-pago";
import type {
  PaymentAttemptsPort,
  PaymentQuote,
  PaymentQuotesPort,
  PricingRepository
} from "@/server/payments/ports";
import { createAuthoritativeQuote, InvalidCheckoutError } from "./quote";
import {
  deriveLogicalCheckoutIdempotencyKey,
  deriveRotatedCheckoutIdempotencyKey,
  untrustedCheckoutSchema
} from "./schema";

export type MercadoPagoCheckoutErrorCode =
  | "invalid_request"
  | "store_closed"
  | "invalid_cart"
  | "payment_method_unavailable"
  | "unavailable";

export interface MercadoPagoCheckoutError {
  code: MercadoPagoCheckoutErrorCode;
  message: string;
}

export interface MercadoPagoCheckoutSuccess {
  preferenceId: string;
  checkoutUrl: string;
  externalReference: string;
  quote: PaymentQuote;
}

export interface MercadoPagoCheckoutDependencies {
  detectConfig?(): MercadoPagoConfigDetection;
  loadCatalog(): Promise<Result<Catalog, CatalogError>>;
  loadStoreStatus(): Promise<Result<StoreStatus, CatalogError>>;
  quotes: PaymentQuotesPort;
  attempts: PaymentAttemptsPort;
  fetcher?: typeof fetch;
  createId(): string;
  now(): Date;
}

function failure(code: MercadoPagoCheckoutErrorCode, message: string) {
  return err<MercadoPagoCheckoutError>({ code, message });
}

function catalogPricing(catalog: Catalog): PricingRepository {
  return {
    async findProduct(productId) {
      const product = catalog.products.find((candidate) => candidate.id === productId);
      return product ? { ...product, available: product.inStock } : null;
    },
    async listPromotions() {
      return catalog.promotions;
    }
  };
}

/**
 * Creates an authoritative Mercado Pago Checkout Pro preference.
 * Recalculates product prices, options, promotions, and delivery fee on the server;
 * browser prices are never trusted. Stores frozen quote and pending attempt.
 */
const inFlightCheckouts = new Map<
  string,
  Promise<Result<MercadoPagoCheckoutSuccess, MercadoPagoCheckoutError>>
>();

export async function prepareMercadoPagoCheckout(
  input: unknown,
  dependencies: MercadoPagoCheckoutDependencies
): Promise<Result<MercadoPagoCheckoutSuccess, MercadoPagoCheckoutError>> {
  const detectConfig = dependencies.detectConfig ?? detectMercadoPagoConfig;
  const mpDetection = detectConfig();
  if (!mpDetection.enabled) {
    return failure("payment_method_unavailable", "Mercado Pago no está disponible temporalmente.");
  }

  const parsed = untrustedCheckoutSchema.safeParse(input);
  if (!parsed.success) {
    return failure("invalid_request", "El pedido no tiene un formato válido.");
  }

  const checkout = parsed.data;
  if (checkout.paymentMethod !== "mercado_pago" || !checkout.customer) {
    return failure("invalid_request", "Mercado Pago requiere nombre y teléfono de contacto.");
  }

  const [catalog, status] = await Promise.all([
    dependencies.loadCatalog(),
    dependencies.loadStoreStatus()
  ]);
  if (!catalog.ok || !status.ok) {
    return failure("unavailable", "No pudimos verificar el pedido con el local.");
  }

  const mpMethod = catalog.value.store.paymentMethods.find((m) => m.method === "mercado_pago");
  if (!mpMethod || !mpMethod.enabled) {
    return failure("payment_method_unavailable", "Mercado Pago no está habilitado en este local.");
  }

  const customer = checkout.customer;
  const initialIdempotencyKey = deriveLogicalCheckoutIdempotencyKey(checkout, checkout.intentNonce);

  // P2-09: Deduplicación atómica en memoria para carreras concurrentes (síncrona antes de cualquier await)
  const inFlight = inFlightCheckouts.get(initialIdempotencyKey);
  if (inFlight) {
    return inFlight;
  }

  const executionPromise: Promise<Result<MercadoPagoCheckoutSuccess, MercadoPagoCheckoutError>> = (async () => {
    let quote: PaymentQuote;
    try {
      quote = await createAuthoritativeQuote(checkout, {
        repository: catalogPricing(catalog.value),
        quotes: dependencies.quotes,
        storeStatus: async () => status.value,
        createId: dependencies.createId,
        now: dependencies.now
      });
    } catch (error) {
      if (error instanceof StoreNotAcceptingOrdersError) {
        return failure("store_closed", "El local no está tomando pedidos ahora.");
      }
      if (error instanceof InvalidCheckoutError) {
        return failure("invalid_cart", error.message);
      }
      return failure("unavailable", "No pudimos guardar la cotización del pedido.");
    }

    let effectiveIdempotencyKey = initialIdempotencyKey;

    // P1-10: Resolver la clave de idempotencia efectiva rotando deterministamente por generaciones.
    // Si una generación anterior terminó (status === 'approved' | 'rejected' | 'expired'),
    // su cotización venció (>15 min) o cambió el precio/tarifa:
    // Se avanza a la siguiente generación (gen + 1).
    // Un reintento de la nueva compra (mismo intent/nonce) recuperará la MISMA generación activa
    // y reutilizará su preferencia sin crear llamadas remotas duplicadas.
    if (dependencies.attempts.findByIdempotencyKey) {
      const MAX_ROTATIONS = 20;
      for (let gen = 1; gen <= MAX_ROTATIONS; gen++) {
        const candidateKey = deriveRotatedCheckoutIdempotencyKey(initialIdempotencyKey, gen);
        const existingAttempt = await dependencies.attempts.findByIdempotencyKey(candidateKey);
        if (!existingAttempt) {
          // Primera generación sin intento previo: esta es la clave para la nueva compra
          effectiveIdempotencyKey = candidateKey;
          break;
        }

        const isPending = existingAttempt.status === "pending";
        const hasPreference = Boolean(existingAttempt.providerPreferenceId);
        const matchesAmount = existingAttempt.expectedAmountCents === quote.totalCents;
        let isUnexpired = false;
        let existingQuote: PaymentQuote | null = null;
        if (existingAttempt.quoteId) {
          existingQuote = await dependencies.quotes.findById(existingAttempt.quoteId);
          isUnexpired = Boolean(existingQuote && existingQuote.expiresAt.getTime() > dependencies.now().getTime());
        }

        if (isPending && matchesAmount && isUnexpired && existingQuote) {
          if (hasPreference) {
            // Reintento idéntico vigente (pérdida de respuesta, timeout o reintento de cliente):
            // Reutilizar la misma preferencia y cotización autoritativa sin invocar MP nuevamente
            return ok({
              preferenceId: existingAttempt.providerPreferenceId!,
              checkoutUrl: `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=${existingAttempt.providerPreferenceId}`,
              externalReference: existingAttempt.externalReference,
              quote: existingQuote
            });
          }
          // Intento en curso o reintento tras timeout sin preference_id:
          // Mantener la clave de esta generación para que MP procese el reintento idempotentemente
          effectiveIdempotencyKey = candidateKey;
          break;
        }

        // Si el intento previo de esta generación terminó o expiró, continuamos a la siguiente generación
      }
    }

    let preference: { preferenceId: string; checkoutUrl: string; externalReference: string };
    try {
      preference = await createCheckoutProPreference(
        {
          quote: { id: quote.id, totalCents: quote.totalCents, expiresAt: quote.expiresAt },
          customer: { name: customer.name, phone: customer.phone },
          idempotencyKey: effectiveIdempotencyKey
        },
        {
          config: mpDetection.config,
          fetcher: dependencies.fetcher ?? fetch,
          attempts: dependencies.attempts,
          storeStatus: async () => status.value,
          createId: dependencies.createId,
          now: dependencies.now
        }
      );
    } catch {
      return failure("unavailable", "No pudimos generar el pago con Mercado Pago.");
    }

    return ok({
      preferenceId: preference.preferenceId,
      checkoutUrl: preference.checkoutUrl,
      externalReference: preference.externalReference,
      quote
    });
  })();

  inFlightCheckouts.set(initialIdempotencyKey, executionPromise);
  try {
    return await executionPromise;
  } finally {
    inFlightCheckouts.delete(initialIdempotencyKey);
  }
}

const STATUS_BY_CODE: Record<MercadoPagoCheckoutErrorCode, number> = {
  invalid_request: 400,
  store_closed: 409,
  invalid_cart: 422,
  payment_method_unavailable: 422,
  unavailable: 503
};

export function mercadoPagoCheckoutResponse(
  result: Result<MercadoPagoCheckoutSuccess, MercadoPagoCheckoutError>
): Response {
  const headers = { "Cache-Control": "no-store" };
  if (!result.ok) {
    const status =
      result.error.code === "payment_method_unavailable" &&
      result.error.message.includes("no está disponible")
        ? 503
        : STATUS_BY_CODE[result.error.code] ?? 400;

    return Response.json(
      { error: result.error.code, message: result.error.message },
      { status, headers }
    );
  }

  const { preferenceId, checkoutUrl, externalReference, quote } = result.value;
  return Response.json(
    {
      preferenceId,
      checkoutUrl,
      externalReference,
      expiresAt: quote.expiresAt.toISOString(),
      subtotalCents: quote.subtotalCents.toString(),
      discountCents: quote.discountCents.toString(),
      deliveryCents: quote.deliveryCents.toString(),
      totalCents: quote.totalCents.toString(),
      promotion: quote.promotion
        ? { name: quote.promotion.name, explanation: quote.promotion.explanation }
        : null
    },
    { headers }
  );
}
