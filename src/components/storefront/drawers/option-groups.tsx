"use client";

import { Minus, Plus } from "lucide-react";
import { Fragment } from "react";
import { getApplicableOptionGroups } from "@/domain/catalog";
import { MAX_SAME_EXTRA } from "@/domain/options";
import type { Product, SelectedOptions } from "@/domain/types";
import { formatArs } from "@/lib/money";
import { clearOptionGroup, toggleOption } from "../storefront-state";

/**
 * Per extra, how many units carry at least 1, 2, 3… of it (2 patties on one burger, 1 on the rest).
 * Infinity is "all of them", so it follows the quantity; not set is one on every unit.
 */
export type ExtraLevels = Record<string, number[]>;
const levelsOf = (extraUnits: ExtraLevels, optionId: string, quantity: number) => (extraUnits[optionId] ?? [Infinity]).map((units) => Math.min(units, quantity));

/** A saved selection, where repeating an extra means several of it, as the detail's state: each extra once, plus how many. */
export function splitRepeats(options: SelectedOptions): { selected: SelectedOptions; extraUnits: ExtraLevels } {
  const selected: SelectedOptions = {};
  const extraUnits: ExtraLevels = {};
  for (const [groupId, ids] of Object.entries(options)) {
    const unique = [...new Set(ids)];
    selected[groupId] = unique;
    for (const id of unique) {
      const times = ids.filter((optionId) => optionId === id).length;
      if (times > 1) extraUnits[id] = Array.from({ length: times }, () => Infinity);
    }
  }
  return { selected, extraUnits };
}

/** Paid extras of a selection, with "×2" when the same one is repeated. */
export function paidExtraNames(product: Product, options: SelectedOptions): string[] {
  return getApplicableOptionGroups(product).flatMap((group) =>
    group.options.flatMap((option) => {
      const times = (options[group.id] ?? []).filter((id) => id === option.id).length;
      return times > 0 && option.priceDeltaCents > 0n ? [times > 1 ? `${option.name} ×${times}` : option.name] : [];
    })
  );
}

/** The units of a line grouped by what each carries: the first units take the extras, as many of each as its levels say. */
export function unitGroupsOf(product: Product, selected: SelectedOptions, quantity: number, extraUnits: ExtraLevels) {
  const applicable = getApplicableOptionGroups(product);
  const groups = new Map<string, { selected: SelectedOptions; quantity: number }>();
  for (let unit = 0; unit < quantity; unit += 1) {
    const options: SelectedOptions = {};
    for (const [groupId, ids] of Object.entries(selected)) {
      const multiple = applicable.find((group) => group.id === groupId)?.selectionMode === "multiple";
      options[groupId] = multiple ? ids.flatMap((id) => Array.from({ length: levelsOf(extraUnits, id, quantity).filter((units) => unit < units).length }, () => id)) : ids;
    }
    const key = JSON.stringify(options);
    const found = groups.get(key);
    if (found) found.quantity += 1;
    else groups.set(key, { selected: options, quantity: 1 });
  }
  return [...groups.values()];
}

/**
 * How many of a chosen extra (2 eggs) and, with several units, on how many of them: one row per
 * level, so 3 burgers can carry one extra patty each and one of them a second one.
 */
function ExtraAmount({ option, quantity, extraUnits, setExtraUnits }: {
  option: { id: string; name: string; priceDeltaCents: bigint };
  quantity: number;
  extraUnits: ExtraLevels;
  setExtraUnits: (update: (current: ExtraLevels) => ExtraLevels) => void;
}) {
  const raw = extraUnits[option.id] ?? [Infinity];
  const levels = levelsOf(extraUnits, option.id, quantity);
  const setLevels = (next: number[]) =>
    setExtraUnits((current) => {
      const copy = { ...current };
      if (next.length === 1 && next[0] === Infinity) delete copy[option.id];
      else copy[option.id] = next;
      return copy;
    });
  const setLevel = (index: number, units: number) => {
    const ceiling = index === 0 ? quantity : levels[index - 1]!;
    const next = [...raw];
    // Reaching the ceiling keeps following it (all units, or all those with one less).
    next[index] = units >= ceiling ? (index === 0 ? Infinity : raw[index - 1]!) : units;
    for (let after = index + 1; after < next.length; after += 1) next[after] = Math.min(next[after]!, next[index]!);
    setLevels(next);
  };
  const total = levels.reduce((sum, units) => sum + units, 0);
  return (
    <>
      <div className="option-units">
        <span className="option-units-label">{quantity > 1 ? "Cantidad por unidad" : "Cantidad"}</span>
        <div aria-label={`Cantidad de ${option.name}`} className="option-units-stepper" role="group">
          <button aria-label={`Una ${option.name} menos`} disabled={levels.length <= 1} onClick={() => setLevels(raw.slice(0, -1))} type="button">
            <Minus aria-hidden="true" />
          </button>
          <strong>{levels.length}</strong>
          <button aria-label={`Una ${option.name} más`} disabled={levels.length >= MAX_SAME_EXTRA} onClick={() => setLevels([...raw, raw.at(-1)!])} type="button">
            <Plus aria-hidden="true" />
          </button>
        </div>
        {option.priceDeltaCents > 0n ? <strong className="option-units-cost">+ {formatArs(option.priceDeltaCents * BigInt(total))}</strong> : null}
      </div>
      {quantity > 1
        ? levels.map((units, index) => {
            const nth = levels.length > 1 ? `${index + 1}× ` : "";
            const ceiling = index === 0 ? quantity : levels[index - 1]!;
            const name = index === 0 ? option.name : `${option.name} ×${index + 1}`;
            return (
              <div className="option-units" key={index}>
                <span className="option-units-label">{units === quantity ? `${nth}En las ${quantity}` : `${nth}En ${units} de ${quantity}`}</span>
                <div aria-label={`Unidades con ${name}`} className="option-units-stepper" role="group">
                  <button aria-label={`Quitar ${name} de una unidad`} disabled={units <= 1} onClick={() => setLevel(index, units - 1)} type="button">
                    <Minus aria-hidden="true" />
                  </button>
                  <strong>{units}</strong>
                  <button aria-label={`Poner ${name} en una unidad más`} disabled={units >= ceiling} onClick={() => setLevel(index, units + 1)} type="button">
                    <Plus aria-hidden="true" />
                  </button>
                </div>
                {index === 0 && units < quantity ? (
                  <button className="option-units-all" onClick={() => setLevel(0, quantity)} type="button">
                    Todas
                  </button>
                ) : null}
              </div>
            );
          })
        : null}
    </>
  );
}

