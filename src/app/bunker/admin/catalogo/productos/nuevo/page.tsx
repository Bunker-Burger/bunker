import { getCatalogAdminView } from "@/server/catalog-admin";
import styles from "../../../../admin.module.css";
import { ADMIN_CATALOG_PATH, tabForType } from "../../form-state";
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
        <AdminPageBar backHref={ADMIN_CATALOG_PATH} backLabel="Volver al catálogo" title="Nuevo producto" titleId="product-title" />
        <p className={styles.error} role="alert">No pudimos cargar el catálogo. Recargá la página en unos segundos.</p>
      </section>
    );
  }

  const categories = formCategories(view.value.catalog.categories);
  const preselected = categories.find((category) => category.id === categoria);
  const tab = preselected ? tabForType(preselected.type) : undefined;
  const backHref = tab ? `${ADMIN_CATALOG_PATH}?tipo=${tab.slug}` : ADMIN_CATALOG_PATH;

  return (
    <section className={styles.adminPanel} aria-labelledby="product-title">
      <AdminPageBar backHref={backHref} backLabel="Volver al catálogo" title="Nuevo producto" titleId="product-title" />
      {categories.length === 0 ? (
        <p className={styles.empty}>Primero creá una categoría de Hamburguesas, Sándwiches, Papas o Bebidas.</p>
      ) : (
        <>
          <p>Se crea como borrador si no marcás “Publicado”.</p>
          <section aria-labelledby="photo-title" className={styles.formCard}>
            <h2 className={styles.cardTitle} id="photo-title">
              Foto del producto
            </h2>
            <div className={styles.dropzone}>
              <strong>Subir foto del producto</strong>
              <span>Se habilita al crear el producto: JPG, PNG o WebP, cuadrada o 16:9.</span>
            </div>
          </section>
          <ProductForm categories={categories} {...(preselected ? { defaultCategoryId: preselected.id } : {})} optionGroups={formOptionGroups(view.value.optionGroups)} />
        </>
      )}
    </section>
  );
}
