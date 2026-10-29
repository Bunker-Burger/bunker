"use client";

import {
  ArrowRight,
  NotebookPen,
  ShoppingCart
} from "lucide-react";
import { clearCart, removeCartLine } from "@/domain/cart";
import { comboCount, removeOneCombo } from "@/domain/combos";
import type { CartLine, Product, PromotionRule } from "@/domain/types";
import { formatArs } from "@/lib/money";
import { changeLineQuantity } from "../storefront-state";
import { paidExtraNames } from "../drawers/option-groups";
import { QuantityStepper } from "../shared/quantity-stepper";
import { ViewBar } from "../shared/view-bar";

/** "+ Extra bacon, + Cheddar": the paid choices of a cart line, read from the catalog. */
function chosenExtras(line: CartLine, products: readonly Product[]) {
  const product = products.find((candidate) => candidate.id === line.productId);
  if (!product) return [];
  return paidExtraNames(product, line.selectedOptions).map((name) => `+ ${name}`);
}

export function CartSection({
  active,
  cart,
  products,
  subtotal,
  promotion,
  promotions,
  onAddCombo,
  onEditCombo,
  onChange,
  onEditLine,
  storageDegraded
}: {
  active: boolean;
  cart: CartLine[];
  products: readonly Product[];
  subtotal: bigint;
  /** The promotion taking something off the products right now, if any. */
  promotion: { name: string; discountCents: bigint } | null;
  /** The store's promotions, to know which combos the cart's lines belong to. */
  promotions: readonly PromotionRule[];
  /** One more of a combo already in the cart. */
  onAddCombo: (combo: PromotionRule) => void;
  /** Open the detail of a combo already in the cart to change its choices. */
  onEditCombo: (combo: PromotionRule) => void;
  onChange: (cart: CartLine[]) => void;
  onEditLine: (line: CartLine) => void;
  storageDegraded?: boolean;
}) {
  const count = cart.reduce((total, line) => total + line.quantity, 0);
  // Lines added from a combo that is still offered are shown together, as the combo; the rest one by one.
  const combosById = new Map(promotions.map((combo) => [combo.id, combo]));
  const entries = cart.reduce<Array<{ kind: "line"; line: CartLine } | { kind: "combo"; combo: PromotionRule; lines: CartLine[] }>>((list, line) => {
    const combo = line.comboId ? combosById.get(line.comboId) : undefined;
    if (!combo) return [...list, { kind: "line", line }];
    const existing = list.find((entry) => entry.kind === "combo" && entry.combo.id === combo.id);
    if (existing && existing.kind === "combo") {
      existing.lines.push(line);
      return list;
    }
    return [...list, { kind: "combo", combo, lines: [line] }];
  }, []);
  const renderLine = (line: CartLine, inCombo: boolean) => {
    const extras = chosenExtras(line, products);
    const detail = [extras.join(", "), line.notes].filter(Boolean).join(" · ") || "Personalización estándar";
    if (inCombo) {
      return (
        <li className="cart-combo-item" key={line.id}>
          <span>
            <strong>{line.quantity}× {line.productName}</strong>
            <small>{detail}</small>
          </span>
        </li>
      );
    }
    return (
      <div className="cart-line" key={line.id}>
        <div className="cart-line-copy">
          <strong>{line.productName}</strong>
          <small>{detail}</small>
        </div>
        <strong className="cart-line-price">{formatArs(line.unitPriceCents * BigInt(line.quantity))}</strong>
        <div className="cart-line-actions">
          <QuantityStepper
            compact
            decrementLabel={`Quitar uno de ${line.productName}`}
            incrementLabel={`Agregar uno de ${line.productName}`}
            onDecrement={() => onChange(changeLineQuantity(cart, line.id, -1))}
            onIncrement={() => onChange(changeLineQuantity(cart, line.id, 1))}
            value={line.quantity}
          />
          <button aria-label={`Editar ${line.productName}`} className="cart-action-btn" onClick={() => onEditLine(line)} type="button">
            Editar
          </button>
          <button aria-label={`Quitar ${line.productName} del carrito`} className="cart-action-btn text-danger" onClick={() => onChange(removeCartLine(cart, line.id))} type="button">
            Eliminar
          </button>
        </div>
      </div>
    );
  };
  return (
    <section aria-labelledby="cart-title" className="store-view order-section" data-active={active} id="carrito">
      <ViewBar back="#menu" backLabel="Seguir pidiendo" title="Tu pedido" titleId="cart-title" />
      {storageDegraded ? (
        <div className="storage-degraded-banner" data-testid="storage-degraded-banner" role="status">
          El almacenamiento local no está disponible en este navegador. Tu carrito se mantendrá durante esta sesión activa.
        </div>
      ) : null}
      {cart.length === 0 ? (
        <div className="empty-state"><ShoppingCart /><h3>Tu carrito está vacío</h3><p>Elegí algo rico de la carta para empezar.</p><a href="#menu">Ver menú</a></div>
      ) : (
        <div className="drawer-card order-summary cart-panel">
          <header>
            <NotebookPen aria-hidden="true" />
            <h3>Resumen de tu pedido</h3>
            <span className="option-badge">{count === 1 ? "1 item" : `${count} items`}</span>
          </header>
          {entries.map((entry) => {
            if (entry.kind === "line") return renderLine(entry.line, false);
            const { combo, lines } = entry;
            const count = comboCount(cart, combo);
            const fixedCents = combo.mechanic.type === "fixed_price" ? combo.mechanic.fixedPriceCents : 0n;
            const extrasCents = lines.reduce((total, line) => {
              const base = products.find((product) => product.id === line.productId)?.priceCents ?? line.unitPriceCents;
              return total + (line.unitPriceCents > base ? (line.unitPriceCents - base) * BigInt(line.quantity) : 0n);
            }, 0n);
            return (
              <div className="cart-combo" key={`combo-${combo.id}`}>
                <div className="cart-line">
                  <div className="cart-line-copy">
                    <strong>{combo.name}</strong>
                    <small>{count === 1 ? "1 combo" : count > 1 ? `${count} combos` : "Combo incompleto"}</small>
                  </div>
                  <strong className="cart-line-price">{formatArs(fixedCents * BigInt(count) + extrasCents)}</strong>
                  <div className="cart-line-actions">
                    <QuantityStepper
                      compact
                      decrementLabel={`Quitar un ${combo.name}`}
                      incrementLabel={`Agregar otro ${combo.name}`}
                      onDecrement={() => onChange(removeOneCombo(cart, combo))}
                      onIncrement={() => onAddCombo(combo)}
                      value={count}
                    />
                    <button aria-label={`Editar ${combo.name}`} className="cart-action-btn" onClick={() => onEditCombo(combo)} type="button">
                      Editar
                    </button>
                    <button aria-label={`Quitar ${combo.name} del carrito`} className="cart-action-btn text-danger" onClick={() => onChange(cart.filter((line) => line.comboId !== combo.id))} type="button">
                      Eliminar
                    </button>
                  </div>
                </div>
                <ul className="cart-combo-items">{lines.map((line) => renderLine(line, true))}</ul>
              </div>
            );
          })}
          {promotion ? (
            <>
              <div className="order-summary-line"><span><strong>Productos</strong></span><strong>{formatArs(subtotal)}</strong></div>
              <div className="order-summary-line promo-applied"><span><strong>{promotion.name}</strong><small>Promo aplicada</small></span><strong>− {formatArs(promotion.discountCents)}</strong></div>
              <div className="order-summary-total"><span>Subtotal con promo</span><strong>{formatArs(subtotal - promotion.discountCents)}</strong></div>
            </>
          ) : (
            <div className="order-summary-total"><span>Subtotal</span><strong>{formatArs(subtotal)}</strong></div>
          )}
          <a className="primary-action wide" href="#checkout">Continuar al checkout <ArrowRight aria-hidden="true" /></a>
          <div className="cart-actions-row">
            <button aria-label="Vaciar carrito completo" className="clear-cart-btn" onClick={() => onChange(clearCart())} type="button">
              Vaciar carrito
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
