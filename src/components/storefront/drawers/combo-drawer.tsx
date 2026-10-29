"use client";

import { ArrowLeft, NotebookPen } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  calculateConfiguredUnitPrice,
  getApplicableOptionGroups,
  getDefaultSelection,
  validateOptionSelection
} from "@/domain/catalog";
import type { CartLine, Product, PromotionRule, SelectedOptions } from "@/domain/types";
import { formatArs } from "@/lib/money";
import { CompareAt } from "../shared/compare-at";
import { QuantityStepper } from "../shared/quantity-stepper";
import { focalStyle } from "../focal-style";
import { makeCartLine } from "../cart-lines";
import { OptionGroups, paidExtraNames, unitGroupsOf, type ExtraLevels } from "./option-groups";

/** Detail of a combo (issue #54): what it includes, its description and the extras of each product, then the price. */
/** What the combo's detail starts from when a combo already in the cart is edited. */
export interface ComboDrawerState {
  selections: SelectedOptions[];
  extraUnits: ExtraLevels[];
  notes: string;
}

/**
 * The choices of a combo in the cart as the detail shows them: per included product, the options
 * the units carry and how many carry each extra (rebuilt from the cart's lines).
 */
export function comboDrawerState(combo: PromotionRule, lines: readonly CartLine[], products: readonly Product[]): ComboDrawerState {
  const own = lines.filter((line) => line.comboId === combo.id);
  const entries = combo.items.flatMap((item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    return product ? [product] : [];
  });
  const perProduct = entries.map((product) => {
    const mine = own.filter((line) => line.productId === product.id);
    const selected: SelectedOptions = {};
    const units: ExtraLevels = {};
    for (const group of getApplicableOptionGroups(product)) {
      if (group.selectionMode === "multiple") {
        const ids = new Set(mine.flatMap((line) => line.selectedOptions[group.id] ?? []));
        selected[group.id] = [...ids];
        const total = mine.reduce((sum, line) => sum + line.quantity, 0);
        for (const id of ids) {
          const timesIn = (line: CartLine) => (line.selectedOptions[group.id] ?? []).filter((optionId) => optionId === id).length;
          const most = Math.max(...mine.map(timesIn));
          // Level k: the units with more than k of this extra. On every unit: Infinity, so it follows the number of combos.
          const levels = Array.from({ length: most }, (_, k) => {
            const carrying = mine.filter((line) => timesIn(line) > k).reduce((sum, line) => sum + line.quantity, 0);
            return carrying < total ? carrying : Infinity;
          });
          if (levels.length > 1 || levels[0] !== Infinity) units[id] = levels;
        }
      } else {
        const biggest = [...mine].sort((a, b) => b.quantity - a.quantity)[0];
        selected[group.id] = biggest?.selectedOptions[group.id] ?? getDefaultSelection(product)[group.id] ?? [];
      }
    }
    return { selected, units };
  });
  return {
    selections: perProduct.map((entry) => entry.selected),
    extraUnits: perProduct.map((entry) => entry.units),
    notes: own.find((line) => line.notes)?.notes ?? ""
  };
}

