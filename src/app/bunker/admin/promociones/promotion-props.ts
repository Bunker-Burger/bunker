import { localInputFromInstant } from "@/domain/store-admin";
import type { Catalog, PromotionRule } from "@/domain/types";
import { pesos } from "../catalogo/product-props";
import type { PromotionFormProduct, PromotionFormValues } from "./promotion-form";

/* Serializable props for the client promotion editor (no bigint, dates as local inputs). */

export function formProducts(catalog: Catalog): PromotionFormProduct[] {
  return catalog.products.map((product) => ({ id: product.id, name: product.name, priceCents: product.priceCents.toString(), published: product.published }));
}

export function newPromotionValues(timezone: string, now: Date = new Date()): PromotionFormValues {
  return {
    id: "",
    name: "",
    slug: "",
    description: "",
    badgeText: "",
    type: "percent_off",
    percentOff: "10",
    fixedPrice: "",
    buyQuantity: "2",
    getQuantity: "1",
    channels: ["delivery", "pickup"],
    startsAt: localInputFromInstant(now, timezone),
    endsAt: localInputFromInstant(new Date(now.getTime() + 30 * 86_400_000), timezone),
    active: false,
    items: [],
    schedule: []
  };
}

export function promotionValues(rule: PromotionRule, timezone: string): PromotionFormValues {
  const { mechanic } = rule;
  return {
    id: rule.id,
    name: rule.name,
    slug: rule.slug,
    description: rule.description,
    badgeText: rule.badgeText ?? "",
    type: mechanic.type,
    percentOff: mechanic.type === "percent_off" ? String(mechanic.percentOff) : "10",
    fixedPrice: mechanic.type === "fixed_price" ? pesos(mechanic.fixedPriceCents) : "",
    buyQuantity: mechanic.type === "buy_x_get_y" ? String(mechanic.buyQuantity) : "2",
    getQuantity: mechanic.type === "buy_x_get_y" ? String(mechanic.getQuantity) : "1",
    channels: [...rule.channels],
    startsAt: localInputFromInstant(rule.startsAt, timezone),
    endsAt: localInputFromInstant(rule.endsAt, timezone),
    active: rule.active,
    items: rule.items.map((item) => ({ productId: item.productId, quantity: String(item.quantity) })),
    schedule: rule.schedule.map((window) => ({ dayOfWeek: String(window.dayOfWeek), startsAt: window.startsAt.slice(0, 5), endsAt: window.endsAt.slice(0, 5) }))
  };
}

export type PromotionPhase = "running" | "waiting_window" | "scheduled" | "expired" | "paused";

/** Where a promotion stands now; "running" means it would apply to an order placed now. */
export function promotionPhase(rule: PromotionRule, inEffect: boolean, now: Date): PromotionPhase {
  if (!rule.active) return "paused";
  if (now < rule.startsAt) return "scheduled";
  if (now >= rule.endsAt) return "expired";
  return inEffect ? "running" : "waiting_window";
}
