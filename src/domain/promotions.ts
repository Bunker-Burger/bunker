import { formatArs } from "@/lib/money";
import { localWallClock, wallClockSeconds } from "./store-status";
import type { FulfilmentMethod, PromotionMechanic, PromotionRule, PromotionWindow } from "./types";

/*
 * Promotion engine, shared by the browser (estimate) and the server (authoritative quote).
 *
 * - A rule is in effect when it is active (not paused), `startsAt <= now < endsAt`, and — if it
 *   has weekly windows — the store-local time falls inside one of them.
 * - Exactly one promotion applies to an order: among the rules in effect that give this order a
 *   discount, the highest `priority` wins; ties break by `id` so the choice is stable.
 * - Amounts come only from the lines the server priced and the rule's own parameters. There are
 *   no usage quotas, counters or per-unit caps.
 *
 * Mechanics (`items` are the rule's `promotion_items`):
 * - percent_off: % of the price paid for the listed products (every product when `items` is empty).
 * - fixed_price: combo; each complete set of `items` (product × quantity) costs `fixedPriceCents`
 *   instead of the products' base prices. Option surcharges are still charged.
 * - buy_x_get_y: per `buy + get` eligible units, the `get` cheapest are free (base price).
 * - free_delivery: the delivery fee is waived (delivery orders only).
 */

export interface PromotionLine {
  productId: string;
  quantity: number;
  /** Price of one configured unit (base + options), as priced by the server. */
  unitPriceCents: bigint;
  /** Product base price, without option surcharges. */
  basePriceCents: bigint;
}

export interface PromotionContext {
  now: Date;
  /** Store time zone (IANA), for weekly windows. */
  timezone: string;
  fulfilment: FulfilmentMethod;
  /** Delivery fee charged to this order (0 for pickup). */
  deliveryCents: bigint;
}

export interface PromotionDiscount {
  productDiscountCents: bigint;
  deliveryDiscountCents: bigint;
}

export interface AppliedPromotion extends PromotionDiscount {
  promotionId: string;
  slug: string;
  name: string;
  badgeText: string | null;
  /** Generated from the mechanic; never admin free text. */
  explanation: string;
}

const NO_DISCOUNT: PromotionDiscount = { productDiscountCents: 0n, deliveryDiscountCents: 0n };

function inWindow(window: PromotionWindow, dayOfWeek: number, seconds: number): boolean {
  const start = wallClockSeconds(window.startsAt);
  const end = wallClockSeconds(window.endsAt);
  if (end > start) return window.dayOfWeek === dayOfWeek && seconds >= start && seconds < end;
  // Crosses midnight: from `start` on its day until `end` the next day.
  return (window.dayOfWeek === dayOfWeek && seconds >= start) || ((window.dayOfWeek + 1) % 7 === dayOfWeek && seconds < end);
}

/** Active (not paused), inside its date range and, if it has weekly windows, inside one now. */
export function isPromotionInEffect(rule: PromotionRule, now: Date, timezone: string): boolean {
  if (!rule.active) return false;
  if (now < rule.startsAt || now >= rule.endsAt) return false;
  if (rule.schedule.length === 0) return true;
  const { dayOfWeek, seconds } = localWallClock(now, timezone);
  return rule.schedule.some((window) => inWindow(window, dayOfWeek, seconds));
}

function assertValidLine(line: PromotionLine) {
  if (!Number.isInteger(line.quantity) || line.quantity < 1) throw new RangeError(`Invalid quantity for ${line.productId}`);
  if (line.unitPriceCents < 0n || line.basePriceCents < 0n || line.basePriceCents > line.unitPriceCents) {
    throw new RangeError(`Invalid prices for ${line.productId}`);
  }
}

/** Percent as basis points, so 12.5% stays exact with integer math. */
const basisPoints = (percent: number) => BigInt(Math.round(percent * 100));

function eligibleLines(rule: PromotionRule, lines: readonly PromotionLine[]) {
  if (rule.items.length === 0) return lines;
  const ids = new Set(rule.items.map((item) => item.productId));
  return lines.filter((line) => ids.has(line.productId));
}

