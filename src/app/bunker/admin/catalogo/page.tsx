import Link from "next/link";
import { focalStyle } from "@/components/storefront/focal-style";
import type { Category, Product } from "@/domain/types";
import { formatArs } from "@/lib/money";
import { getCatalogAdminView } from "@/server/catalog-admin";
import styles from "../../admin.module.css";
import {
  createCategoryAction,
  deleteCategoryAction,
  moveCategoryAction,
  moveProductAction,
  updateCategoryAction
} from "./actions";
import { AdminForm, CheckboxField, TextField } from "../admin-form";
import { ADMIN_CATALOG_PATH, CATALOG_TABS, productEditPath, tabFor, tabForType, type CatalogTab } from "./form-state";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

export default async function CatalogAdminPage({ searchParams }: { searchParams: SearchParams }) {
  const { tipo } = await searchParams;
  const tab = tabFor(typeof tipo === "string" ? tipo : undefined);
  const view = await getCatalogAdminView();

  if (!view.ok) {
    return (
      <section className={styles.adminPanel} aria-labelledby="catalog-title">
        <p className={styles.eyebrow}>ADMINISTRACIÓN</p>
        <h1 id="catalog-title">Catálogo</h1>
        <p className={styles.error} role="alert">
          No pudimos cargar el catálogo. Recargá la página en unos segundos.
        </p>
      </section>
    );
  }

  const { categories, products } = view.value.catalog;
  const tabCategories = categories.filter((category) => category.type === tab.type);

  return (
    <section className={styles.adminPanel} aria-labelledby="catalog-title">
      <p className={styles.eyebrow}>ADMINISTRACIÓN</p>
      <h1 id="catalog-title">Catálogo</h1>
      <p>Categorías, productos, opciones y fotos del menú. Lo publicado se ve en el menú en el próximo pedido.</p>

      <nav aria-label="Tipos de producto" className={styles.tabs}>
        {CATALOG_TABS.map((candidate) => (
          <Link
            aria-current={candidate.slug === tab.slug ? "page" : undefined}
            className={styles.tab}
            href={`${ADMIN_CATALOG_PATH}?tipo=${candidate.slug}`}
            key={candidate.slug}
          >
            {candidate.label}
          </Link>
        ))}
      </nav>

      <section aria-labelledby="tab-title" className={styles.tabPanel}>
        <h2 id="tab-title">{tab.label}</h2>
        {tabCategories.length === 0 ? <p className={styles.empty}>Todavía no hay categorías de {tab.label.toLowerCase()}.</p> : null}
        {tabCategories.map((category) => (
          <CategoryCard category={category} key={category.id} products={products.filter((product) => product.categoryId === category.id)} tab={tab} />
        ))}
        <details className={styles.disclosure}>
          <summary>Nueva categoría de {tab.label.toLowerCase()}</summary>
          <AdminForm action={createCategoryAction} submitLabel="Crear categoría">
            <input name="kind" type="hidden" value={tab.kind} />
            <TextField label="Nombre" maxLength={60} name="name" required />
            <TextField hint="Se genera del nombre si lo dejás vacío." label="Slug (opcional)" maxLength={80} name="slug" />
            <CheckboxField defaultChecked label="Visible en el menú" name="visible" />
          </AdminForm>
        </details>
      </section>

      <section aria-labelledby="order-title" className={styles.tabPanel}>
        <h2 id="order-title">Orden del menú</h2>
        <p className={styles.hint}>Así se ordenan las secciones en el menú público.</p>
        <ol className={styles.orderList}>
          {categories.map((category, index) => (
            <li key={category.id}>
              <span>
                <strong>{category.name}</strong> · {tabForType(category.type)?.label ?? "Otros"}
                {category.visible ? null : <span className={styles.badgeMuted}>Oculta</span>}
              </span>
              <MoveButtons
                action={moveCategoryAction}
                field="categoryId"
                first={index === 0}
                id={category.id}
                last={index === categories.length - 1}
                name={category.name}
              />
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}

function CategoryCard({ category, products, tab }: { category: Category; products: Product[]; tab: CatalogTab }) {
  const headingId = `category-${category.id}`;
  return (
    <article aria-labelledby={headingId} className={styles.categoryCard}>
      <header className={styles.cardHeader}>
        <h3 id={headingId}>{category.name}</h3>
        <span className={category.visible ? styles.badge : styles.badgeMuted}>{category.visible ? "Visible" : "Oculta"}</span>
        <Link className={styles.secondaryLink} href={`${ADMIN_CATALOG_PATH}/productos/nuevo?categoria=${category.id}`}>
          Nuevo producto
        </Link>
      </header>

      {products.length === 0 ? (
        <p className={styles.empty}>Sin productos todavía.</p>
      ) : (
        <ol aria-label={`Productos de ${category.name}`} className={styles.productList}>
          {products.map((product, index) => (
            <li className={styles.productRow} key={product.id}>
              <div className={styles.thumb}>
                {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of the stored photo */}
                {product.imageUrl ? <img alt="" src={product.imageUrl} style={focalStyle(product)} /> : <span aria-hidden="true">Sin foto</span>}
              </div>
              <div className={styles.productInfo}>
                <Link href={productEditPath(product.id)}>{product.name}</Link>
                <span>{formatArs(product.priceCents)}</span>
                <span className={styles.badges}>
                  <span className={product.published ? styles.badge : styles.badgeMuted}>{product.published ? "Publicado" : "Borrador"}</span>
                  {product.inStock ? null : <span className={styles.badgeWarning}>Sin stock</span>}
                  {product.featured ? <span className={styles.badge}>Destacado</span> : null}
                  {product.imageUrl ? null : <span className={styles.badgeMuted}>Sin foto</span>}
                </span>
              </div>
              <MoveButtons
                action={moveProductAction}
                field="productId"
                first={index === 0}
                id={product.id}
                last={index === products.length - 1}
                name={product.name}
              />
            </li>
          ))}
        </ol>
      )}

      <details className={styles.disclosure}>
        <summary>Editar categoría</summary>
        <AdminForm action={updateCategoryAction} submitLabel="Guardar categoría">
          <input name="categoryId" type="hidden" value={category.id} />
          <TextField defaultValue={category.name} label="Nombre" maxLength={60} name="name" required />
          <TextField defaultValue={category.slug} label="Slug" maxLength={80} name="slug" />
          <CheckboxField defaultChecked={category.visible} label="Visible en el menú" name="visible" />
          <p className={styles.hint}>El tipo ({tab.label}) no cambia: define qué opciones aplican a sus productos.</p>
        </AdminForm>
      </details>
      <details className={styles.disclosure}>
        <summary>Eliminar categoría</summary>
        <p className={styles.hint}>Sólo se puede eliminar una categoría sin productos. No se puede deshacer.</p>
        <AdminForm action={deleteCategoryAction} submitLabel={`Eliminar ${category.name}`} submitVariant="danger" pendingLabel="Eliminando…">
          <input name="categoryId" type="hidden" value={category.id} />
        </AdminForm>
      </details>
    </article>
  );
}

function MoveButtons({
  action,
  field,
  id,
  name,
  first,
  last
}: {
  action: typeof moveCategoryAction;
  field: "categoryId" | "productId";
  id: string;
  name: string;
  first: boolean;
  last: boolean;
}) {
  return (
    <div className={styles.moveButtons}>
      {first ? null : (
        <AdminForm action={action} className={styles.inlineForm} pendingLabel="…" submitAriaLabel={`Subir ${name}`} submitLabel="↑" submitVariant="icon">
          <input name={field} type="hidden" value={id} />
          <input name="direction" type="hidden" value="up" />
        </AdminForm>
      )}
      {last ? null : (
        <AdminForm action={action} className={styles.inlineForm} pendingLabel="…" submitAriaLabel={`Bajar ${name}`} submitLabel="↓" submitVariant="icon">
          <input name={field} type="hidden" value={id} />
          <input name="direction" type="hidden" value="down" />
        </AdminForm>
      )}
    </div>
  );
}
