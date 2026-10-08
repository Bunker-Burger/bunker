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

interface QuoteDependencies {
  repository: PricingRepository;
  quotes: PaymentQuotesPort;
  /** Authoritative store status; the only source of the delivery fee. */
  storeStatus(): Promise<StoreStatus>;
  createId(): string;
  now(): Date;
}

function priceLine(
  item: CheckoutRequest["items"][number],
  product: AuthoritativeProduct
): QuoteLine {
  if (!product.available) throw new Error(`Producto no disponible: ${item.productId}`);

  const validation = validateOptionSelection(product, item.optionSelections);
  if (!validation.ok) {
    const first = validation.error[0]!;
    throw new Error(`Opción inválida: ${first.message}`);
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

export async function createAuthoritativeQuote(
  checkout: CheckoutRequest,
  dependencies: QuoteDependencies
): Promise<PaymentQuote> {
  // Closed, paused or without a delivery fee: no quote, so nothing can be paid or sent.
  const status = await dependencies.storeStatus();
  const deliveryCents = deliveryChargeCents(status, checkout.fulfilment);
  const lines: QuoteLine[] = [];
  for (const item of checkout.items) {
    const product = await dependencies.repository.findProduct(item.productId);
    if (!product) throw new Error(`Producto inexistente: ${item.productId}`);
    lines.push(priceLine(item, product));
  }

  // One promotion at most, chosen and computed here from the persisted rules; nothing the
  // browser sends (prices, totals, promotion ids) takes part in it.
  const now = dependencies.now();
  const totals = quoteCart(lines, await dependencies.repository.listPromotions(), checkout.fulfilment, deliveryCents, {
    now,
    timezone: status.timezone
  });
  const quote: PaymentQuote = {
    id: dependencies.createId(),
    lines,
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountCents,
    deliveryCents: totals.deliveryCents,
    totalCents: totals.totalCents,
    promotion: totals.promotion,
    expiresAt: new Date(now.getTime() + 15 * 60_000)
  };
  await dependencies.quotes.save(quote);
  return quote;
}
