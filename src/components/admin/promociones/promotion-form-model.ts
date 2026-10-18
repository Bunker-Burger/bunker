import { promotionDiscount, type PromotionLine } from "@/domain/promotions";
import type { FulfilmentMethod, PromotionMechanic, PromotionRule } from "@/domain/types";
import type { PromotionFormProduct, PromotionFormValues } from "./promotion-form";

export const WEEKDAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
export const TYPES: Array<{ value: PromotionMechanic["type"]; label: string }> = [
  { value: "fixed_price", label: "Combo fijo" },
  { value: "percent_off", label: "% Descuento" },
  { value: "buy_x_get_y", label: "Llevá X, pagá Y" },
  { value: "free_delivery", label: "Envío gratis" }
];

/** Pesos as typed ("7800" or "7800.5") → cents, or null. */
export function cents(value: string): bigint | null {
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(value.trim());
  return match ? BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0")) : null;
}

export function mechanicFrom(values: Pick<PromotionFormValues, "type" | "percentOff" | "fixedPrice" | "buyQuantity" | "getQuantity">): PromotionMechanic | null {
  switch (values.type) {
    case "percent_off": {
      const percent = Number(values.percentOff);
      return values.percentOff.trim() !== "" && percent > 0 && percent <= 100 ? { type: "percent_off", percentOff: percent } : null;
    }
    case "fixed_price": {
      const price = cents(values.fixedPrice);
      return price && price > 0n ? { type: "fixed_price", fixedPriceCents: price } : null;
    }
    case "buy_x_get_y": {
      const buy = Number(values.buyQuantity);
      const get = Number(values.getQuantity);
      return Number.isInteger(buy) && Number.isInteger(get) && buy >= 1 && get >= 1 ? { type: "buy_x_get_y", buyQuantity: buy, getQuantity: get } : null;
    }
    case "free_delivery":
      return { type: "free_delivery" };
  }
}

export interface PreviewRow {
  label: string;
  normalCents: bigint;
  promoCents: bigint;
}

/** Derived prices from the same engine that discounts the real quote (dates and windows aside). */
export function previewRows(
  mechanic: PromotionMechanic,
  channels: FulfilmentMethod[],
  items: Array<{ productId: string; quantity: number }>,
  products: PromotionFormProduct[],
  deliveryFeeCents: bigint | null
): PreviewRow[] {
  const byId = new Map(products.map((product) => [product.id, product]));
  const fulfilment: FulfilmentMethod = mechanic.type === "free_delivery" || !channels.includes("pickup") ? "delivery" : "pickup";
  const rule: PromotionRule = {
    id: "preview",
    slug: "preview",
    name: "Vista previa",
    description: "",
    badgeText: null,
    priority: 0,
    active: true,
    startsAt: new Date(0),
    endsAt: new Date(8.64e15),
    mechanic,
    channels,
    items,
    schedule: []
  };
  const context = { now: new Date(), timezone: "UTC", fulfilment, deliveryCents: fulfilment === "delivery" ? (deliveryFeeCents ?? 0n) : 0n };
  const line = (productId: string, quantity: number): PromotionLine | null => {
    const product = byId.get(productId);
    if (!product) return null;
    const price = BigInt(product.priceCents);
    return { productId, quantity, unitPriceCents: price, basePriceCents: price, comboId: rule.id };
  };
  const total = (lines: PromotionLine[]) => lines.reduce((sum, current) => sum + current.unitPriceCents * BigInt(current.quantity), 0n);

  if (mechanic.type === "free_delivery") {
    if (deliveryFeeCents === null) return [];
    const discount = promotionDiscount(rule, [{ productId: "any", quantity: 1, unitPriceCents: 0n, basePriceCents: 0n }], context);
    return [{ label: "Envío a domicilio", normalCents: deliveryFeeCents, promoCents: deliveryFeeCents - discount.deliveryDiscountCents }];
  }
  if (mechanic.type === "fixed_price") {
    const lines = items.map((item) => line(item.productId, item.quantity)).filter((value): value is PromotionLine => value !== null);
    if (lines.length === 0) return [];
    const normal = total(lines);
    const label = items.map((item) => `${item.quantity}× ${byId.get(item.productId)?.name ?? "?"}`).join(" + ");
    return [{ label, normalCents: normal, promoCents: normal - promotionDiscount(rule, lines, context).productDiscountCents }];
  }
  // "Every product" means what customers can order: published products only.
  const eligible = items.length > 0 ? items.map((item) => item.productId) : products.filter((product) => product.published).map((product) => product.id);
  const quantity = mechanic.type === "buy_x_get_y" ? mechanic.buyQuantity + mechanic.getQuantity : 1;
  return eligible.slice(0, 8).flatMap((productId) => {
    const single = line(productId, quantity);
    if (!single) return [];
    const normal = total([single]);
    return [{ label: `${quantity > 1 ? `${quantity}× ` : ""}${byId.get(productId)!.name}`, normalCents: normal, promoCents: normal - promotionDiscount(rule, [single], context).productDiscountCents }];
  });
}

/** One line under each mechanic tile, as in the capture. */
export const MECHANIC_HINT: Record<PromotionMechanic["type"], string> = {
  fixed_price: "Menú armado con precio cerrado",
  percent_off: "Rebaja porcentual directa",
  buy_x_get_y: "Llevás más, pagás menos",
  free_delivery: "Delivery $0 sobre el pedido"
};

/** Quick tags of the capture; "+ Personalizado" opens a free text field. */
export const BADGE_SUGGESTIONS = ["2x1", "30% OFF", "Combo dúo", "Happy hour"];

/** Monday first, as the capture's day row; values are 0 = Sunday … 6 = Saturday. */
export const DAY_CHIPS = [
  { value: "1", short: "L", name: "Lunes" },
  { value: "2", short: "M", name: "Martes" },
  { value: "3", short: "M", name: "Miércoles" },
  { value: "4", short: "J", name: "Jueves" },
  { value: "5", short: "V", name: "Viernes" },
  { value: "6", short: "S", name: "Sábado" },
  { value: "0", short: "D", name: "Domingo" }
];

/** Every window with the same hours: the capture's day chips and one opening and closing time express it. */
export function uniformSchedule(schedule: PromotionFormValues["schedule"]) {
  if (schedule.length === 0) return { days: [] as string[], startsAt: "20:00", endsAt: "23:30" };
  const [first] = schedule;
  const same = schedule.every((window) => window.startsAt === first!.startsAt && window.endsAt === first!.endsAt);
  const days = schedule.map((window) => window.dayOfWeek);
  return same && new Set(days).size === days.length ? { days, startsAt: first!.startsAt, endsAt: first!.endsAt } : null;
}
