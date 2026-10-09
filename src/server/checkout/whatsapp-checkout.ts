import { StoreNotAcceptingOrdersError, type StoreStatus } from "@/domain/store-status";
import type { Catalog, PaymentMethodKind } from "@/domain/types";
import { err, ok, type Result } from "@/lib/result";
import type { CatalogError } from "@/server/catalog/errors";
import type { PricingRepository } from "@/server/payments/ports";
import { InvalidCheckoutError, priceCheckout, type CheckoutPricing } from "./quote";
import { untrustedCheckoutSchema } from "./schema";
import { buildExactCashWhatsAppUrl, buildTransferWhatsAppUrl } from "./whatsapp";

export type WhatsAppCheckoutErrorCode =
  | "invalid_request"
  | "store_closed"
  | "invalid_cart"
  | "payment_method_unavailable"
  | "unavailable";

export interface WhatsAppCheckoutError {
  code: WhatsAppCheckoutErrorCode;
  message: string;
}

export interface WhatsAppCheckout {
  url: string;
  pricing: CheckoutPricing;
}

export interface WhatsAppCheckoutDependencies {
  /** Fresh (uncached) public catalog: store settings, published products and promotions. */
  loadCatalog(): Promise<Result<Catalog, CatalogError>>;
  /** Fresh store status; closed, paused or without a delivery fee refuses the order. */
  loadStoreStatus(): Promise<Result<StoreStatus, CatalogError>>;
  now(): Date;
}

const PAYMENT_KINDS = { cash_exact: "cash", transfer: "bank_transfer" } as const satisfies Record<string, PaymentMethodKind>;

function failure(code: WhatsAppCheckoutErrorCode, message: string) {
  return err<WhatsAppCheckoutError>({ code, message });
}

/** Prices against the catalog as read now: unpublished or unknown products are not found. */
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
 * Cash or transfer checkout, finished in the owner's WhatsApp chat. Nothing is persisted: the
 * total, lines, promotion and fee are recomputed here from fresh data on every request, and only
 * then turned into the `wa.me` link. The browser contributes product ids, option ids, quantities,
 * notes, fulfilment and payment method; never prices, totals or promotions.
 */
export async function prepareWhatsAppCheckout(
  input: unknown,
  dependencies: WhatsAppCheckoutDependencies
): Promise<Result<WhatsAppCheckout, WhatsAppCheckoutError>> {
  const parsed = untrustedCheckoutSchema.safeParse(input);
  if (!parsed.success) return failure("invalid_request", "El pedido no tiene un formato válido.");
  const checkout = parsed.data;
  if (checkout.paymentMethod === "mercado_pago" || checkout.customer) {
    return failure("invalid_request", "WhatsApp solo admite efectivo o transferencia, sin datos personales.");
  }

  const [catalog, status] = await Promise.all([dependencies.loadCatalog(), dependencies.loadStoreStatus()]);
  if (!catalog.ok || !status.ok) return failure("unavailable", "No pudimos verificar el pedido con el local.");

  const kind = PAYMENT_KINDS[checkout.paymentMethod];
  if (!catalog.value.store.paymentMethods.some((method) => method.method === kind && method.enabled)) {
    return failure("payment_method_unavailable", "Ese método de pago no está habilitado.");
  }

  let pricing: CheckoutPricing;
  try {
    pricing = await priceCheckout(checkout, {
      repository: catalogPricing(catalog.value),
      storeStatus: async () => status.value,
      now: dependencies.now
    });
  } catch (error) {
    if (error instanceof StoreNotAcceptingOrdersError) return failure("store_closed", "El local no está tomando pedidos ahora.");
    if (error instanceof InvalidCheckoutError) return failure("invalid_cart", error.message);
    throw error;
  }

  const order = { businessPhone: catalog.value.store.whatsappE164, fulfilment: checkout.fulfilment, pricing };
  const url = checkout.paymentMethod === "cash_exact" ? buildExactCashWhatsAppUrl(order) : buildTransferWhatsAppUrl(order);
  return ok({ url, pricing });
}

const STATUS_BY_CODE: Record<WhatsAppCheckoutErrorCode, number> = {
  invalid_request: 400,
  store_closed: 409,
  invalid_cart: 422,
  payment_method_unavailable: 422,
  unavailable: 503
};

/** Amounts travel as strings of cents (bigint); never cached, the answer depends on the moment. */
export function whatsAppCheckoutResponse(result: Result<WhatsAppCheckout, WhatsAppCheckoutError>): Response {
  const headers = { "Cache-Control": "no-store" };
  if (!result.ok) return Response.json({ error: result.error.code }, { status: STATUS_BY_CODE[result.error.code], headers });
  const { url, pricing } = result.value;
  return Response.json(
    {
      url,
      subtotalCents: pricing.subtotalCents.toString(),
      discountCents: pricing.discountCents.toString(),
      deliveryCents: pricing.deliveryCents.toString(),
      totalCents: pricing.totalCents.toString(),
      promotion: pricing.promotion ? { name: pricing.promotion.name, explanation: pricing.promotion.explanation } : null
    },
    { headers }
  );
}
