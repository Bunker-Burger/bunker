"use client";

import { CupSoda, GripVertical, Hamburger, Popcorn, Sandwich, UtensilsCrossed, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import type { ProductType } from "@/domain/types";
import { productEditPath } from "@/app/bunker/admin/catalogo/form-state";
import { reorderProductsAction, saveProductAction } from "@/app/bunker/admin/catalogo/actions";
import type { ProductFormValues } from "@/components/admin/catalogo/product-form";
import styles from "@/app/bunker/admin.module.css";
import { useOrderSaver } from "./category-tools";
import type { DashboardProduct } from "./dashboard";
import { PriceField, QuickForm, QuickSubmit, QuickToggle } from "./quick-form";
import { useDragOrder } from "./use-drag-order";

const ICONS: Record<ProductType, LucideIcon> = { burger: Hamburger, sandwich: Sandwich, fries: Popcorn, beverage: CupSoda, other: UtensilsCrossed };

/** The price-and-stock rows; with one category chosen they can be dragged into the menu's order. */
export function ProductRows({ products, sortable, categoryId }: { products: DashboardProduct[]; sortable: boolean; categoryId: string | null }) {
  const { saveOrder, message } = useOrderSaver(reorderProductsAction);
  const rows = products.map((product) => ({ id: product.form.id, product }));
  const { list, rowProps, handleProps } = useDragOrder(rows, (ids) => saveOrder({ categoryId: categoryId ?? "", productId: ids }));
  return (
    <>
      {message ? (
        <p className={styles.quickError} role="alert">
          {message}
        </p>
      ) : null}
      <ul aria-label="Productos" className={styles.quickList} id="lista-productos">
        {list.length === 0 ? <li className={styles.empty}>No hay productos que coincidan.</li> : null}
        {list.map(({ product }, index) => (
          <li
            className={product.form.inStock ? styles.quickRow : `${styles.quickRow} ${styles.quickRowOff}`}
            key={product.form.id}
            {...(sortable ? rowProps(product.form.id) : {})}
          >
            {sortable ? (
              <button className={styles.rowGrip} {...handleProps(product.form.id, index, `Mover ${product.form.name}`)}>
                <GripVertical aria-hidden="true" size={18} />
              </button>
            ) : null}
            <QuickRowInfo
              badges={[
                product.form.featured ? { label: "Destacado", className: "badge" as const } : null,
                product.form.inStock ? null : { label: "Sin stock", className: "badgeWarning" as const },
                product.form.published ? null : { label: "Borrador", className: "badgeMuted" as const }
              ]}
              description={product.description}
              href={productEditPath(product.form.id)}
              icon={ICONS[product.type]}
              imageStyle={product.imageStyle}
              imageUrl={product.imageUrl}
              name={product.form.name}
              tag={product.categoryName}
            />
            <QuickForm action={saveProductAction} className={styles.quickControls} label={`Precio y stock de ${product.form.name}`}>
              <ProductHiddenFields form={product.form} />
              <PriceField defaultValue={product.form.price} label={`Precio de ${product.form.name}`} name="price" />
              <QuickSubmit ariaLabel={`Guardar precio de ${product.form.name}`} className={styles.smallAction}>
                Guardar
              </QuickSubmit>
              <QuickToggle defaultChecked={product.form.inStock} label={`${product.form.name} disponible`} name="inStock" offLabel="Pausado" onLabel="Disponible" />
            </QuickForm>
          </li>
        ))}
      </ul>
    </>
  );
}

export function QuickRowInfo({
  name,
  href,
  description,
  tag,
  icon: Icon,
  imageUrl = null,
  imageStyle,
  badges
}: {
  name: string;
  href: string;
  description: string;
  tag: string | null;
  icon: LucideIcon;
  imageUrl?: string | null;
  imageStyle?: CSSProperties | undefined;
  badges: Array<{ label: string; className: "badge" | "badgeMuted" | "badgeWarning" } | null>;
}) {
  return (
    <div className={styles.quickInfo}>
      <span className={styles.quickThumb}>
        {/* eslint-disable-next-line @next/next/no-img-element -- admin preview of the stored photo */}
        {imageUrl ? <img alt="" src={imageUrl} style={imageStyle} /> : <Icon aria-hidden="true" />}
        {tag ? <span>{tag}</span> : null}
      </span>
      <span className={styles.quickText}>
        <span className={styles.quickTitle}>
          <Link href={href}>{name}</Link>
          {badges.map((badge) => (badge ? <span className={styles[badge.className]} key={badge.label}>{badge.label}</span> : null))}
        </span>
        <span className={styles.quickDescription}>{description}</span>
      </span>
    </div>
  );
}

/** The rest of the product exactly as stored, so a quick price or stock change keeps everything else. */
function ProductHiddenFields({ form }: { form: ProductFormValues }) {
  return (
    <>
      <input name="productId" type="hidden" value={form.id} />
      <input name="categoryId" type="hidden" value={form.categoryId} />
      <input name="name" type="hidden" value={form.name} />
      <input name="slug" type="hidden" value={form.slug} />
      <input name="description" type="hidden" value={form.description} />
      {form.featured ? <input name="featured" type="hidden" value="true" /> : null}
      {form.published ? <input name="published" type="hidden" value="true" /> : null}
      {form.optionGroups.map((link) => (
        <span hidden key={link.groupId}>
          <input name="optionGroup" type="hidden" value={link.groupId} />
          {link.defaultOptionIds.map((optionId) => (
            <input key={optionId} name={`default:${link.groupId}`} type="hidden" value={optionId} />
          ))}
        </span>
      ))}
    </>
  );
}
