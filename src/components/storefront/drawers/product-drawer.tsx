"use client";

import { ArrowLeft, NotebookPen } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  calculateConfiguredUnitPrice,
  getApplicableOptionGroups,
  getDefaultSelection,
  validateOptionSelection
} from "@/domain/catalog";
import { type PromotionalPrice } from "@/domain/promotions";
import type { CartLine, Product, SelectedOptions } from "@/domain/types";
import { formatArs } from "@/lib/money";
import { QuantityStepper } from "../shared/quantity-stepper";
import { focalStyle } from "../focal-style";
import { makeCartLine } from "../cart-lines";
import { OptionGroups, unitGroupsOf } from "./option-groups";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab and Shift+Tab inside the open dialog (aria-modal alone does not stop the keyboard). */
function trapFocus(event: KeyboardEvent, container: HTMLElement | null) {
  if (!container) return;
  const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  const outside = !container.contains(active);
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}

export function ProductDrawer({ product, initialLine, cart = [], promotion = null, onClose, onSubmit }: {
  product: Product;
  /** The promotional price the menu card shows for this product, if any (issue #54). */
  promotion?: PromotionalPrice | null;
  /** The cart as it is now, for the order summary at the end (the line being edited is replaced). */
  cart?: readonly CartLine[];
  initialLine?: CartLine | null;
  onClose: () => void;
  /** The line to add or edit and, when extras go to only some of the units, the other lines the quantity splits into. */
  onSubmit: (line: CartLine, otherLines?: CartLine[]) => void;
}) {
  const [selected, setSelected] = useState<SelectedOptions>(() => initialLine?.selectedOptions ?? getDefaultSelection(product));
  const [quantity, setQuantity] = useState(() => initialLine?.quantity ?? 1);
  // With several units, each extra can go on only some of them: how many carry it (all, when not set).
  const [extraUnits, setExtraUnits] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState(() => initialLine?.notes ?? "");
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const summaryId = useId();
  const slug = product.slug;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Focus moves to the close button once, on open: a parent re-render (status, promotions or
  // checkout answers) must not pull focus out of the field being typed in. Closing (button,
  // Escape, Back or adding) returns focus to whatever opened the drawer and the page to where it
  // was; a drawer opened from a shared link returns to its product's card.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const scrollY = window.scrollY;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      else if (event.key === "Tab") trapFocus(event, dialogRef.current);
    };
    document.body.classList.add("drawer-open");
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("drawer-open");
      window.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected) {
        opener.focus({ preventScroll: true });
        if (Math.abs(window.scrollY - scrollY) > 1) window.scrollTo({ top: scrollY });
        return;
      }
      document.querySelector<HTMLElement>(`[data-product-trigger="${CSS.escape(slug)}"]`)?.focus();
    };
  }, [slug]);

  const applicableGroups = getApplicableOptionGroups(product);
  const unitGroups = unitGroupsOf(product, selected, quantity, extraUnits);
  const isValid = unitGroups.every((group) => validateOptionSelection(product, group.selected).ok);
  const lineTotal = unitGroups.reduce((total, group) => total + calculateConfiguredUnitPrice(product, group.selected) * BigInt(group.quantity), 0n);
  // Order summary as in the capture: this product as configured plus what is already in the cart.
  const otherLines = cart.filter((line) => line.id !== initialLine?.id);
  const extrasOf = (options: SelectedOptions) =>
    applicableGroups.flatMap((group) =>
      group.options.filter((option) => (options[group.id] ?? []).includes(option.id) && option.priceDeltaCents > 0n).map((option) => option.name)
    );
  const summaryCount = otherLines.reduce((total, line) => total + line.quantity, 0) + quantity;
  const summaryTotal = otherLines.reduce((total, line) => total + line.unitPriceCents * BigInt(line.quantity), 0n) + lineTotal;

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div aria-describedby={summaryId} aria-label={`Personalizar ${product.name}`} aria-modal="true" className="product-drawer" ref={dialogRef} role="dialog">
        <div className="drawer-bar">
          <button className="drawer-back" onClick={onClose} ref={closeRef} type="button">
            <ArrowLeft aria-hidden="true" size={20} /> Seguir pidiendo
          </button>
        </div>
        <div className="drawer-content">
          <div className="drawer-card drawer-hero">
            {/* eslint-disable-next-line @next/next/no-img-element -- mock photography; next/image lands with real assets (BB-02) */}
            {product.imageUrl ? <img alt={product.imageAlt ?? product.name} className="drawer-image" src={product.imageUrl} style={focalStyle(product)} /> : null}
            <div className="drawer-hero-copy">
              <div className="drawer-title">
                <h2>{product.name}</h2>
                <span className="product-price">
                  <strong>{formatArs(promotion?.priceCents ?? product.priceCents)}</strong>
                  {promotion ? <s className="compare-at">{formatArs(promotion.compareAtPriceCents)}</s> : null}
                </span>
              </div>
              <p className="sr-only" id={summaryId}>
                {`Precio ${formatArs(promotion?.priceCents ?? product.priceCents)}${promotion ? `, antes ${formatArs(promotion.compareAtPriceCents)}` : ""}. ${product.inStock ? "Disponible." : "Agotado, no se puede agregar al carrito."}`}
              </p>
              {promotion ? (
                <p className="promo-note">
                  {promotion.promotionName}: {promotion.explanation}. El descuento se aplica al confirmar el pedido.
                </p>
              ) : null}
              {!product.inStock ? <p className="drawer-sold-out" aria-hidden="true">Agotado · no se puede agregar al carrito</p> : null}
              <p>{product.description}</p>
            </div>
          </div>

          <OptionGroups extraUnits={extraUnits} product={product} quantity={quantity} selected={selected} setExtraUnits={setExtraUnits} setSelected={setSelected} />

          <label className="drawer-card notes-field">
            <span>Aclaraciones para la cocina</span>
            <small>Aclaraciones (ej: sin pepinillos, aderezos aparte)</small>
            <textarea aria-label="Aclaraciones para la cocina" maxLength={180} onChange={(event) => setNotes(event.target.value)} placeholder="Escribí acá tus preferencias para el equipo…" value={notes} />
          </label>

          <section aria-labelledby={`${summaryId}-title`} className="drawer-card order-summary">
            <header>
              <NotebookPen aria-hidden="true" />
              <h3 id={`${summaryId}-title`}>Resumen de tu pedido</h3>
              <span className="option-badge">{summaryCount === 1 ? "1 item" : `${summaryCount} items`}</span>
            </header>
            {unitGroups.map((group) => {
              const names = extrasOf(group.selected);
              return (
                <div className="order-summary-line current" key={JSON.stringify(group.selected)}>
                  <span>
                    <strong>{group.quantity > 1 ? `${group.quantity}× ` : ""}{product.name}</strong>
                    <small>{names.length ? names.map((name) => `+ ${name}`).join(", ") : "Personalización estándar"}</small>
                  </span>
                  <strong>{formatArs(calculateConfiguredUnitPrice(product, group.selected) * BigInt(group.quantity))}</strong>
                </div>
              );
            })}
            {otherLines.map((line) => (
              <div className="order-summary-line" key={line.id}>
                <span>
                  <strong>{line.quantity > 1 ? `${line.quantity}× ` : ""}{line.productName}</strong>
                  <small>{line.notes || "En tu carrito"}</small>
                </span>
                <strong>{formatArs(line.unitPriceCents * BigInt(line.quantity))}</strong>
              </div>
            ))}
            <div className="order-summary-total"><span>Subtotal</span><strong>{formatArs(summaryTotal)}</strong></div>
          </section>
        </div>
        <div className="drawer-footer">
          <QuantityStepper
            decrementDisabled={quantity === 1}
            decrementLabel="Disminuir cantidad"
            incrementLabel="Aumentar cantidad"
            onDecrement={() => setQuantity((value) => Math.max(1, value - 1))}
            onIncrement={() => setQuantity((value) => value + 1)}
            value={quantity}
          />
          <button
            className="primary-action"
            disabled={!isValid || !product.inStock}
            onClick={() => {
              if (!isValid || !product.inStock) return;
              const [first, ...rest] = unitGroups;
              if (!first) return;
              const line = makeCartLine(product, first.selected, first.quantity, notes);
              if (rest.length === 0) onSubmit(line);
              else onSubmit(line, rest.map((group) => makeCartLine(product, group.selected, group.quantity, notes)));
            }}
            type="button"
          >
            {!product.inStock ? (
              "Producto agotado"
            ) : initialLine ? (
              <>Guardar cambios <span>{formatArs(lineTotal)}</span></>
            ) : (
              <>Agregar {quantity} al carrito <span>{formatArs(lineTotal)}</span></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
