"use client";

import { CupSoda, GripVertical, Hamburger, Popcorn, Sandwich, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import shared from "@/components/admin/shared/admin-shared.module.css";
import styles from "@/app/bunker/admin.module.css";
import { saveProductAction } from "@/app/bunker/admin/catalogo/actions";
import { PhotoField, type PhotoValue } from "./photo-field";
import { ProductPreview, type PhotoView } from "./product-preview";
import { AdminForm, CheckboxField, FieldError, TextAreaField, TextField } from "@/components/admin/shared/admin-form";
import { PriceField } from "@/components/admin/dashboard/quick-form";
import { reorderOptionsAction } from "@/app/bunker/admin/catalogo/actions";
import { IDLE_FORM_STATE } from "@/app/bunker/admin/catalogo/form-state";

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
  /** The photo card, first as in the capture; absent in contexts without uploads. */
  photo?: PhotoValue;
}

/** "PAPAS" and "Papas" are the same label: the type's name is only added to the category's when they differ. */
const sameLabel = (a: string, b: string) => a.trim().toLocaleLowerCase("es") === b.trim().toLocaleLowerCase("es");

/** Icons of the capture's product selector, by the type the category gives its products. */
const CATEGORY_ICONS: Record<string, LucideIcon> = { burger: Hamburger, sandwich: Sandwich, fries: Popcorn, beverage: CupSoda };

/**
 * Product editor. Option groups are listed for the type of the chosen category only; the
 * server validates everything again and refuses to publish an invalid configuration.
 */
