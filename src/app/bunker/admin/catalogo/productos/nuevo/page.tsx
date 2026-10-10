import Link from "next/link";
import { getCatalogAdminView } from "@/server/catalog-admin";
import styles from "../../../../admin.module.css";
import { ADMIN_CATALOG_PATH, tabForType } from "../../form-state";
import { ProductForm } from "../../product-form";
import { formCategories, formOptionGroups } from "../../product-props";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function NewProductPage({ searchParams }: { searchParams: SearchParams }) {
  const { categoria } = await searchParams;
  const view = await getCatalogAdminView();

  if (!view.ok) {
    return (
      <section className={styles.adminPanel} aria-labelledby="product-title">
        <h1 id="product-title">Nuevo producto</h1>
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
      <Link className={styles.backLink} href={backHref}>
        ← Volver al catálogo
      </Link>
      <h1 id="product-title">Nuevo producto</h1>
      {categories.length === 0 ? (
        <p className={styles.empty}>Primero creá una categoría de Hamburguesas, Sándwiches, Papas o Bebidas.</p>
      ) : (
        <>
          <p>Se crea como borrador si no marcás “Publicado”. Después vas a poder subir la foto.</p>
          <ProductForm categories={categories} {...(preselected ? { defaultCategoryId: preselected.id } : {})} optionGroups={formOptionGroups(view.value.optionGroups)} />
        </>
      )}
    </section>
  );
}
