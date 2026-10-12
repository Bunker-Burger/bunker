"use client";

import { CirclePlus, CupSoda, GripVertical, Hamburger, Popcorn, Sandwich, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import styles from "../../admin.module.css";
import { saveProductAction } from "./actions";
import { AdminForm, CheckboxField, FieldError, TextAreaField, TextField } from "../admin-form";
import { PriceField, QuickForm } from "../quick-form";
import { reorderOptionsAction, saveOptionAction } from "./actions";
import { IDLE_FORM_STATE } from "./form-state";

export interface ProductFormCategory {
  id: string;
  name: string;
  /** Product type the category gives its products ("burger", "beverage", …). */
  type: string;
  tabLabel: string;
}

export interface ProductFormOptionGroup {
  id: string;
  name: string;
  selectionMode: "single" | "multiple";
  required: boolean;
  minSelections: number;
  maxSelections: number;
  applicableTypes: string[];
  options: Array<{ id: string; name: string; priceDelta: string | null; price: string; available: boolean }>;
}

export interface ProductFormValues {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  description: string;
  /** Pesos as the number input expects them ("7800" or "7800.5"). */
  price: string;
  inStock: boolean;
  featured: boolean;
  published: boolean;
  optionGroups: Array<{ groupId: string; defaultOptionIds: string[] }>;
}

interface ProductFormProps {
  categories: ProductFormCategory[];
  optionGroups: ProductFormOptionGroup[];
  product?: ProductFormValues;
  defaultCategoryId?: string;
  action?: typeof saveProductAction;
}

/** Icons of the capture's product selector, by the type the category gives its products. */
const CATEGORY_ICONS: Record<string, LucideIcon> = { burger: Hamburger, sandwich: Sandwich, fries: Popcorn, beverage: CupSoda };

function rule(group: ProductFormOptionGroup) {
  const parts = [group.required ? "Obligatorio" : "Opcional"];
  parts.push(group.selectionMode === "single" ? "una opción" : `de ${group.minSelections} a ${group.maxSelections} opciones`);
  return parts.join(", ");
}

/**
 * Product editor. Option groups are listed for the type of the chosen category only; the
 * server validates everything again and refuses to publish an invalid configuration.
 */
export function ProductForm({ categories, optionGroups, product, defaultCategoryId, action = saveProductAction }: ProductFormProps) {
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? defaultCategoryId ?? categories[0]?.id ?? "");
  const [assigned, setAssigned] = useState<Set<string>>(() => new Set(product?.optionGroups.map((link) => link.groupId)));

  // Options can be dragged (or moved with the arrow keys on their handle) to set their order;
  // the new order is saved as soon as the drag ends and applies to every product of the group.
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [optionOrder, setOptionOrder] = useState<Record<string, string[]>>({});
  const [orderMessage, setOrderMessage] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState<{ groupId: string; optionId: string } | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const ordered = (group: ProductFormOptionGroup) => {
    const ids = optionOrder[group.id];
    if (!ids) return group.options;
    const byId = new Map(group.options.map((option) => [option.id, option]));
    const listed = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    return [...listed, ...group.options.filter((option) => !ids.includes(option.id))];
  };
  const move = (group: ProductFormOptionGroup, optionId: string, to: number) => {
    const ids = ordered(group).map((option) => option.id);
    const from = ids.indexOf(optionId);
    if (from < 0 || to < 0 || to >= ids.length || from === to) return null;
    ids.splice(to, 0, ...ids.splice(from, 1));
    setOptionOrder((current) => ({ ...current, [group.id]: ids }));
    return ids;
  };
  const saveOrder = (group: ProductFormOptionGroup, ids: string[]) => {
    if (ids.join() === group.options.map((option) => option.id).join()) return;
    const data = new FormData();
    data.set("groupId", group.id);
    for (const id of ids) data.append("optionId", id);
    startTransition(async () => {
      const state = await reorderOptionsAction(IDLE_FORM_STATE, data);
      setOrderMessage((current) => ({ ...current, [group.id]: state.status === "success" ? "" : (state.message ?? "No se pudo guardar el orden.") }));
      if (state.status === "success") router.refresh();
    });
  };
  const defaults = new Map(product?.optionGroups.map((link) => [link.groupId, new Set(link.defaultOptionIds)]));

  const type = categories.find((category) => category.id === categoryId)?.type;
  const applicable = optionGroups.filter((group) => type !== undefined && group.applicableTypes.includes(type));

  const toggle = (groupId: string, on: boolean) =>
    setAssigned((current) => {
      const next = new Set(current);
      if (on) next.add(groupId);
      else next.delete(groupId);
      return next;
    });

  return (
    <>
    <AdminForm action={action} submitLabel={product ? "Guardar producto" : "Crear producto"}>
      {product ? <input name="productId" type="hidden" value={product.id} /> : null}

      <fieldset className={styles.formCard}>
        <legend>
          Información básica <small className={styles.requiredTag}>Requerido *</small>
        </legend>
        <fieldset className={styles.choicePills}>
          <legend>
            Categoría <span className={styles.activeTag}>Selección activa</span>
          </legend>
          <FieldError id="categoryId-error" name="categoryId" />
          <div>
            {categories.map((category) => {
              const Icon = CATEGORY_ICONS[category.type] ?? UtensilsCrossed;
              return (
                <label className={category.id === categoryId ? styles.choicePillActive : styles.choicePill} key={category.id}>
                  <input checked={category.id === categoryId} name="categoryId" onChange={() => setCategoryId(category.id)} type="radio" value={category.id} />
                  <Icon aria-hidden="true" size={20} />
                  {category.name === category.tabLabel ? category.name : `${category.tabLabel} · ${category.name}`}
                </label>
              );
            })}
          </div>
        </fieldset>

        <TextField defaultValue={product?.name} label="Nombre" maxLength={100} name="name" required />
        {/* The link is made from the name when created and kept when renamed, so shared links keep working. */}
        {product ? <input name="slug" type="hidden" value={product.slug} /> : null}
        <TextAreaField defaultValue={product?.description} hint="Obligatoria para publicar." label="Descripción" maxLength={1000} name="description" rows={3} />
        <TextField
          defaultValue={product?.price}
          hint="En pesos, sin separador de miles. Mayor a cero para publicar."
          inputMode="decimal"
          label="Precio base"
          min={0}
          name="price"
          prefix="$"
          required
          step="0.01"
          type="number"
        />
      </fieldset>

      <fieldset className={styles.formCard}>
        <legend>Opciones de personalización</legend>
        <FieldError id="optionGroups-error" name="optionGroups" />
        {applicable.length === 0 ? <p className={styles.hint}>No hay grupos de opciones para este tipo de producto.</p> : null}
        {applicable.map((group) => {
          const isAssigned = assigned.has(group.id);
          const groupDefaults = defaults.get(group.id) ?? new Set<string>();
          return (
            <div className={styles.optionGroup} key={group.id}>
              <div className={styles.checkField}>
                <input
                  aria-describedby={`rule-${group.id}`}
                  checked={isAssigned}
                  id={`offer-${group.id}`}
                  name="optionGroup"
                  onChange={(event) => toggle(group.id, event.target.checked)}
                  type="checkbox"
                  value={group.id}
                />
                <label htmlFor={`offer-${group.id}`}>
                  Ofrecer <strong>{group.name}</strong>
                </label>
                <span className={styles.selectionTag} aria-hidden="true">{group.selectionMode === "single" ? "Selección única" : "Opcional"}</span>
                <small className={styles.hint} id={`rule-${group.id}`}>{rule(group)}</small>
              </div>
              {isAssigned ? (
                <fieldset className={styles.defaults}>
                  <legend>Por defecto en {group.name}</legend>
                  {group.selectionMode === "single" && !group.required ? (
                    <label className={styles.checkField}>
                      <input defaultChecked={groupDefaults.size === 0} name={`default:${group.id}`} type="radio" value="" />
                      <span>Ninguna</span>
                    </label>
                  ) : null}
                  {ordered(group).map((option, index) => (
                    <div
                      className={styles.variantRow}
                      data-dragging={dragging?.optionId === option.id || undefined}
                      draggable={armed === option.id}
                      key={option.id}
                      onDragEnd={() => {
                        if (dragging?.groupId === group.id) saveOrder(group, ordered(group).map((candidate) => candidate.id));
                        setDragging(null);
                        setArmed(null);
                      }}
                      onDragOver={(event) => {
                        if (dragging?.groupId !== group.id) return;
                        event.preventDefault();
                        if (dragging.optionId !== option.id) move(group, dragging.optionId, index);
                      }}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", option.id);
                        setDragging({ groupId: group.id, optionId: option.id });
                      }}
                    >
                      <button
                        aria-label={`Mover ${option.name} (flechas arriba y abajo)`}
                        className={styles.dragHandle}
                        onKeyDown={(event) => {
                          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                          event.preventDefault();
                          const ids = move(group, option.id, index + (event.key === "ArrowUp" ? -1 : 1));
                          if (ids) saveOrder(group, ids);
                        }}
                        onPointerDown={() => setArmed(option.id)}
                        onPointerUp={() => setArmed(null)}
                        type="button"
                      >
                        <GripVertical aria-hidden="true" size={18} />
                      </button>
                      <input
                        aria-label={`${option.name} por defecto${option.available ? "" : " (sin stock)"}`}
                        defaultChecked={groupDefaults.has(option.id)}
                        disabled={!option.available && !groupDefaults.has(option.id)}
                        name={`default:${group.id}`}
                        type={group.selectionMode === "single" ? "radio" : "checkbox"}
                        value={option.id}
                      />
                      {/* Name and price of the option: saved by its own form (below), not by "Guardar producto". */}
                      <span className={styles.variantName}>
                        <input
                          aria-label={`Nombre de ${option.name}`}
                          className={styles.optionName}
                          defaultValue={option.name}
                          form={`option-${option.id}`}
                          maxLength={80}
                          name="name"
                        />
                        {option.available ? null : <span className={styles.badgeMuted}>Sin stock</span>}
                      </span>
                      <PriceField defaultValue={option.price} form={`option-${option.id}`} label={`Precio extra de ${option.name}`} name="price" />
                      <label className={styles.variantAvailable}>
                        <input
                          aria-label={`${option.name} disponible`}
                          defaultChecked={option.available}
                          form={`option-${option.id}`}
                          name="available"
                          onChange={(event) => event.currentTarget.form?.requestSubmit()}
                          type="checkbox"
                          value="true"
                        />
                      </label>
                      <button aria-label={`Guardar ${option.name}`} className={styles.smallAction} form={`option-${option.id}`} type="submit">
                        Guardar
                      </button>
                    </div>
                  ))}
                  {orderMessage[group.id] ? (
                    <p className={styles.quickError} role="alert">
                      {orderMessage[group.id]}
                    </p>
                  ) : null}
                </fieldset>
              ) : null}
              {isAssigned ? (
                <div className={styles.variantNew}>
                  <input
                    aria-label={`Nombre de la nueva opción de ${group.name}`}
                    className={styles.optionName}
                    form={`new-option-${group.id}`}
                    maxLength={80}
                    name="name"
                    placeholder={group.selectionMode === "single" ? "Ej: Doble (2× 100g)" : "Ej: Medallón extra"}
                  />
                  <PriceField defaultValue="" form={`new-option-${group.id}`} label={`Precio extra de la nueva opción de ${group.name}`} name="price" />
                  <button className={styles.addOptionAction} form={`new-option-${group.id}`} type="submit">
                    <CirclePlus aria-hidden="true" size={16} /> Añadir
                  </button>
                </div>
              ) : null}
            </div>
          );
        })}
      </fieldset>

      <fieldset className={styles.formCard}>
        <legend>Estado y stock en cocina</legend>
        <div className={styles.checkGroup}>
          <CheckboxField defaultChecked={product?.inStock ?? true} label="Con stock" name="inStock" hint="Sin stock se muestra como agotado." />
          <CheckboxField defaultChecked={product?.featured ?? false} label="Destacado" name="featured" />
          <CheckboxField defaultChecked={product?.published ?? false} hint="Sólo se publica si la configuración es válida." label="Publicado" name="published" />
        </div>
        {type === "beverage" ? <p className={styles.hint}>Las bebidas se guardan siempre sin alcohol.</p> : null}
      </fieldset>
    </AdminForm>
    {/* Forms of the option rows above: HTML ties each row's fields to them with the form attribute. */}
    {applicable
      .filter((group) => assigned.has(group.id))
      .map((group) => (
        <div className={styles.optionForms} key={group.id}>
          {group.options.map((option) => (
            <QuickForm action={saveOptionAction} id={`option-${option.id}`} key={option.id} label={`Precio de ${option.name}`}>
              <input name="groupId" type="hidden" value={group.id} />
              <input name="optionId" type="hidden" value={option.id} />
            </QuickForm>
          ))}
          <QuickForm action={saveOptionAction} id={`new-option-${group.id}`} label={`Nueva opción en ${group.name}`}>
            <input name="groupId" type="hidden" value={group.id} />
            <input name="available" type="hidden" value="true" />
          </QuickForm>
        </div>
      ))}
    </>
  );
}
