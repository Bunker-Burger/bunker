"use client";

import { Flame, GripVertical } from "lucide-react";
import Link from "next/link";
import { reorderPromotionsAction, setPromotionActiveAction } from "@/app/bunker/admin/promociones/actions";
import { promotionEditPath } from "@/app/bunker/admin/paths";
import shared from "@/components/admin/shared/admin-shared.module.css";
import styles from "@/app/bunker/admin.module.css";
import { useOrderSaver } from "./category-tools";
import type { DashboardPromotion } from "./dashboard";
import { QuickRowInfo } from "./product-rows";
import { QuickForm, QuickToggle } from "./quick-form";
import { useDragOrder } from "./use-drag-order";

/** Promotions in the order they are tried; without a search they can be dragged to reorder. */
export function PromotionRows({ promotions, sortable }: { promotions: DashboardPromotion[]; sortable: boolean }) {
  const { saveOrder, message } = useOrderSaver(reorderPromotionsAction);
  const { list, rowProps, handleProps } = useDragOrder(promotions, (ids) => saveOrder({ promotionId: ids }));
  const draggable = sortable && list.length > 1;
  return (
    <>
      {message ? (
        <p className={shared.quickError} role="alert">
          {message}
        </p>
      ) : null}
      <ul aria-labelledby="promos-title" className={styles.quickList} id="lista-promociones">
        {list.length === 0 ? <li className={shared.empty}>No hay promociones que coincidan.</li> : null}
        {list.map((promotion, index) => (
          <li className={`${shared.quickRow} ${styles.quickRowPromo}`} key={promotion.id} {...(draggable ? rowProps(promotion.id) : {})}>
            {draggable ? (
              <button className={shared.rowGrip} {...handleProps(promotion.id, index, `Mover ${promotion.name}`)}>
                <GripVertical aria-hidden="true" size={18} />
              </button>
            ) : null}
            <QuickRowInfo
              badges={[{ label: promotion.phaseLabel, className: promotion.phaseClass }]}
              description={promotion.explanation}
              href={promotionEditPath(promotion.id)}
              icon={Flame}
              imageStyle={promotion.imageStyle}
              imageUrl={promotion.imageUrl}
              name={promotion.name}
              tag={promotion.badgeText}
            />
            <QuickForm action={setPromotionActiveAction} className={shared.quickControls} label={`Estado de ${promotion.name}`}>
              <span className={styles.priceValue}>{promotion.valueLabel}</span>
              <Link className={styles.smallActionLink} href={promotionEditPath(promotion.id)}>
                Editar
              </Link>
              <input name="promotionId" type="hidden" value={promotion.id} />
              <QuickToggle defaultChecked={promotion.active} label={`${promotion.name} activa`} name="active" offLabel="Pausada" onLabel="Activa" />
            </QuickForm>
          </li>
        ))}
      </ul>
    </>
  );
}
