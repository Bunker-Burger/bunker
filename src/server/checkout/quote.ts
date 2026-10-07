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

  const groupsById = new Map(product.optionGroups.map((group) => [group.id, group]));
  for (const groupId of Object.keys(item.optionSelections)) {
    if (!groupsById.has(groupId)) throw new Error(`Grupo de opción inválido: ${groupId}`);
  }

  const selectedOptions: QuoteLine["selectedOptions"] = [];
  let unitPriceCents = requireNonNegativeAmount(product.priceCents, "Precio del producto");

  for (const group of product.optionGroups) {
    const selection = [...new Set(item.optionSelections[group.id] ?? [])];
    if (selection.length < group.minSelections || selection.length > group.maxSelections) {
      throw new Error(`Cantidad de opciones inválida para ${group.id}`);
    }
    const optionsById = new Map(group.options.map((option) => [option.id, option]));
    for (const optionId of selection) {
      const option = optionsById.get(optionId);
      if (!option?.available) throw new Error(`Opción inválida o no disponible: ${optionId}`);
      unitPriceCents += requireNonNegativeAmount(option.priceDeltaCents, "Ajuste de opción");
      selectedOptions.push({ groupId: group.id, optionId: option.id, optionName: option.name });
    }
  }

  return {
    productId: product.id,
    productName: product.name,
    quantity: item.quantity,
    unitPriceCents,
    selectedOptions,
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
