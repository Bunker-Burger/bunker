"use client";

import { useState } from "react";
import styles from "../../admin.module.css";
import { saveProductAction } from "./actions";
import { AdminForm, CheckboxField, FieldError, SelectField, TextAreaField, TextField } from "./admin-form";

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
  options: Array<{ id: string; name: string; priceDelta: string | null; available: boolean }>;
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
    <AdminForm action={action} submitLabel={product ? "Guardar producto" : "Crear producto"}>
      {product ? <input name="productId" type="hidden" value={product.id} /> : null}

      <SelectField label="Categoría" name="categoryId" onChange={(event) => setCategoryId(event.target.value)} value={categoryId}>
        {categories.map((category) => (
          <option key={category.id} value={category.id}>
            {category.name === category.tabLabel ? category.name : `${category.tabLabel} · ${category.name}`}
          </option>
        ))}
      </SelectField>

      <TextField defaultValue={product?.name} label="Nombre" maxLength={100} name="name" required />
      <TextField defaultValue={product?.slug} hint="Aparece en el enlace del producto. Se genera del nombre si lo dejás vacío." label="Slug" maxLength={80} name="slug" />
      <TextAreaField defaultValue={product?.description} hint="Obligatoria para publicar." label="Descripción" maxLength={1000} name="description" rows={3} />
      <TextField
        defaultValue={product?.price}
        hint="En pesos, sin separador de miles. Mayor a cero para publicar."
        inputMode="decimal"
        label="Precio"
        min={0}
        name="price"
        required
        step="0.01"
        type="number"
      />

      <div className={styles.checkGroup}>
        <CheckboxField defaultChecked={product?.inStock ?? true} label="Con stock" name="inStock" hint="Sin stock se muestra como agotado." />
        <CheckboxField defaultChecked={product?.featured ?? false} label="Destacado" name="featured" />
        <CheckboxField defaultChecked={product?.published ?? false} hint="Sólo se publica si la configuración es válida." label="Publicado" name="published" />
      </div>
      {type === "beverage" ? <p className={styles.hint}>Las bebidas se guardan siempre sin alcohol.</p> : null}

      <fieldset className={styles.fieldset}>
        <legend>Opciones</legend>
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
                  {group.options.map((option) => (
                    <label className={styles.checkField} key={option.id}>
                      <input
                        defaultChecked={groupDefaults.has(option.id)}
                        disabled={!option.available && !groupDefaults.has(option.id)}
                        name={`default:${group.id}`}
                        type={group.selectionMode === "single" ? "radio" : "checkbox"}
                        value={option.id}
                      />
                      <span>
                        {option.name}
                        {option.priceDelta ? ` (+${option.priceDelta})` : null}
                        {option.available ? null : " — sin stock"}
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : null}
            </div>
          );
        })}
      </fieldset>
    </AdminForm>
  );
}
