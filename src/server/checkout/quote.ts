import { validateOptionSelection } from "@/domain/options";
import { quoteCart } from "@/domain/pricing";
import { deliveryChargeCents, type StoreStatus } from "@/domain/store-status";
import type { CheckoutRequest } from "./schema";
import type {
  AuthoritativeProduct,
  PaymentQuote,
  PaymentQuotesPort,
  PricingRepository,
  QuoteLine
} from "../payments/ports";

interface PricingDependencies {
  repository: PricingRepository;
  /** Authoritative store status; the only source of the delivery fee. */
  storeStatus(): Promise<StoreStatus>;
  now(): Date;
}

interface QuoteDependencies extends PricingDependencies {
  quotes: PaymentQuotesPort;
  createId(): string;
}

/** Totals of a checkout as the server prices it; nothing is saved. */
export type CheckoutPricing = Omit<PaymentQuote, "id" | "expiresAt">;

/** The cart names a product or option the catalog does not offer as requested right now. */
export class InvalidCheckoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCheckoutError";
  }
}

function priceLine(
  item: CheckoutRequest["items"][number],
  product: AuthoritativeProduct
): QuoteLine {
  if (!product.available) throw new InvalidCheckoutError(`Producto no disponible: ${item.productId}`);

  const validation = validateOptionSelection(product, item.optionSelections);
  if (!validation.ok) {
    const first = validation.error[0]!;
    throw new InvalidCheckoutError(`Opción inválida: ${first.message}`);
  }

  return {
    productId: product.id,
    productName: product.name,
    quantity: item.quantity,
    unitPriceCents: validation.value.unitPriceCents,
    basePriceCents: product.priceCents,
    selectedOptions: validation.value.selectedDetails.map((detail) => ({
      groupId: detail.groupId,
      optionId: detail.optionId,
      optionName: detail.optionName
    })),
    notes: item.notes
  };
}

/**
 * Prices a checkout from authoritative data only: store status (closed, paused or without a
 * delivery fee throws `StoreNotAcceptingOrdersError`), persisted products, options and promotions.
 */
export async function priceCheckout(checkout: CheckoutRequest, dependencies: PricingDependencies): Promise<CheckoutPricing> {
  // Closed, paused or without a delivery fee: no quote, so nothing can be paid or sent.
  const status = await dependencies.storeStatus();
  const deliveryCents = deliveryChargeCents(status, checkout.fulfilment);
  const lines: QuoteLine[] = [];
  for (const item of checkout.items) {
    const product = await dependencies.repository.findProduct(item.productId);
    if (!product) throw new InvalidCheckoutError(`Producto inexistente: ${item.productId}`);
    lines.push(priceLine(item, product));
  }

  // One promotion at most, chosen and computed here from the persisted rules; nothing the
  // browser sends (prices, totals, promotion ids) takes part in it.
  const totals = quoteCart(lines, await dependencies.repository.listPromotions(), checkout.fulfilment, deliveryCents, {
    now: dependencies.now(),
    timezone: status.timezone
  });
  return { lines, ...totals };
}

/** Prices a checkout (see `priceCheckout`) and freezes it as a saved quote for online payment. */
export async function createAuthoritativeQuote(
  checkout: CheckoutRequest,
  dependencies: QuoteDependencies
): Promise<PaymentQuote> {
  const now = dependencies.now();
  const pricing = await priceCheckout(checkout, { ...dependencies, now: () => now });
  const quote: PaymentQuote = {
    id: dependencies.createId(),
    ...pricing,
    expiresAt: new Date(now.getTime() + 15 * 60_000)
  };
  await dependencies.quotes.save(quote);
  return quote;
}
