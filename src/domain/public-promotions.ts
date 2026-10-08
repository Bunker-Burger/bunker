import { z } from "zod";
import type { PromotionMechanic, PromotionRule } from "./types";

/*
 * Promotion rules as the public `GET /api/store/promotions` endpoint publishes them, so the
 * menu and the checkout estimate use the same rules the server quotes with.
 *
 * - Only what the engine needs: no description or badge text (customer copy is generated from
 *   the mechanic), money as a string of cents.
 * - Products are identified by slug, the key the storefront and the database share; an item
 *   whose product is not public keeps `productSlug: null` and matches nothing (dropping it
 *   would turn a product promotion into a whole-order one).
 */

export type PublicPromotionMechanic =
  | { type: "fixed_price"; fixedPriceCents: string }
  | { type: "percent_off"; percentOff: number }
  | { type: "buy_x_get_y"; buyQuantity: number; getQuantity: number }
  | { type: "free_delivery" };

export interface PublicPromotion {
  id: string;
  slug: string;
  name: string;
  priority: number;
  startsAt: string;
  endsAt: string;
  mechanic: PublicPromotionMechanic;
  channels: PromotionRule["channels"];
  items: Array<{ productSlug: string | null; quantity: number }>;
  schedule: PromotionRule["schedule"];
}

function toPublicMechanic(mechanic: PromotionMechanic): PublicPromotionMechanic {
  return mechanic.type === "fixed_price" ? { type: "fixed_price", fixedPriceCents: mechanic.fixedPriceCents.toString() } : mechanic;
}

/** Public view of a rule; `productSlugs` maps product ids to the slugs of public products. */
export function toPublicPromotion(rule: PromotionRule, productSlugs: ReadonlyMap<string, string>): PublicPromotion {
  return {
    id: rule.id,
    slug: rule.slug,
    name: rule.name,
    priority: rule.priority,
    startsAt: rule.startsAt.toISOString(),
    endsAt: rule.endsAt.toISOString(),
    mechanic: toPublicMechanic(rule.mechanic),
    channels: rule.channels,
    items: rule.items.map((item) => ({ productSlug: productSlugs.get(item.productId) ?? null, quantity: item.quantity })),
    schedule: rule.schedule
  };
}

const positiveInt = z.number().int().positive();
const wallClock = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);

const publicPromotionSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  priority: z.number().int(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  mechanic: z.discriminatedUnion("type", [
    z.object({ type: z.literal("fixed_price"), fixedPriceCents: z.string().regex(/^\d+$/) }),
    z.object({ type: z.literal("percent_off"), percentOff: z.number().gt(0).max(100) }),
    z.object({ type: z.literal("buy_x_get_y"), buyQuantity: positiveInt, getQuantity: positiveInt }),
    z.object({ type: z.literal("free_delivery") })
  ]),
  channels: z.array(z.enum(["delivery", "pickup"])),
  items: z.array(z.object({ productSlug: z.string().nullable(), quantity: positiveInt })),
  schedule: z.array(z.object({ dayOfWeek: z.number().int().min(0).max(6), startsAt: wallClock, endsAt: wallClock }))
});

const publicPromotionsSchema = z.object({ promotions: z.array(publicPromotionSchema) });

/** Validates a `GET /api/store/promotions` body; anything else (errors included) yields null. */
export function parsePublicPromotions(value: unknown): PublicPromotion[] | null {
  const parsed = publicPromotionsSchema.safeParse(value);
  return parsed.success ? parsed.data.promotions : null;
}

/**
 * Engine rules from the public view, with item slugs resolved to the ids the cart uses.
 * Published rules are active by construction: the endpoint never returns paused ones.
 */
export function toPromotionRule(promotion: PublicPromotion, productIdBySlug: ReadonlyMap<string, string>): PromotionRule {
  const { mechanic } = promotion;
  return {
    id: promotion.id,
    slug: promotion.slug,
    name: promotion.name,
    description: "",
    badgeText: null,
    priority: promotion.priority,
    active: true,
    startsAt: new Date(promotion.startsAt),
    endsAt: new Date(promotion.endsAt),
    mechanic: mechanic.type === "fixed_price" ? { type: "fixed_price", fixedPriceCents: BigInt(mechanic.fixedPriceCents) } : mechanic,
    channels: promotion.channels,
    items: promotion.items.map((item) => ({
      // Never an id of a real cart line, so an unknown product matches nothing.
      productId: (item.productSlug !== null && productIdBySlug.get(item.productSlug)) || `unknown-product:${item.productSlug ?? ""}`,
      quantity: item.quantity
    })),
    schedule: promotion.schedule
  };
}
