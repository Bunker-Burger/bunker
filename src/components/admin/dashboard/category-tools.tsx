"use client";

import { Check, CirclePlus, GripVertical, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import shared from "@/components/admin/shared/admin-shared.module.css";
import styles from "@/app/bunker/admin.module.css";
import { createCategoryAction, deleteCategoryAction, reorderCategoriesAction, updateCategoryAction } from "@/app/bunker/admin/catalogo/actions";
import { IDLE_FORM_STATE, type AdminFormState } from "@/app/bunker/admin/form-state";
import { QuickForm, QuickSubmit } from "./quick-form";
import { useDragOrder } from "./use-drag-order";

export interface DashboardCategory {
  id: string;
  name: string;
  slug: string;
  visible: boolean;
  /** "burger" | "sandwich" | "side" | "drink" | "other" (the Combos section), as `createCategoryAction` expects. */
  kind: string;
  productCount: number;
}

const KINDS = [
  { value: "burger", label: "Hamburguesas" },
  { value: "sandwich", label: "Sándwiches" },
  { value: "side", label: "Papas" },
  { value: "drink", label: "Bebidas" },
  { value: "other", label: "Combos (sin productos)" }
] as const;

/** Calls an admin action outside a form (drag and drop) and re-reads the panel when it worked. */
export function useOrderSaver(action: (state: AdminFormState, form: FormData) => Promise<AdminFormState>) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const saveOrder = (fields: Record<string, string | string[]>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
    }
    startTransition(async () => {
      const state = await action(IDLE_FORM_STATE, data);
      setMessage(state.status === "success" ? "" : (state.message ?? "No se pudo guardar el orden."));
      if (state.status === "success") router.refresh();
    });
  };
  return { saveOrder, message };
}

/**
 * The menu's sections in the panel (issue #54): pills in the menu's order, draggable by their grip,
 * a filter for the list, "+ Categoría", and rename / hide / delete for the selected one.
 */
export function CategoryTools({
  categories,
  totalProducts,
  selected,
  onSelect
}: {
  categories: DashboardCategory[];
  totalProducts: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { saveOrder, message } = useOrderSaver(reorderCategoriesAction);
  const { list, rowProps, handleProps } = useDragOrder(categories, (ids) => saveOrder({ categoryId: ids }));
  const [adding, setAdding] = useState(false);
  const current = categories.find((category) => category.id === selected) ?? null;

  return (
    <div className={styles.categoryTools}>
      <div aria-label="Categorías de la carta, en su orden" className={shared.categoryPills} role="group">
        <button aria-pressed={selected === null} onClick={() => onSelect(null)} type="button">
          Todas ({totalProducts})
        </button>
        {list.map((category, index) => (
          <span className={shared.categoryPill} data-hidden={!category.visible || undefined} key={category.id} {...rowProps(category.id)}>
            <button className={shared.pillGrip} {...handleProps(category.id, index, `Mover ${category.name}`)}>
              <GripVertical aria-hidden="true" size={14} />
            </button>
            <button aria-pressed={selected === category.id} onClick={() => onSelect(category.id)} type="button">
              {category.name}
              {category.visible ? null : <span className="sr-only"> (oculta)</span>}
            </button>
          </span>
        ))}
        <button aria-expanded={adding} className={shared.addCategory} onClick={() => setAdding((value) => !value)} type="button">
          <CirclePlus aria-hidden="true" size={14} /> Categoría
        </button>
      </div>
      {message ? (
        <p className={shared.quickError} role="alert">
          {message}
        </p>
      ) : null}

      {adding ? (
        <QuickForm action={createCategoryAction} className={styles.categoryForm} label="Nueva categoría">
          <input aria-label="Nombre de la categoría" className={shared.optionName} maxLength={60} name="name" placeholder="Ej: Clásicas" required />
          <select aria-label="Tipo de productos" className={shared.categorySelect} defaultValue="burger" name="kind">
            {KINDS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
          <input name="visible" type="hidden" value="true" />
          <QuickSubmit className={shared.smallAction}>Crear</QuickSubmit>
        </QuickForm>
      ) : null}

      {current ? (
        <div className={styles.categoryEdit} key={current.id}>
          <QuickForm action={updateCategoryAction} className={styles.categoryForm} label={`Editar ${current.name}`}>
            <input name="categoryId" type="hidden" value={current.id} />
            {/* The link stays the same when the category is renamed. */}
            <input name="slug" type="hidden" value={current.slug} />
            <input aria-label={`Nombre de ${current.name}`} className={shared.optionName} defaultValue={current.name} maxLength={60} name="name" required />
            <label className={shared.visibleCheck}>
              <input defaultChecked={current.visible} name="visible" type="checkbox" value="true" /> Visible en la carta
            </label>
            <QuickSubmit ariaLabel={`Guardar ${current.name}`} className={shared.smallAction}>
              <Check aria-hidden="true" size={14} /> Guardar
            </QuickSubmit>
          </QuickForm>
          {current.productCount === 0 ? (
            <QuickForm action={deleteCategoryAction} className={styles.categoryDelete} label={`Eliminar ${current.name}`}>
              <input name="categoryId" type="hidden" value={current.id} />
              <QuickSubmit ariaLabel={`Eliminar ${current.name}`} className={styles.dangerSmall}>
                <X aria-hidden="true" size={14} /> Eliminar categoría
              </QuickSubmit>
            </QuickForm>
          ) : (
            <p className={shared.hint}>Arrastrá los productos por su asa para ordenarlos en la carta. Para eliminar la categoría, primero dejala sin productos.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