/** The option groups of a product (size, extras…), with how many of the units carry each extra. */
export function OptionGroups({ product, selected, setSelected, quantity, extraUnits, setExtraUnits, namePrefix = "" }: {
  product: Product;
  /** Keeps the inputs of two products of a combo apart: radios of the same group id would otherwise be one group. */
  namePrefix?: string;
  selected: SelectedOptions;
  setSelected: (update: (current: SelectedOptions) => SelectedOptions) => void;
  quantity: number;
  extraUnits: ExtraLevels;
  setExtraUnits: (update: (current: ExtraLevels) => ExtraLevels) => void;
}) {
  const applicableGroups = getApplicableOptionGroups(product);
  return (
    <>
          {applicableGroups.map((group) => {
            const groupSelections = selected[group.id] ?? [];
            const isOptionalSingle = group.selectionMode === "single" && !group.required;
            // Few exclusive choices read as tiles side by side (size, medallions); the rest as a list.
            const tiles = group.selectionMode === "single" && group.required && group.options.length <= 3;
            // Extras without a real cap (issue #54): the customer adds as many as they want.
            const unlimited = group.maxSelections >= group.options.length;
            return (
              <fieldset className="drawer-card option-group" key={group.id}>
                <legend>
                  <span className="option-group-title">
                    <span>{group.name}</span>
                    <small>{group.selectionMode === "single" ? "Elegí una opción" : unlimited ? "Sumá los que quieras" : `Podés sumar hasta ${group.maxSelections}`}</small>
                  </span>
                  <span className="option-group-meta">
                    {isOptionalSingle && groupSelections.length > 0 ? (
                      <button
                        aria-label={`Limpiar ${group.name}`}
                        className="clear-option-button"
                        onClick={() => setSelected((current) => clearOptionGroup(current, group.id))}
                        type="button"
                      >
                        Limpiar
                      </button>
                    ) : null}
                    <small className="option-badge">{group.required ? "Requerido" : unlimited ? "Opcional" : `Hasta ${group.maxSelections}`}</small>
                  </span>
                </legend>
                <div className={tiles ? "option-tiles" : "option-list"}>
                  {group.options.map((option) => {
                    const checked = groupSelections.includes(option.id);
                    const inputType = group.selectionMode === "single" ? "radio" : "checkbox";
                    const isAvailable = option.available;
                    const row = (
                      <label className={`option-row${checked ? " selected" : ""}${!isAvailable ? " unavailable" : ""}`}>
                        <span>{option.name}{!isAvailable ? <small> (Sin stock)</small> : null}</span>
                        {option.priceDeltaCents > 0n ? <strong>+ {formatArs(option.priceDeltaCents)}</strong> : <small>Incluido</small>}
                        <input
                          checked={checked}
                          disabled={!isAvailable}
                          name={`${namePrefix}${group.id}`}
                          onChange={() => {
                            if (!isAvailable) return;
                            setExtraUnits((current) => {
                              const next = { ...current };
                              delete next[option.id];
                              return next;
                            });
                            setSelected((current) =>
                              toggleOption(current, group.id, option.id, group.maxSelections, isAvailable, group.selectionMode, group.required)
                            );
                          }}
                          onClick={() => {
                            if (isOptionalSingle && checked && isAvailable) {
                              setSelected((current) =>
                                toggleOption(current, group.id, option.id, group.maxSelections, isAvailable, group.selectionMode, group.required)
                              );
                            }
                          }}
                          type={inputType}
                        />
                      </label>
                    );
                    return (
                      <Fragment key={option.id}>
                        {row}
                        {checked && group.selectionMode === "multiple" ? (
                          <ExtraAmount extraUnits={extraUnits} option={option} quantity={quantity} setExtraUnits={setExtraUnits} />
                        ) : null}
                      </Fragment>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
    </>
  );
}
