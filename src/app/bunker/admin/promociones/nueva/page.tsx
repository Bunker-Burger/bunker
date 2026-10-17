import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, MIN_IMAGE_SIDE } from "@/server/catalog-admin";
import { getStoreAdminView } from "@/server/store-admin";
import styles from "../../../admin.module.css";
import { ADMIN_PANEL_PATH } from "../../paths";
import { AdminPageBar } from "@/components/admin/shared/page-bar";
import { PromotionForm } from "@/components/admin/promociones/promotion-form";
import { formProducts, newPromotionValues } from "../promotion-props";

export default async function NewPromotionPage() {
  const view = await getStoreAdminView();
  if (!view.ok) {
    return (
      <section className={styles.adminPanel} aria-labelledby="promotion-title">
        <AdminPageBar backHref={ADMIN_PANEL_PATH} backLabel="Volver al panel" title="Nueva promoción" titleId="promotion-title" />
        <p className={styles.error} role="alert">No pudimos cargar los datos. Recargá la página en unos segundos.</p>
      </section>
    );
  }
  const { store } = view.value.catalog;
  return (
    <section className={styles.adminPanel} aria-labelledby="promotion-title">
      <AdminPageBar backHref={ADMIN_PANEL_PATH} backLabel="Volver al panel" title="Nueva promoción" titleId="promotion-title" />
      <p>Se crea pausada si no marcás “Activa”. Queda al final del orden de prioridad.</p>
      <PromotionForm
        defaults={newPromotionValues(store.timezone)}
        deliveryFeeCents={store.deliveryFeeCents === null ? null : store.deliveryFeeCents.toString()}
        photo={{ url: null, maxBytes: MAX_IMAGE_BYTES, minSide: MIN_IMAGE_SIDE, maxSide: MAX_IMAGE_SIDE, focal: { x: 50, y: 50 }, frame: "banner" }}
        products={formProducts(view.value.catalog)}
        timezone={store.timezone}
      />
    </section>
  );
}
