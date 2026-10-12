"use client";

import { Tag } from "lucide-react";
import { useSyncExternalStore } from "react";
import { explainPromotion, isPromotionInEffect } from "@/domain/promotions";
import type { PromotionRule } from "@/domain/types";

/*
 * Promotions with a photo at the top of the menu (issue #54). They are discount rules, not
 * products: tapping them adds nothing, the cart applies them by itself. Two presentations are
 * offered while the store decides: a sliding banner (default) and a "Promociones" section with the
 * cards of the menu, opened with `?promos=seccion`.
 */

export type PromoLayout = "banner" | "section";

const subscribe = () => () => {};
const readLayout = (): PromoLayout => (new URLSearchParams(window.location.search).get("promos") === "seccion" ? "section" : "banner");

export function usePromoLayout(): PromoLayout {
  return useSyncExternalStore(subscribe, readLayout, () => "banner");
}

/** In effect now and with a photo uploaded: uploading the photo is what puts it in the menu. */
export function showcasePromotions(promotions: readonly PromotionRule[], now: Date | null, timezone: string) {
  if (!now) return [];
  return promotions.filter((promotion) => promotion.imageUrl && isPromotionInEffect(promotion, now, timezone));
}

export function PromoShowcase({ promotions, layout }: { promotions: readonly PromotionRule[]; layout: PromoLayout }) {
  if (promotions.length === 0) return null;

  if (layout === "section") {
    return (
      <section aria-labelledby="seccion-promociones" className="menu-category promo-section">
        <div className="menu-heading">
          <h2 id="seccion-promociones">Promociones</h2>
          <p>Se aplican solas cuando tu pedido cumple la promo.</p>
        </div>
        <div className="product-grid featured-grid">
          {promotions.map((promotion) => (
            <article className="product-card promo-card" key={promotion.id}>
              <div className="promo-card-image">
                {/* eslint-disable-next-line @next/next/no-img-element -- public catalog bucket, same as product photos */}
                <img alt="" loading="lazy" src={promotion.imageUrl ?? ""} />
                {promotion.badgeText ? <span className="promo-badge">{promotion.badgeText}</span> : null}
              </div>
              <div className="promo-card-copy">
                <h3>{promotion.name}</h3>
                <p>{explainPromotion(promotion)}</p>
                <span className="promo-note">
                  <Tag aria-hidden="true" size={12} /> Se aplica sola al pedido
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Promociones" className="promo-banner">
      <ul className="promo-banner-track" data-single={promotions.length === 1 || undefined}>
        {promotions.map((promotion) => (
          <li className="promo-slide" key={promotion.id}>
            {/* eslint-disable-next-line @next/next/no-img-element -- public catalog bucket, same as product photos */}
            <img alt="" src={promotion.imageUrl ?? ""} />
            <div className="promo-slide-copy">
              {promotion.badgeText ? <span className="promo-badge">{promotion.badgeText}</span> : null}
              <h2>{promotion.name}</h2>
              <p>{explainPromotion(promotion)}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
