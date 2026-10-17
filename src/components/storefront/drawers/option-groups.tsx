"use client";

import { Minus, Plus } from "lucide-react";
import { Fragment } from "react";
import { getApplicableOptionGroups } from "@/domain/catalog";
import type { Product, SelectedOptions } from "@/domain/types";
import { formatArs } from "@/lib/money";
import { clearOptionGroup, toggleOption } from "../storefront-state";

/** How many units of a line carry each extra: all of them unless the customer lowered it. */
const unitsWithExtra = (extraUnits: Record<string, number>, optionId: string, quantity: number) => Math.min(extraUnits[optionId] ?? quantity, quantity);

/** The units of a line grouped by what each carries: the first units take the extras, up to each extra's count. */
export function unitGroupsOf(product: Product, selected: SelectedOptions, quantity: number, extraUnits: Record<string, number>) {
  const applicable = getApplicableOptionGroups(product);
  const groups = new Map<string, { selected: SelectedOptions; quantity: number }>();
  for (let unit = 0; unit < quantity; unit += 1) {
    const options: SelectedOptions = {};
    for (const [groupId, ids] of Object.entries(selected)) {
      const multiple = applicable.find((group) => group.id === groupId)?.selectionMode === "multiple";
      options[groupId] = multiple ? ids.filter((id) => unit < unitsWithExtra(extraUnits, id, quantity)) : ids;
    }
    const key = JSON.stringify(options);
    const found = groups.get(key);
    if (found) found.quantity += 1;
    else groups.set(key, { selected: options, quantity: 1 });
  }
  return [...groups.values()];
}

/** The option groups of a product (size, extras…), with how many of the units carry each extra. */
export function OptionGroups({ product, selected, setSelected, quantity, extraUnits, setExtraUnits, namePrefix = "" }: {
  product: Product;
  /** Keeps the inputs of two products of a combo apart: radios of the same group id would otherwise be one group. */
  namePrefix?: string;
  selected: SelectedOptions;
  setSelected: (update: (current: SelectedOptions) => SelectedOptions) => void;
  quantity: number;
  extraUnits: Record<string, number>;
  setExtraUnits: (update: (current: Record<string, number>) => Record<string, number>) => void;
}) {
  const applicableGroups = getApplicableOptionGroups(product);
  const unitsWith = (optionId: string) => unitsWithExtra(extraUnits, optionId, quantity);
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
                        {checked && group.selectionMode === "multiple" && quantity > 1 ? (
                          <div className="option-units">
                            <span className="option-units-label">
                              {unitsWith(option.id) === quantity ? `En las ${quantity}` : `En ${unitsWith(option.id)} de ${quantity}`}
                            </span>
                            <div aria-label={`Unidades con ${option.name}`} className="option-units-stepper" role="group">
                              <button
                                aria-label={`Quitar ${option.name} de una unidad`}
                                disabled={unitsWith(option.id) <= 1}
                                onClick={() => setExtraUnits((current) => ({ ...current, [option.id]: Math.max(1, unitsWith(option.id) - 1) }))}
                                type="button"
                              >
                                <Minus aria-hidden="true" />
                              </button>
                              <strong>{unitsWith(option.id)}</strong>
                              <button
                                aria-label={`Poner ${option.name} en una unidad más`}
                                disabled={unitsWith(option.id) >= quantity}
                                onClick={() => setExtraUnits((current) => ({ ...current, [option.id]: Math.min(quantity, unitsWith(option.id) + 1) }))}
                                type="button"
                              >
                                <Plus aria-hidden="true" />
                              </button>
                            </div>
                            {unitsWith(option.id) < quantity ? (
                              <button
                                className="option-units-all"
                                onClick={() =>
                                  setExtraUnits((current) => {
                                    const next = { ...current };
                                    delete next[option.id];
                                    return next;
                                  })
                                }
                                type="button"
                              >
                                Todas
                              </button>
                            ) : null}
                            {option.priceDeltaCents > 0n ? <strong className="option-units-cost">+ {formatArs(option.priceDeltaCents * BigInt(unitsWith(option.id)))}</strong> : null}
                          </div>
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
