import type { CartLine, FulfilmentMethod, Promotion, Quote } from "./types";

function isPromotionEligible(lines: CartLine[], promotion: Promotion, now: Date): boolean {
  if (!promotion.active) return false;
  if (promotion.startsAt && now < new Date(promotion.startsAt)) return false;
  if (promotion.endsAt && now > new Date(promotion.endsAt)) return false;
  if (!promotion.productIds?.length) return lines.length > 0;
  return lines.some((line) => promotion.productIds?.includes(line.productId));
}

export function choosePromotion(
  lines: CartLine[],
  promotions: Promotion[],
  now = new Date()
): Promotion | null {
  return promotions
    .filter((promotion) => isPromotionEligible(lines, promotion, now))
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))[0] ?? null;
}

export function quoteCart(
  lines: CartLine[],
  promotions: Promotion[],
  fulfilment: FulfilmentMethod,
  deliveryFeeCents: bigint,
  now = new Date()
): Quote {
  const subtotalCents = lines.reduce(
    (total, line) => total + line.unitPriceCents * BigInt(line.quantity),
    0n
  );
  const promotion = choosePromotion(lines, promotions, now);
  const rawDiscount = promotion?.kind === "percentage"
    ? subtotalCents * BigInt(Math.max(0, Math.min(100, Math.trunc(promotion.value)))) / 100n
    : BigInt(Math.max(0, Math.trunc(promotion?.value ?? 0)));
  const discountCents = rawDiscount > subtotalCents ? subtotalCents : rawDiscount;
  const deliveryCents = fulfilment === "delivery" ? deliveryFeeCents : 0n;

  return {
    subtotalCents,
    discountCents,
    deliveryCents,
    totalCents: subtotalCents - discountCents + deliveryCents,
    promotion
  };
}

