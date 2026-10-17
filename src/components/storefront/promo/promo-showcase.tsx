"use client";

import { useSyncExternalStore } from "react";
import { isPromotionInEffect } from "@/domain/promotions";
import type { PromotionRule } from "@/domain/types";
import { PromoBanner, PromoSection } from "./promo-cards";

/*
 * Promotions at the top of the menu (issue #54); one without a photo gets the same dark tile with
 * an icon that products without a photo get. They are discount rules, not
 * products: the cart applies them by itself. A combo (fixed price over a set of products) is the
 * exception: tapping it adds its products to the cart, which is what makes the price apply.
 * Two presentations are
 * offered while the store decides: a sliding banner (default) and a "Promociones" section with the
 * cards of the menu, opened with `?promos=seccion`; `?promos=ambas` shows both, to compare.
 */

type PromoLayout = "banner" | "section" | "both";

const subscribe = () => () => {};
const LAYOUTS: Record<string, PromoLayout> = { seccion: "section", ambas: "both" };
const readLayout = (): PromoLayout => LAYOUTS[new URLSearchParams(window.location.search).get("promos") ?? ""] ?? "banner";

export function usePromoLayout(): PromoLayout {
  return useSyncExternalStore(subscribe, readLayout, () => "banner");
}

/** Every promotion in effect now, with or without a photo. */
export function showcasePromotions(promotions: readonly PromotionRule[], now: Date | null, timezone: string) {
  if (!now) return [];
  return promotions.filter((promotion) => isPromotionInEffect(promotion, now, timezone));
}

export function PromoShowcase({ promotions, layout, onAdd }: { promotions: readonly PromotionRule[]; layout: PromoLayout; onAdd?: ((promotion: PromotionRule) => void) | undefined }) {
  if (promotions.length === 0) return null;
  if (layout === "both") {
    return (
      <>
        <PromoBanner label="Promociones destacadas" onAdd={onAdd} promotions={promotions} />
        <PromoSection onAdd={onAdd} promotions={promotions} />
      </>
    );
  }
  return layout === "section" ? <PromoSection onAdd={onAdd} promotions={promotions} /> : <PromoBanner label="Promociones" onAdd={onAdd} promotions={promotions} />;
}
