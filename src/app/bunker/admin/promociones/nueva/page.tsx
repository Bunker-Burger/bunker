import Link from "next/link";
import { getStoreAdminView } from "@/server/store-admin";
import styles from "../../../admin.module.css";
import { ADMIN_PROMOTIONS_PATH } from "../../paths";
import { PromotionForm } from "../promotion-form";
import { formProducts, newPromotionValues } from "../promotion-props";

export default async function NewPromotionPage() {
  const view = await getStoreAdminView();
  if (!view.ok) {
    return (
      <section className={styles.adminPanel} aria-labelledby="promotion-title">
        <h1 id="promotion-title">Nueva promoción</h1>
        <p className={styles.error} role="alert">No pudimos cargar los datos. Recargá la página en unos segundos.</p>
      </section>
    );
  }
  const { store } = view.value.catalog;
  return (
    <section className={styles.adminPanel} aria-labelledby="promotion-title">
      <Link className={styles.backLink} href={ADMIN_PROMOTIONS_PATH}>
        ← Volver a promociones
      </Link>
      <h1 id="promotion-title">Nueva promoción</h1>
      <p>Se crea pausada si no marcás “Activa”. Queda al final del orden de prioridad.</p>
      <PromotionForm
        defaults={newPromotionValues(store.timezone)}
        deliveryFeeCents={store.deliveryFeeCents === null ? null : store.deliveryFeeCents.toString()}
        products={formProducts(view.value.catalog)}
        timezone={store.timezone}
      />
    </section>
  );
}
