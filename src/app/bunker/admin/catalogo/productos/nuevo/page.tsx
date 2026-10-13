import { getCatalogAdminView, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, MIN_IMAGE_SIDE } from "@/server/catalog-admin";
import styles from "../../../../admin.module.css";
import { ADMIN_PANEL_PATH } from "../../../paths";
import { ProductForm } from "../../product-form";
import { formCategories, formOptionGroups } from "../../product-props";
import { AdminPageBar } from "../../../page-bar";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function NewProductPage({ searchParams }: { searchParams: SearchParams }) {
  const { categoria } = await searchParams;
  const view = await getCatalogAdminView();

  if (!view.ok) {
    return (
      <section className={styles.adminPanel} aria-labelledby="product-title">
        <AdminPageBar backHref={ADMIN_PANEL_PATH} backLabel="Volver al panel" title="Nuevo producto" titleId="product-title" />
        <p className={styles.error} role="alert">No pudimos cargar el catálogo. Recargá la página en unos segundos.</p>
      </section>
    );
  }

  const categories = formCategories(view.value.catalog.categories);
  const preselected = categories.find((category) => category.id === categoria);

  return (
    <section className={styles.adminPanel} aria-labelledby="product-title">
      <AdminPageBar backHref={ADMIN_PANEL_PATH} backLabel="Volver al panel" title="Nuevo producto" titleId="product-title" />
      {categories.length === 0 ? (
        <p className={styles.empty}>Primero creá una categoría de Hamburguesas, Sándwiches, Papas o Bebidas.</p>
      ) : (
        <>
          <p>Se crea como borrador si no marcás “Publicado”.</p>
          <ProductForm categories={categories} photo={{ url: null, maxBytes: MAX_IMAGE_BYTES, minSide: MIN_IMAGE_SIDE, maxSide: MAX_IMAGE_SIDE, focal: { x: 50, y: 50 } }} {...(preselected ? { defaultCategoryId: preselected.id } : {})} optionGroups={formOptionGroups(view.value.optionGroups)} />
        </>
      )}
    </section>
  );
}
