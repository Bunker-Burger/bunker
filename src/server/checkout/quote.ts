import { validateOptionSelection } from "@/domain/options";
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
  createId(): string;
  now(): Date;
}

function requireNonNegativeAmount(amount: bigint, label: string): bigint {
  if (amount < 0n) throw new Error(`${label} no puede ser negativo`);
  return amount;
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
  const lines: QuoteLine[] = [];
  for (const item of checkout.items) {
    const product = await dependencies.repository.findProduct(item.productId);
    if (!product) throw new Error(`Producto inexistente: ${item.productId}`);
    lines.push(priceLine(item, product));
  }

  const subtotalCents = lines.reduce(
    (total, line) => total + line.unitPriceCents * BigInt(line.quantity),
    0n
  );
  const rawDiscount = requireNonNegativeAmount(
    await dependencies.repository.getApplicableDiscountCents(lines, dependencies.now()),
    "Descuento"
  );
  const discountCents = rawDiscount > subtotalCents ? subtotalCents : rawDiscount;
  const deliveryCents = checkout.fulfilment === "delivery"
    ? requireNonNegativeAmount(await dependencies.repository.getDeliveryFeeCents(), "Envío")
    : 0n;
  const now = dependencies.now();
  const quote: PaymentQuote = {
    id: dependencies.createId(),
    lines,
    subtotalCents,
    discountCents,
    deliveryCents,
    totalCents: subtotalCents - discountCents + deliveryCents,
    expiresAt: new Date(now.getTime() + 15 * 60_000)
  };
  await dependencies.quotes.save(quote);
  return quote;
}
