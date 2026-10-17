"use client";

import { Layers, Plus } from "lucide-react";
import { isPromotionInEffect } from "@/domain/promotions";
import type { Product, PromotionRule } from "@/domain/types";
import { formatArs } from "@/lib/money";
import { CompareAt } from "../shared/compare-at";
import { focalStyle } from "../focal-style";

type ComboProduct = Pick<Product, "id" | "name" | "priceCents">;

/** A combo: a fixed price over a set of products. */
export const isCombo = (promotion: PromotionRule) => promotion.mechanic.type === "fixed_price" && promotion.items.length > 0;

/** Combos in effect now, with or without a photo. */
export function comboPromotions(promotions: readonly PromotionRule[], now: Date | null, timezone: string) {
  if (!now) return [];
  return promotions.filter((promotion) => isCombo(promotion) && isPromotionInEffect(promotion, now, timezone));
}

/** What a combo is made of, e.g. "1× Doble búnker + 1× Papas clásicas"; null if a product is gone. */
export function comboContents(combo: PromotionRule, products: readonly ComboProduct[]) {
  const byId = new Map(products.map((product) => [product.id, product]));
  const parts = combo.items.map((item) => ({ product: byId.get(item.productId), quantity: item.quantity }));
  if (parts.some((part) => !part.product)) return null;
  const found = parts as Array<{ product: ComboProduct; quantity: number }>;
  return {
    text: found.map((part) => `${part.quantity}× ${part.product.name}`).join(" + "),
    /** The products' names alone: the quantities are in the combo's title. */
    names: found.map((part) => part.product.name).join(" + "),
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
        <p>Para compartir</p>
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
                    {contents.normalCents > priceCents ? <>{" "}<CompareAt cents={contents.normalCents} /></> : null}
                  </span>
                </div>
                <p>{combo.description || contents.names}</p>
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
