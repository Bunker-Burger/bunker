import { selectPromotion, type AppliedPromotion, type PromotionLine } from "./promotions";
import type { FulfilmentMethod, PromotionRule } from "./types";

export interface Quote {
  subtotalCents: bigint;
  /** Product discount plus any waived delivery fee of the single applied promotion. */
  discountCents: bigint;
  deliveryCents: bigint;
  totalCents: bigint;
  promotion: AppliedPromotion | null;
}

/**
 * Totals for priced lines: the fixed delivery fee once (delivery only) and at most one
 * promotion. The server uses it for the authoritative quote; the browser only for an estimate.
 */
export function quoteCart(
  lines: readonly PromotionLine[],
  rules: readonly PromotionRule[],
  fulfilment: FulfilmentMethod,
  deliveryFeeCents: bigint,
  context: { now: Date; timezone: string }
): Quote {
  const subtotalCents = lines.reduce((total, line) => total + line.unitPriceCents * BigInt(line.quantity), 0n);
  const deliveryCents = fulfilment === "delivery" ? deliveryFeeCents : 0n;
  const promotion = selectPromotion(rules, lines, { ...context, fulfilment, deliveryCents });
  const discountCents = promotion ? promotion.productDiscountCents + promotion.deliveryDiscountCents : 0n;
  return {
    subtotalCents,
    discountCents,
    deliveryCents,
    totalCents: subtotalCents + deliveryCents - discountCents,
    promotion
  };
}
