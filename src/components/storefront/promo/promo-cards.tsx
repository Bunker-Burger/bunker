"use client";

import {
  Bike,
  Copy,
  Layers,
  Percent,
  Tag,
  type LucideIcon
} from "lucide-react";
import { explainPromotion } from "@/domain/promotions";
import type { PromotionRule } from "@/domain/types";
import { focalStyle } from "../focal-style";
import { isCombo } from "./combo-section";

const MECHANIC_ICON: Record<PromotionRule["mechanic"]["type"], LucideIcon> = {
  fixed_price: Layers,
  percent_off: Percent,
  buy_x_get_y: Copy,
  free_delivery: Bike
};

/** The tile of a promotion without a photo: dark, with an icon of what it does, like a product without a photo. */
function PromoTile({ promotion }: { promotion: PromotionRule }) {
  const Icon = MECHANIC_ICON[promotion.mechanic.type];
  return (
    <span aria-hidden="true" className="promo-tile">
      <Icon />
    </span>
  );
}

export function PromoSection({ promotions, onAdd }: { promotions: readonly PromotionRule[]; onAdd?: ((promotion: PromotionRule) => void) | undefined }) {
  return (
    <section aria-labelledby="seccion-promociones" className="menu-category promo-section">
      <div className="menu-heading">
        <h2 id="seccion-promociones">Promociones</h2>
        <p>Se aplican solas cuando tu pedido cumple la promo.</p>
      </div>
      <div className="product-grid featured-grid">
        {promotions.map((promotion) => {
          const card = (
            <>
              <div className="promo-card-image">
                {promotion.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- public catalog bucket, same as product photos
                  <img alt="" loading="lazy" src={promotion.imageUrl} style={focalStyle(promotion)} />
                ) : (
                  <PromoTile promotion={promotion} />
                )}
                {promotion.badgeText ? <span className="promo-badge">{promotion.badgeText}</span> : null}
              </div>
              <div className="promo-card-copy">
                <h3>{promotion.name}</h3>
                <p>{explainPromotion(promotion)}</p>
                <span className="promo-note">
                  <Tag aria-hidden="true" size={12} /> {onAdd && isCombo(promotion) ? "Tocá para agregarlo al carrito" : "Se aplica sola al pedido"}
                </span>
              </div>
            </>
          );
          return (
            <article className="product-card promo-card" key={promotion.id}>
              {onAdd && isCombo(promotion) ? (
                <button aria-label={`Agregar combo ${promotion.name} al carrito`} className="promo-tap" onClick={() => onAdd(promotion)} type="button">
                  {card}
                </button>
              ) : (
                card
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function PromoBanner({ promotions, label, onAdd }: { promotions: readonly PromotionRule[]; label: string; onAdd?: ((promotion: PromotionRule) => void) | undefined }) {
  return (
    <section aria-label={label} className="promo-banner">
      <ul className="promo-banner-track" data-single={promotions.length === 1 || undefined}>
        {promotions.map((promotion) => (
          <li className="promo-slide" key={promotion.id}>
            {promotion.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- public catalog bucket, same as product photos
              <img alt="" src={promotion.imageUrl} style={focalStyle(promotion)} />
            ) : (
              <PromoTile promotion={promotion} />
            )}
            <div className="promo-slide-copy">
              {promotion.badgeText ? <span className="promo-badge">{promotion.badgeText}</span> : null}
              <h2>{promotion.name}</h2>
              <p>{explainPromotion(promotion)}</p>
            </div>
            {onAdd && isCombo(promotion) ? (
              <button aria-label={`Agregar combo ${promotion.name} al carrito`} className="promo-tap promo-tap-cover" onClick={() => onAdd(promotion)} type="button" />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
