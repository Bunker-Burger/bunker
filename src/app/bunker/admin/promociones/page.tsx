import Link from "next/link";
import { explainPromotion, isPromotionInEffect } from "@/domain/promotions";
import type { PromotionRule } from "@/domain/types";
import { getStoreAdminView } from "@/server/store-admin";
import styles from "../../admin.module.css";
import { AdminForm } from "../admin-form";
import { ADMIN_PROMOTIONS_PATH, promotionEditPath } from "../paths";
import { deletePromotionAction, movePromotionAction, setPromotionActiveAction } from "./actions";
import { promotionPhase, type PromotionPhase } from "./promotion-props";

const WEEKDAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const PHASE: Record<PromotionPhase, { label: string; className: "badge" | "badgeMuted" | "badgeWarning" }> = {
  running: { label: "En vigencia ahora", className: "badge" },
  waiting_window: { label: "Activa, fuera de franja", className: "badgeMuted" },
  scheduled: { label: "Programada", className: "badgeMuted" },
  expired: { label: "Vencida", className: "badgeWarning" },
  paused: { label: "Pausada", className: "badgeMuted" }
};

function dateLabel(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("es-AR", { timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

function scheduleLabel(rule: PromotionRule) {
  if (rule.schedule.length === 0) return "Todo el período";
  return rule.schedule.map((window) => `${WEEKDAYS[window.dayOfWeek]} ${window.startsAt.slice(0, 5)}–${window.endsAt.slice(0, 5)}`).join(", ");
}

export default async function PromotionsAdminPage() {
  const view = await getStoreAdminView();
  if (!view.ok) {
    return (
      <section className={styles.adminPanel} aria-labelledby="promotions-title">
        <p className={styles.eyebrow}>ADMINISTRACIÓN</p>
        <h1 id="promotions-title">Promociones</h1>
        <p className={styles.error} role="alert">
          No pudimos cargar las promociones. Recargá la página en unos segundos.
        </p>
      </section>
    );
  }

  const { catalog } = view.value;
  const now = new Date();
  const timezone = catalog.store.timezone;
  // Highest priority first: that is the order in which they are tried for an order.
  const promotions = [...catalog.promotions].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  const productNames = new Map(catalog.products.map((product) => [product.id, product.name]));

  return (
    <section className={styles.adminPanel} aria-labelledby="promotions-title">
      <p className={styles.eyebrow}>ADMINISTRACIÓN</p>
      <h1 id="promotions-title">Promociones</h1>
      <p>Nunca se acumulan: a cada pedido se le aplica una sola, la primera de esta lista que le dé descuento.</p>
      <Link className={styles.primaryLink} href={`${ADMIN_PROMOTIONS_PATH}/nueva`}>
        Nueva promoción
      </Link>

      {promotions.length === 0 ? (
        <p className={styles.empty}>Todavía no hay promociones.</p>
      ) : (
        <ol aria-label="Promociones por prioridad" className={styles.productList}>
          {promotions.map((rule, index) => {
            const phase = PHASE[promotionPhase(rule, isPromotionInEffect(rule, now, timezone), now)];
            return (
              <li className={styles.promotionRow} key={rule.id}>
                <div className={styles.productInfo}>
                  <Link href={promotionEditPath(rule.id)}>{rule.name}</Link>
                  <span>{explainPromotion(rule)}</span>
                  <span className={styles.hint}>
                    {dateLabel(rule.startsAt, timezone)} → {dateLabel(rule.endsAt, timezone)} · {scheduleLabel(rule)} ·{" "}
                    {rule.channels.map((channel) => (channel === "delivery" ? "delivery" : "retiro")).join(" y ")}
                    {rule.items.length > 0 ? ` · ${rule.items.map((item) => `${item.quantity}× ${productNames.get(item.productId) ?? "?"}`).join(", ")}` : null}
                  </span>
                  <span className={styles.badges}>
                    <span className={styles[phase.className]}>{phase.label}</span>
                    {rule.badgeText ? <span className={styles.badgeMuted}>{rule.badgeText}</span> : null}
                  </span>
                </div>
                <div className={styles.moveButtons}>
                  <AdminForm action={setPromotionActiveAction} className={styles.inlineForm} pendingLabel="…" submitLabel={rule.active ? "Pausar" : "Reanudar"} submitVariant="secondary">
                    <input name="promotionId" type="hidden" value={rule.id} />
                    <input name="active" type="hidden" value={rule.active ? "false" : "true"} />
                  </AdminForm>
                  {index === 0 ? null : (
                    <AdminForm action={movePromotionAction} className={styles.inlineForm} pendingLabel="…" submitAriaLabel={`Subir ${rule.name}`} submitLabel="↑" submitVariant="icon">
                      <input name="promotionId" type="hidden" value={rule.id} />
                      <input name="direction" type="hidden" value="up" />
                    </AdminForm>
                  )}
                  {index === promotions.length - 1 ? null : (
                    <AdminForm action={movePromotionAction} className={styles.inlineForm} pendingLabel="…" submitAriaLabel={`Bajar ${rule.name}`} submitLabel="↓" submitVariant="icon">
                      <input name="promotionId" type="hidden" value={rule.id} />
                      <input name="direction" type="hidden" value="down" />
                    </AdminForm>
                  )}
                </div>
                <details className={styles.disclosure}>
                  <summary>Eliminar</summary>
                  <AdminForm action={deletePromotionAction} pendingLabel="Eliminando…" submitLabel={`Eliminar ${rule.name}`} submitVariant="danger">
                    <input name="promotionId" type="hidden" value={rule.id} />
                  </AdminForm>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
