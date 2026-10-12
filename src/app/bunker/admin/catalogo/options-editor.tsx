"use client";

import { CirclePlus } from "lucide-react";
import styles from "../../admin.module.css";
import { PriceField, QuickForm, QuickSubmit, QuickToggle } from "../quick-form";
import { saveOptionAction } from "./actions";

export interface EditableOptionGroup {
  id: string;
  name: string;
  selection: string;
  appliesTo: string;
  options: Array<{ id: string; name: string; price: string; available: boolean }>;
}

/**
 * Options and their extra price, per group (issue #54): the store sets what one more medallion or
 * an extra topping costs, renames a choice or pauses it, and adds new ones. Groups are shared by
 * every product that offers them, so a price changes for all of them.
 */
export function OptionsEditor({ groups }: { groups: EditableOptionGroup[] }) {
  if (groups.length === 0) return <p className={styles.empty}>Todavía no hay grupos de opciones.</p>;
  return (
    <div className={styles.optionGroups}>
      {groups.map((group) => (
        <section aria-labelledby={`opciones-${group.id}-title`} className={styles.optionGroupCard} id={`opciones-${group.id}`} key={group.id}>
          <header>
            <h3 id={`opciones-${group.id}-title`}>{group.name}</h3>
            <span className={styles.selectionTag}>{group.selection}</span>
          </header>
          <p className={styles.hint}>Se ofrece en {group.appliesTo}. El precio cambia en todos los productos que lo ofrecen.</p>
          <ul className={styles.optionRows}>
            {group.options.map((option) => (
              <li key={option.id}>
                <QuickForm action={saveOptionAction} className={styles.optionRow} label={`Opción ${option.name}`}>
                  <input name="groupId" type="hidden" value={group.id} />
                  <input name="optionId" type="hidden" value={option.id} />
                  <input aria-label={`Nombre de ${option.name}`} className={styles.optionName} defaultValue={option.name} maxLength={80} name="name" />
                  <PriceField defaultValue={option.price} label={`Precio extra de ${option.name}`} name="price" />
                  <QuickSubmit ariaLabel={`Guardar ${option.name}`} className={styles.smallAction}>
                    Guardar
                  </QuickSubmit>
                  <QuickToggle defaultChecked={option.available} label={`${option.name} disponible`} name="available" offLabel="Pausada" onLabel="Disponible" />
                </QuickForm>
              </li>
            ))}
          </ul>
          <QuickForm action={saveOptionAction} className={styles.newOption} label={`Nueva opción en ${group.name}`}>
            <input name="groupId" type="hidden" value={group.id} />
            <input name="available" type="hidden" value="true" />
            <input aria-label={`Nombre de la nueva opción de ${group.name}`} className={styles.optionName} maxLength={80} name="name" placeholder="Ej: Medallón extra" />
            <PriceField defaultValue="" label={`Precio extra de la nueva opción de ${group.name}`} name="price" />
            <QuickSubmit className={styles.addOptionAction}>
              <CirclePlus aria-hidden="true" size={16} /> Añadir
            </QuickSubmit>
          </QuickForm>
        </section>
      ))}
    </div>
  );
}
