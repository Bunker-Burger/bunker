import { notFound } from "next/navigation";
import { getCatalogAdminView, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, MIN_IMAGE_SIDE } from "@/server/catalog-admin";
import shared from "@/components/admin/shared/admin-shared.module.css";
import styles from "@/components/admin/catalogo/catalogo.module.css";
import { deleteProductAction } from "../../actions";
import { AdminForm } from "@/components/admin/shared/admin-form";
import { ADMIN_PANEL_PATH } from "../../../paths";
import { ProductForm } from "@/components/admin/catalogo/product-form";
import { formCategories, formOptionGroups, formValues } from "../../product-props";
import { AdminPageBar } from "@/components/admin/shared/page-bar";

type Params = Promise<{ productId: string }>;
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function EditProductPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ productId }, { creado, foto }] = await Promise.all([params, searchParams]);
  const view = await getCatalogAdminView();

  if (!view.ok) {
    return (
      <section className={shared.adminPanel} aria-labelledby="product-title">
        <AdminPageBar backHref={ADMIN_PANEL_PATH} backLabel="Volver al panel" title="Producto" titleId="product-title" />
        <p className={shared.error} role="alert">No pudimos cargar el catálogo. Recargá la página en unos segundos.</p>
      </section>
    );
  }

  const product = view.value.catalog.products.find((candidate) => candidate.id === productId);
  if (!product) notFound();
  const category = view.value.catalog.categories.find((candidate) => candidate.id === product.categoryId);

  return (
    <section className={shared.adminPanel} aria-labelledby="product-title">
      <AdminPageBar backHref={ADMIN_PANEL_PATH} backLabel="Volver al panel" title={product.name} titleId="product-title" />
      <p>
        {product.published ? "Publicado" : "Borrador"}
        {category ? ` · ${category.name}` : null}
      </p>
      {creado === "1" && foto === "0" ? (
        <p className={shared.error} role="alert">
          Producto creado, pero la foto no se pudo subir. Probá de nuevo desde “Foto del producto”.
        </p>
      ) : creado === "1" ? (
        <p className={shared.success} role="status">
          Producto creado.
        </p>
      ) : null}

      <section aria-labelledby="details-title" className={styles.plainSection}>
        <h2 id="details-title">Datos y opciones</h2>
        <ProductForm
          categories={formCategories(view.value.catalog.categories)}
          key={`${product.id}-${product.published}-${product.optionGroups.length}`}
          photo={{
            url: product.imageUrl ?? null,
            maxBytes: MAX_IMAGE_BYTES,
            minSide: MIN_IMAGE_SIDE,
            maxSide: MAX_IMAGE_SIDE,
            focal: { x: product.imageFocalPoint?.x ?? 50, y: product.imageFocalPoint?.y ?? 50 }
          }}
          optionGroups={formOptionGroups(view.value.optionGroups)}
          product={formValues(product)}
        />
      </section>

      <section aria-labelledby="danger-title" className={shared.tabPanel}>
        <h2 id="danger-title">Eliminar</h2>
        <details className={shared.disclosure}>
          <summary>Eliminar producto</summary>
          <p className={shared.hint}>
            Se borra el producto con su foto y sus opciones. No se puede deshacer. Si está en una promoción, despublicalo en su lugar.
          </p>
          <AdminForm action={deleteProductAction} pendingLabel="Eliminando…" submitLabel={`Eliminar ${product.name}`} submitVariant="danger">
            <input name="productId" type="hidden" value={product.id} />
            <input name="from" type="hidden" value="edit" />
          </AdminForm>
        </details>
      </section>
    </section>
  );
}
