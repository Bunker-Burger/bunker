"use client";

import { Layers, Plus, Tag } from "lucide-react";
import { useSyncExternalStore } from "react";
import { explainPromotion, isPromotionInEffect } from "@/domain/promotions";
import type { Product, PromotionRule } from "@/domain/types";
import { formatArs } from "@/lib/money";
import { focalStyle } from "./focal-style";

/*
 * Promotions with a photo at the top of the menu (issue #54). They are discount rules, not
 * products: the cart applies them by itself. A combo (fixed price over a set of products) is the
 * exception: tapping it adds its products to the cart, which is what makes the price apply.
 * Two presentations are
 * offered while the store decides: a sliding banner (default) and a "Promociones" section with the
 * cards of the menu, opened with `?promos=seccion`; `?promos=ambas` shows both, to compare.
 */

export type PromoLayout = "banner" | "section" | "both";

const subscribe = () => () => {};
const LAYOUTS: Record<string, PromoLayout> = { seccion: "section", ambas: "both" };
const readLayout = (): PromoLayout => LAYOUTS[new URLSearchParams(window.location.search).get("promos") ?? ""] ?? "banner";

export function usePromoLayout(): PromoLayout {
  return useSyncExternalStore(subscribe, readLayout, () => "banner");
}

/** In effect now and with a photo uploaded: uploading the photo is what puts it in the menu. */
export function showcasePromotions(promotions: readonly PromotionRule[], now: Date | null, timezone: string) {
  if (!now) return [];
  return promotions.filter((promotion) => promotion.imageUrl && isPromotionInEffect(promotion, now, timezone));
}

/** A combo: a fixed price over a set of products. */
export const isCombo = (promotion: PromotionRule) => promotion.mechanic.type === "fixed_price" && promotion.items.length > 0;

/** Combos in effect now, with or without a photo. */
export function comboPromotions(promotions: readonly PromotionRule[], now: Date | null, timezone: string) {
  if (!now) return [];
  return promotions.filter((promotion) => isCombo(promotion) && isPromotionInEffect(promotion, now, timezone));
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

type ComboProduct = Pick<Product, "id" | "name" | "priceCents">;

/** What a combo is made of, e.g. "1× Doble búnker + 1× Papas clásicas"; null if a product is gone. */
export function comboContents(combo: PromotionRule, products: readonly ComboProduct[]) {
  const byId = new Map(products.map((product) => [product.id, product]));
  const parts = combo.items.map((item) => ({ product: byId.get(item.productId), quantity: item.quantity }));
  if (parts.some((part) => !part.product)) return null;
  const found = parts as Array<{ product: ComboProduct; quantity: number }>;
  return {
    text: found.map((part) => `${part.quantity}× ${part.product.name}`).join(" + "),
    normalCents: found.reduce((sum, part) => sum + part.product.priceCents * BigInt(part.quantity), 0n)
  };
}

/** The "Combos" section of the menu: each combo as a card; tapping it adds its products to the cart. */
export function ComboSection({ combos, products, onAdd }: { combos: readonly PromotionRule[]; products: readonly ComboProduct[]; onAdd: (combo: PromotionRule) => void }) {
  const cards = combos.flatMap((combo) => {
    const contents = comboContents(combo, products);
    return contents && combo.mechanic.type === "fixed_price" ? [{ combo, contents, priceCents: combo.mechanic.fixedPriceCents }] : [];
  });
  if (cards.length === 0) return null;
  return (
    <section aria-labelledby="seccion-combos" className="menu-category combo-section">
      <div className="menu-heading">
        <h2 id="seccion-combos">Combos</h2>
        <p>Armados con precio cerrado. Tocá uno y se suma al carrito.</p>
      </div>
      <div className="product-grid">
        {cards.map(({ combo, contents, priceCents }) => (
          <article className="product-card row combo-card" key={combo.id}>
            <button aria-label={`Agregar combo ${combo.name} al carrito`} className="product-main" onClick={() => onAdd(combo)} type="button">
              <div className="product-image-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element -- public catalog bucket, same as product photos */}
                {combo.imageUrl ? <img alt="" className="product-image" src={combo.imageUrl} style={focalStyle(combo)} /> : <span aria-hidden="true" className="product-placeholder"><Layers /></span>}
              </div>
              <div className="product-copy">
                <div className="product-title-row">
                  <h3>{combo.name}</h3>
                  <span className="product-price">
                    <strong>{formatArs(priceCents)}</strong>
                    {contents.normalCents > priceCents ? <>{" "}<s className="compare-at"><span className="sr-only">Antes</span> {formatArs(contents.normalCents)}</s></> : null}
                  </span>
                </div>
                <p>{contents.text}</p>
                <span aria-hidden="true" className="product-meta">Combo</span>
              </div>
            </button>
            <span aria-hidden="true" className="add-button">
              Agregar <Plus size={16} />
            </span>
          </article>
        ))}
      </div>
    </section>
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
                {/* eslint-disable-next-line @next/next/no-img-element -- public catalog bucket, same as product photos */}
                <img alt="" loading="lazy" src={promotion.imageUrl ?? ""} style={focalStyle(promotion)} />
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
            {/* eslint-disable-next-line @next/next/no-img-element -- public catalog bucket, same as product photos */}
            <img alt="" src={promotion.imageUrl ?? ""} style={focalStyle(promotion)} />
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
