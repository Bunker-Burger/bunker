import { notFound } from "next/navigation";
import { getCatalogAdminView, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, MIN_IMAGE_SIDE } from "@/server/catalog-admin";
import styles from "../../../../admin.module.css";
import { deleteProductAction } from "../../actions";
import { AdminForm } from "../../../admin-form";
import { ADMIN_CATALOG_PATH, tabForType } from "../../form-state";
import { ImageForm } from "../../image-form";
import { ProductForm } from "../../product-form";
import { formCategories, formOptionGroups, formValues } from "../../product-props";
import { Camera } from "lucide-react";
import { AdminPageBar } from "../../../page-bar";

type Params = Promise<{ productId: string }>;
type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function EditProductPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ productId }, { creado }] = await Promise.all([params, searchParams]);
  const view = await getCatalogAdminView();

  if (!view.ok) {
    return (
      <section className={styles.adminPanel} aria-labelledby="product-title">
        <AdminPageBar backHref={ADMIN_CATALOG_PATH} backLabel="Volver al catálogo" title="Producto" titleId="product-title" />
        <p className={styles.error} role="alert">No pudimos cargar el catálogo. Recargá la página en unos segundos.</p>
      </section>
    );
  }

  const product = view.value.catalog.products.find((candidate) => candidate.id === productId);
  if (!product) notFound();
  const category = view.value.catalog.categories.find((candidate) => candidate.id === product.categoryId);
  const tab = category ? tabForType(category.type) : undefined;
  const backHref = tab ? `${ADMIN_CATALOG_PATH}?tipo=${tab.slug}` : ADMIN_CATALOG_PATH;

  return (
    <section className={styles.adminPanel} aria-labelledby="product-title">
      <AdminPageBar backHref={backHref} backLabel="Volver al catálogo" title={product.name} titleId="product-title" />
      <p>
        {product.published ? "Publicado" : "Borrador"}
        {category ? ` · ${category.name}` : null}
      </p>
      {creado === "1" ? (
        <p className={styles.success} role="status">
          Producto creado. Ya podés subir su foto.
        </p>
      ) : null}

      <section aria-labelledby="details-title" className={styles.plainSection}>
        <h2 id="details-title">Datos y opciones</h2>
        <ProductForm
          categories={formCategories(view.value.catalog.categories)}
          key={`${product.id}-${product.published}-${product.optionGroups.length}`}
          optionGroups={formOptionGroups(view.value.optionGroups)}
          product={formValues(product)}
        />
      </section>

      <section aria-labelledby="photo-title" className={styles.tabPanel}>
        <h2 className={styles.cardTitle} id="photo-title">
          <Camera aria-hidden="true" size={20} /> Foto del producto
        </h2>
        <ImageForm
          image={product.imageUrl ? { url: product.imageUrl, alt: product.imageAlt ?? "", focalX: product.imageFocalPoint?.x ?? 50, focalY: product.imageFocalPoint?.y ?? 50 } : null}
          key={product.imageUrl ?? "no-image"}
          maxBytes={MAX_IMAGE_BYTES}
          maxSide={MAX_IMAGE_SIDE}
          minSide={MIN_IMAGE_SIDE}
          productId={product.id}
          productName={product.name}
        />
      </section>

      <section aria-labelledby="danger-title" className={styles.tabPanel}>
        <h2 id="danger-title">Eliminar</h2>
        <details className={styles.disclosure}>
          <summary>Eliminar producto</summary>
          <p className={styles.hint}>
            Se borra el producto con su foto y sus opciones. No se puede deshacer. Si está en una promoción, despublicalo en su lugar.
          </p>
          <AdminForm action={deleteProductAction} pendingLabel="Eliminando…" submitLabel={`Eliminar ${product.name}`} submitVariant="danger">
            <input name="productId" type="hidden" value={product.id} />
            <input name="from" type="hidden" value="edit" />
            {tab ? <input name="tab" type="hidden" value={tab.slug} /> : null}
          </AdminForm>
        </details>
      </section>
    </section>
  );
}