export function ComboDrawer({ combo, products, onClose, onAdd, copies = 1, initial }: {
  combo: PromotionRule;
  products: readonly Product[];
  onClose: () => void;
  onAdd: (lines: CartLine[]) => void;
  /** How many combos are being edited: every included product's quantity is multiplied by it. */
  copies?: number;
  /** Set when a combo already in the cart is being edited. */
  initial?: ComboDrawerState;
}) {
  // How many combos: the quantity of every included product is the combo's times this.
  const [count, setCount] = useState(Math.max(1, copies));
  const items = combo.items.flatMap((item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    return product ? [{ product, quantity: item.quantity * count }] : [];
  });
  const editing = initial !== undefined;
  const [selections, setSelections] = useState<SelectedOptions[]>(() => initial?.selections ?? items.map((item) => getDefaultSelection(item.product)));
  const [extraUnits, setExtraUnits] = useState<ExtraLevels[]>(() => initial?.extraUnits ?? items.map(() => ({})));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opened once; the handler only closes
  }, []);

  const perItem = items.map((item, index) => ({ ...item, groups: unitGroupsOf(item.product, selections[index] ?? {}, item.quantity, extraUnits[index] ?? {}) }));
  const unavailable = perItem.find((item) => !item.product.inStock);
  const valid = perItem.every((item) => item.groups.every((group) => validateOptionSelection(item.product, group.selected).ok));
  const extrasCents = perItem.reduce(
    (total, item) =>
      total + item.groups.reduce((sum, group) => sum + (calculateConfiguredUnitPrice(item.product, group.selected) - item.product.priceCents) * BigInt(group.quantity), 0n),
    0n
  );
  const fixedCents = (combo.mechanic.type === "fixed_price" ? combo.mechanic.fixedPriceCents : 0n) * BigInt(count);
  const normalCents = perItem.reduce((total, item) => total + item.product.priceCents * BigInt(item.quantity), 0n);
  const totalCents = fixedCents + extrasCents;

  const submit = () => {
    if (unavailable || !valid) return;
    onAdd(perItem.flatMap((item) => item.groups.map((group) => makeCartLine(item.product, group.selected, group.quantity, notes, combo.id))));
  };

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div aria-labelledby={titleId} aria-modal="true" className="product-drawer" role="dialog">
        <div className="drawer-bar">
          <button className="drawer-back" onClick={onClose} ref={closeRef} type="button">
            <ArrowLeft aria-hidden="true" size={20} /> Seguir pidiendo
          </button>
        </div>
        <div className="drawer-content">
          <div className="drawer-card drawer-hero">
            {/* eslint-disable-next-line @next/next/no-img-element -- public catalog bucket, same as product photos */}
            {combo.imageUrl ? <img alt="" className="drawer-image" src={combo.imageUrl} style={focalStyle(combo)} /> : null}
            <div className="drawer-hero-copy">
              <div className="drawer-title">
                <h2 id={titleId}>{combo.name}{count > 1 ? <small className="combo-copies"> · {count} combos</small> : null}</h2>
                <span className="product-price">
                  <strong>{formatArs(fixedCents)}</strong>
                  {normalCents > fixedCents ? <CompareAt cents={normalCents} /> : null}
                </span>
              </div>
              {combo.badgeText ? <span className="promo-badge combo-badge">{combo.badgeText}</span> : null}
              {combo.description ? <p className="combo-description">{combo.description}</p> : null}
              <p className="combo-includes-title">Incluye</p>
              <ul className="combo-includes">
                {perItem.map(({ product, quantity }) => (
                  <li key={product.id}>
                    <strong>{quantity}×</strong> {product.name}
                  </li>
                ))}
              </ul>
              {unavailable ? <p className="drawer-sold-out" role="alert">{unavailable.product.name} no está disponible por ahora.</p> : null}
            </div>
          </div>

          {perItem.map((item, index) =>
            getApplicableOptionGroups(item.product).length > 0 ? (
              <section aria-label={`Opciones de ${item.product.name}`} className="combo-item" key={item.product.id}>
                <h3 className="combo-item-title">{item.quantity}× {item.product.name}</h3>
                <OptionGroups
                  extraUnits={extraUnits[index] ?? {}}
                  namePrefix={`item-${index}:`}
                  product={item.product}
                  quantity={item.quantity}
                  selected={selections[index] ?? {}}
                  setExtraUnits={(update) => setExtraUnits((current) => current.map((value, i) => (i === index ? update(value) : value)))}
                  setSelected={(update) => setSelections((current) => current.map((value, i) => (i === index ? update(value) : value)))}
                />
              </section>
            ) : null
          )}

          <label className="drawer-card notes-field">
            <span>Aclaraciones para la cocina</span>
            <small>Aclaraciones (ej: sin pepinillos, aderezos aparte)</small>
            <textarea aria-label="Aclaraciones para la cocina" maxLength={180} onChange={(event) => setNotes(event.target.value)} placeholder="Escribí acá tus preferencias para el equipo…" value={notes} />
          </label>

          <section aria-label="Resumen del combo" className="drawer-card order-summary">
            <header>
              <NotebookPen aria-hidden="true" />
              <h3>Resumen del combo</h3>
            </header>
            <div className="order-summary-line current">
              <span><strong>{combo.name}</strong><small>Precio del combo</small></span>
              <strong>{formatArs(fixedCents)}</strong>
            </div>
            {perItem.map((item) => {
              const cents = item.groups.reduce((sum, group) => sum + (calculateConfiguredUnitPrice(item.product, group.selected) - item.product.priceCents) * BigInt(group.quantity), 0n);
              if (cents <= 0n) return null;
              const chosenNames = [...new Set(item.groups.flatMap((group) => paidExtraNames(item.product, group.selected)))];
              return (
                <div className="order-summary-line current" key={item.product.id}>
                  <span><strong>{item.product.name}</strong><small>{chosenNames.map((name) => `+ ${name}`).join(", ")}</small></span>
                  <strong>+ {formatArs(cents)}</strong>
                </div>
              );
            })}
            <div className="order-summary-total"><span>Total</span><strong>{formatArs(totalCents)}</strong></div>
          </section>
        </div>
        <div className="drawer-footer combo-footer">
          <QuantityStepper
            decrementDisabled={count <= 1}
            decrementLabel="Quitar un combo"
            incrementLabel="Agregar otro combo"
            onDecrement={() => setCount((value) => Math.max(1, value - 1))}
            onIncrement={() => setCount((value) => value + 1)}
            value={count}
            valueLabel={`${count} combos`}
          />
          <button className="primary-action" disabled={Boolean(unavailable) || !valid} onClick={submit} type="button">
            {unavailable ? "Combo no disponible" : <>{editing ? "Guardar cambios" : "Agregar combo"} <span>{formatArs(totalCents)}</span></>}
          </button>
        </div>
      </div>
    </div>
  );
}
