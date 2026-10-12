import { notFound } from "next/navigation";
import { MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, MIN_IMAGE_SIDE } from "@/server/catalog-admin";
import { getStoreAdminView } from "@/server/store-admin";
import styles from "../../../admin.module.css";
import { AdminForm } from "../../admin-form";
import { AdminPageBar } from "../../page-bar";
import { ADMIN_PROMOTIONS_PATH } from "../../paths";
import { deletePromotionAction } from "../actions";
import { PromotionForm } from "../promotion-form";
import { formProducts, promotionValues } from "../promotion-props";

type Params = Promise<{ promotionId: string }>;
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function EditPromotionPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ promotionId }, { creada, foto }] = await Promise.all([params, searchParams]);
  const view = await getStoreAdminView();
  if (!view.ok) {
    return (
      <section className={styles.adminPanel} aria-labelledby="promotion-title">
        <AdminPageBar backHref={ADMIN_PROMOTIONS_PATH} backLabel="Volver a promociones" title="Promoción" titleId="promotion-title" />
        <p className={styles.error} role="alert">No pudimos cargar los datos. Recargá la página en unos segundos.</p>
      </section>
    );
  }
  const { catalog } = view.value;
  const rule = catalog.promotions.find((candidate) => candidate.id === promotionId);
  if (!rule) notFound();

  return (
    <section className={styles.adminPanel} aria-labelledby="promotion-title">
      <AdminPageBar backHref={ADMIN_PROMOTIONS_PATH} backLabel="Volver a promociones" title={rule.name} titleId="promotion-title" />
      {creada === "1" && foto === "0" ? (
        <p className={styles.error} role="alert">
          Promoción creada, pero la foto no se pudo subir. Probá de nuevo desde “Foto de la promo”.
        </p>
      ) : creada === "1" ? (
        <p className={styles.success} role="status">
          Promoción creada.
        </p>
      ) : null}
      <PromotionForm
        defaults={promotionValues(rule, catalog.store.timezone)}
        deliveryFeeCents={catalog.store.deliveryFeeCents === null ? null : catalog.store.deliveryFeeCents.toString()}
        key={`${rule.id}-${rule.active}-${rule.items.length}-${rule.schedule.length}-${rule.imageUrl ?? ""}`}
        photo={{ url: rule.imageUrl ?? null, maxBytes: MAX_IMAGE_BYTES, minSide: MIN_IMAGE_SIDE, maxSide: MAX_IMAGE_SIDE }}
        products={formProducts(catalog)}
        timezone={catalog.store.timezone}
      />
      <section aria-labelledby="danger-title" className={styles.tabPanel}>
        <h2 id="danger-title">Eliminar</h2>
        <details className={styles.disclosure}>
          <summary>Eliminar promoción</summary>
          <p className={styles.hint}>Se borra con sus productos y franjas. No se puede deshacer; podés pausarla en su lugar.</p>
          <AdminForm action={deletePromotionAction} pendingLabel="Eliminando…" submitLabel={`Eliminar ${rule.name}`} submitVariant="danger">
            <input name="promotionId" type="hidden" value={rule.id} />
            <input name="from" type="hidden" value="edit" />
          </AdminForm>
        </details>
      </section>
    </section>
  );
}