export function ProductForm({ categories, optionGroups, product, defaultCategoryId, action = saveProductAction, photo }: ProductFormProps) {
  // A default that is not a product category (the Combos section) falls back to the first one.
  const initialCategory = [product?.categoryId, defaultCategoryId].find((id) => id && categories.some((category) => category.id === id));
  const [categoryId, setCategoryId] = useState(initialCategory ?? categories[0]?.id ?? "");
  const [photoView, setPhotoView] = useState<PhotoView>({ url: photo?.url ?? null, focal: photo?.focal ?? { x: 50, y: 50 } });
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
  // Extras and types are edited right in this form and saved by its button: only the rows touched are sent.
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const touch = (groupId: string, optionId: string) =>
    setTouched((current) => (current.has(`${groupId}|${optionId}`) ? current : new Set(current).add(`${groupId}|${optionId}`)));

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
      {[...touched].map((entry) => (
        <input key={entry} name="touchedOption" type="hidden" value={entry} />
      ))}
      {photo ? <PhotoField onView={setPhotoView} key={`${photo.url ?? ""}-${photo.focal?.x ?? ""}-${photo.focal?.y ?? ""}`} hint="Se ve en la tarjeta del producto en la carta." legend="Foto del producto" photo={photo} replaceLabel="Reemplazar foto" uploadLabel="Subir foto del producto" /> : null}

      <fieldset className={shared.formCard}>
        <legend>
          Información básica <small className={shared.requiredTag}>Requerido *</small>
        </legend>
        <fieldset className={shared.choicePills}>
          <legend>
            Categoría <span className={styles.activeTag}>Selección activa</span>
          </legend>
          <FieldError id="categoryId-error" name="categoryId" />
          <div>
            {categories.map((category) => {
              const Icon = CATEGORY_ICONS[category.type] ?? UtensilsCrossed;
              return (
                <label className={category.id === categoryId ? shared.choicePillActive : shared.choicePill} key={category.id}>
                  <input checked={category.id === categoryId} name="categoryId" onChange={() => setCategoryId(category.id)} type="radio" value={category.id} />
                  <Icon aria-hidden="true" size={20} />
                  {sameLabel(category.name, category.tabLabel) ? category.name : `${category.tabLabel} · ${category.name}`}
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

      <fieldset className={shared.formCard}>
        <legend>Opciones de personalización</legend>
        <FieldError id="optionGroups-error" name="optionGroups" />
        {applicable.length === 0 ? <p className={shared.hint}>No hay grupos de opciones para este tipo de producto.</p> : null}
        {applicable.map((group) => {
          const isAssigned = assigned.has(group.id);
          const groupDefaults = defaults.get(group.id) ?? new Set<string>();
          return (
            <div className={styles.optionGroup} key={group.id}>
              <div className={shared.checkField}>
                <input
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
              </div>
              {isAssigned ? (
                <fieldset className={shared.defaults}>
                  <legend>Opciones de {group.name}</legend>
                  <p className={shared.hint}>
                    {group.selectionMode === "single"
                      ? "En la carta se muestran todas; el cliente elige una. La marcada como “Por defecto” viene elegida."
                      : "En la carta se muestran todas; el cliente suma las que quiera. Las marcadas como “Por defecto” vienen incluidas."}
                  </p>
                  {group.selectionMode === "single" && !group.required ? (
                    <label className={shared.checkField}>
                      <input defaultChecked={groupDefaults.size === 0} name={`default:${group.id}`} type="radio" value="" />
                      <span>Ninguna por defecto</span>
                    </label>
                  ) : null}
                  {ordered(group).map((option, index) => (
                    <div
                      className={shared.variantRow}
                      data-dragging={dragging?.optionId === option.id || undefined}
                      draggable={armed === option.id}
                      key={option.id}
                      // Anything edited in the row except the product's own "Por defecto" choice is an edit of the option.
                      onChange={(event) => {
                        if (!(event.target instanceof HTMLInputElement) || !event.target.name.startsWith("default:")) touch(group.id, option.id);
                      }}
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
                        className={shared.dragHandle}
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
                      <label className={shared.defaultChip}>
                        <input
                          aria-label={`${option.name} por defecto${option.available ? "" : " (sin stock)"}`}
                          defaultChecked={groupDefaults.has(option.id)}
                          disabled={!option.available && !groupDefaults.has(option.id)}
                          name={`default:${group.id}`}
                          type={group.selectionMode === "single" ? "radio" : "checkbox"}
                          value={option.id}
                        />
                        <span aria-hidden="true">Por defecto</span>
                      </label>
                      {/* Name, price and availability of the option: saved with "Guardar producto". */}
                      <span className={shared.variantName}>
                        <input
                          aria-label={`Nombre de ${option.name}`}
                          className={shared.optionName}
                          defaultValue={option.name}
                          maxLength={80}
                          name={`optionName:${option.id}`}
                        />
                        {option.available ? null : <span className={shared.badgeMuted}>Sin stock</span>}
                      </span>
                      <PriceField defaultValue={option.price} label={`Precio extra de ${option.name}`} name={`optionPrice:${option.id}`} />
                      <span className={shared.variantActions}>
                        <label className={styles.variantAvailable}>
                          <input
                            aria-label={`${option.name} disponible`}
                            defaultChecked={option.available}
                            name={`optionAvailable:${option.id}`}
                            type="checkbox"
                            value="true"
                          />
                        </label>
                      </span>
                    </div>
                  ))}
                  {orderMessage[group.id] ? (
                    <p className={shared.quickError} role="alert">
                      {orderMessage[group.id]}
                    </p>
                  ) : null}
                </fieldset>
              ) : null}
              {isAssigned ? (
                <div className={styles.variantNew}>
                  <input name="newOptionGroup" type="hidden" value={group.id} />
                  <input
                    aria-label={`Nombre de la nueva opción de ${group.name}`}
                    className={shared.optionName}
                    maxLength={80}
                    name={`newOptionName:${group.id}`}
                    placeholder={group.selectionMode === "single" ? "Nueva opción. Ej: Doble (2× 100g)" : "Nueva opción. Ej: Medallón extra"}
                  />
                  <PriceField defaultValue="" label={`Precio extra de la nueva opción de ${group.name}`} name={`newOptionPrice:${group.id}`} />
                  <small className={shared.hint}>Se agrega al guardar el producto.</small>
                </div>
              ) : null}
            </div>
          );
        })}
      </fieldset>

      <fieldset className={shared.formCard}>
        <legend>Estado y stock en cocina</legend>
        <div className={shared.checkGroup}>
          <CheckboxField defaultChecked={product?.inStock ?? true} label="Con stock" name="inStock" hint="Sin stock se muestra como agotado." />
          <CheckboxField defaultChecked={product?.featured ?? false} label="Destacado" name="featured" />
          <CheckboxField defaultChecked={product?.published ?? false} hint="Sólo se publica si la configuración es válida." label="Publicado" name="published" />
        </div>
        {type === "beverage" ? <p className={shared.hint}>Las bebidas se guardan siempre sin alcohol.</p> : null}
      </fieldset>

      <ProductPreview categories={categories} photo={photoView} />
    </AdminForm>
    </>
  );
}