function productDiscount(mechanic: PromotionMechanic, rule: PromotionRule, lines: readonly PromotionLine[]): bigint {
  switch (mechanic.type) {
    case "percent_off": {
      const amount = eligibleLines(rule, lines).reduce((total, line) => total + line.unitPriceCents * BigInt(line.quantity), 0n);
      return (amount * basisPoints(mechanic.percentOff)) / 10_000n;
    }
    case "fixed_price": {
      if (rule.items.length === 0) return 0n;
      let sets = Number.POSITIVE_INFINITY;
      let regular = 0n;
      for (const item of rule.items) {
        const matching = lines.filter((line) => line.productId === item.productId);
        const units = matching.reduce((total, line) => total + line.quantity, 0);
        sets = Math.min(sets, Math.floor(units / item.quantity));
        if (matching[0]) regular += matching[0].basePriceCents * BigInt(item.quantity);
      }
      if (!Number.isFinite(sets) || sets === 0) return 0n;
      const perSet = regular - mechanic.fixedPriceCents;
      return perSet > 0n ? perSet * BigInt(sets) : 0n;
    }
    case "buy_x_get_y": {
      const units = eligibleLines(rule, lines)
        .flatMap((line) => Array.from({ length: line.quantity }, () => line.basePriceCents))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const groupSize = mechanic.buyQuantity + mechanic.getQuantity;
      const free = Math.floor(units.length / groupSize) * mechanic.getQuantity;
      return units.slice(0, free).reduce((total, price) => total + price, 0n);
    }
    case "free_delivery":
      return 0n;
  }
}

/** What this rule would take off this order, regardless of whether it is in effect. */
export function promotionDiscount(rule: PromotionRule, lines: readonly PromotionLine[], context: PromotionContext): PromotionDiscount {
  lines.forEach(assertValidLine);
  if (lines.length === 0 || !rule.channels.includes(context.fulfilment)) return NO_DISCOUNT;
  if (rule.mechanic.type === "free_delivery") {
    return context.fulfilment === "delivery" ? { productDiscountCents: 0n, deliveryDiscountCents: context.deliveryCents } : NO_DISCOUNT;
  }
  const subtotal = lines.reduce((total, line) => total + line.unitPriceCents * BigInt(line.quantity), 0n);
  const discount = productDiscount(rule.mechanic, rule, lines);
  return { productDiscountCents: discount > subtotal ? subtotal : discount, deliveryDiscountCents: 0n };
}

function formatPercent(percent: number) {
  return `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(percent)}%`;
}

/** Customer-facing explanation built from the mechanic's parameters only. */
export function explainPromotion(rule: Pick<PromotionRule, "mechanic" | "items">): string {
  const scope = rule.items.length === 0 ? "en todo el pedido" : "en productos seleccionados";
  switch (rule.mechanic.type) {
    case "percent_off":
      return `${formatPercent(rule.mechanic.percentOff)} de descuento ${scope}`;
    case "fixed_price":
      return `Combo a ${formatArs(rule.mechanic.fixedPriceCents)}`;
    case "buy_x_get_y":
      return `Llevá ${rule.mechanic.buyQuantity + rule.mechanic.getQuantity}, pagá ${rule.mechanic.buyQuantity} ${scope}`;
    case "free_delivery":
      return "Envío gratis";
  }
}

const byPriority = (a: PromotionRule, b: PromotionRule) => b.priority - a.priority || a.id.localeCompare(b.id);

/**
 * The single promotion for this order: highest priority among the rules in effect that give
 * it a discount (ties by id). Promotions never stack.
 */
export function selectPromotion(
  rules: readonly PromotionRule[],
  lines: readonly PromotionLine[],
  context: PromotionContext
): AppliedPromotion | null {
  for (const rule of [...rules].sort(byPriority)) {
    if (!isPromotionInEffect(rule, context.now, context.timezone)) continue;
    const discount = promotionDiscount(rule, lines, context);
    if (discount.productDiscountCents === 0n && discount.deliveryDiscountCents === 0n) continue;
    return {
      promotionId: rule.id,
      slug: rule.slug,
      name: rule.name,
      badgeText: rule.badgeText,
      explanation: explainPromotion(rule),
      ...discount
    };
  }
  return null;
}

export interface PromotionalPrice {
  priceCents: bigint;
  /** The real price, shown struck through. */
  compareAtPriceCents: bigint;
  promotionName: string;
  explanation: string;
}

/**
 * Struck-through price for a product card: what one unit costs alone under the promotion that
 * would apply to it (any channel the rule allows), computed from the real base price.
 * Null when no promotion lowers a single unit of it.
 */
export function promotionalPrice(
  product: { id: string; priceCents: bigint },
  rules: readonly PromotionRule[],
  now: Date,
  timezone: string
): PromotionalPrice | null {
  const line: PromotionLine = { productId: product.id, quantity: 1, unitPriceCents: product.priceCents, basePriceCents: product.priceCents };
  for (const rule of [...rules].sort(byPriority)) {
    if (!isPromotionInEffect(rule, now, timezone)) continue;
    const fulfilment = rule.channels[0];
    if (!fulfilment || rule.mechanic.type === "free_delivery") continue;
    const discount = promotionDiscount(rule, [line], { now, timezone, fulfilment, deliveryCents: 0n }).productDiscountCents;
    if (discount === 0n) continue;
    return {
      priceCents: product.priceCents - discount,
      compareAtPriceCents: product.priceCents,
      promotionName: rule.name,
      explanation: explainPromotion(rule)
    };
  }
  return null;
}
