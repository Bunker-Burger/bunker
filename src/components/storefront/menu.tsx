"use client";

import { CupSoda, Flame, Hamburger, Plus, Popcorn, Sandwich, Search, UtensilsCrossed, type LucideIcon } from "lucide-react";
import { useId, useMemo } from "react";
import type { Category, Product, ProductType } from "@/domain/types";
import type { PromotionalPrice } from "@/domain/promotions";
import { formatArs } from "@/lib/money";
import { focalStyle } from "./focal-style";
import { buildMenuSections, menuCategories } from "./menu-sections";

const plural = (count: number) => (count === 1 ? "1 producto" : `${count} productos`);

/** Card layouts of the canonical menu capture: large (most ordered), row (burgers, sandwiches), compact (sides, drinks). */
export type CardLayout = "hero" | "row" | "compact";
export const layoutFor = (product: Product, featured: boolean): CardLayout =>
  featured ? "hero" : product.type === "fries" || product.type === "beverage" ? "compact" : "row";

const PLACEHOLDER_ICONS: Record<ProductType, LucideIcon> = {
  burger: Hamburger,
  sandwich: Sandwich,
  fries: Popcorn,
  beverage: CupSoda,
  other: UtensilsCrossed
};

/** A product without a photo: the approved dark tile with its category's icon, never a grey block. */
function ProductPlaceholder({ type }: { type: ProductType }) {
  const Icon = PLACEHOLDER_ICONS[type];
  return (
    <span className="product-placeholder" aria-hidden="true">
      <Icon />
    </span>
  );
}

interface MenuProps {
  products: readonly Product[];
  /** Categories of the same snapshot as `products`. */
  categories: readonly Category[];
  promotionFor: (product: Product) => PromotionalPrice | null;
  onOpen: (product: Product) => void;
  onAdd: (product: Product) => void;
  /** No snapshot could be read yet (and no demo menu is allowed): not the same as an empty menu. */
  unavailable?: boolean;
  /** What the customer typed in the header search (issue #54: the search lives in the header). */
  query?: string;
  onClearQuery?: () => void;
}

/** The public menu: the sections in the configured order, narrowed by the header search. */
export function Menu({ products, categories, promotionFor, onOpen, onAdd, unavailable = false, query = "", onClearQuery }: MenuProps) {
  const sectionCategories = useMemo(() => menuCategories(categories), [categories]);
  const sections = buildMenuSections(products, sectionCategories, "all", query);
  const categoryNames = useMemo(() => new Map(sectionCategories.map((category) => [category.id, category.name])), [sectionCategories]);
  const shown = sections.reduce((total, section) => total + section.products.length, 0);
  const published = products.some((product) => product.published);
  const narrowed = query.trim() !== "";

  if (unavailable && !published) {
    return (
      <div className="empty-state menu-empty menu-unavailable" role="status">
        <UtensilsCrossed aria-hidden="true" />
        <h2>No pudimos cargar la carta</h2>
        <p>Reintentamos en un momento. Si no aparece, revisá tu conexión.</p>
      </div>
    );
  }

  // Nothing published is a real state of the store, not a failed search: no tools, no cards.
  if (!published) {
    return (
      <div className="empty-state menu-empty menu-unpublished" role="status">
        <UtensilsCrossed aria-hidden="true" />
        <h2>La carta está vacía por ahora</h2>
        <p>El local todavía no publicó productos. Volvé a mirar en un rato.</p>
      </div>
    );
  }

  return (
    <>
      <p aria-live="polite" className={narrowed ? "menu-results" : "sr-only"}>
        {narrowed ? (shown === 0 ? "" : `Mostrando ${plural(shown)}.`) : ""}
      </p>

      {shown === 0 ? (
        <div className="empty-state menu-empty" role="status">
          <Search aria-hidden="true" />
          <h3>No encontramos productos</h3>
          <p>{query.trim() ? `Nada coincide con “${query.trim()}”.` : "No hay productos por ahora."}</p>
          <button className="primary-action" onClick={onClearQuery} type="button">
            Ver toda la carta
          </button>
        </div>
      ) : null}

      {sections.map((section) => (
        <section aria-labelledby={`seccion-${section.id}`} className="menu-category" key={section.id}>
          <div className="menu-heading">
            <h2 id={`seccion-${section.id}`}>{section.title}</h2>
            {section.featured ? null : <p>{section.eyebrow}</p>}
          </div>
          <div className={section.featured ? "product-grid featured-grid" : "product-grid"}>
            {section.products.map((product) => (
              <ProductCard
                categoryName={categoryNames.get(product.categoryId) ?? null}
                layout={layoutFor(product, section.featured)}
                key={product.id}
                onAdd={() => onAdd(product)}
                onOpen={() => onOpen(product)}
                product={product}
                promotion={promotionFor(product)}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

/** One product of the menu; also the admin's "Así se verá en la carta" preview (issue #54). */
export function ProductCard({ product, promotion, layout, categoryName, onOpen, onAdd }: {
  product: Product;
  promotion: PromotionalPrice | null;
  layout: CardLayout;
  categoryName: string | null;
  onOpen: () => void;
  onAdd: () => void;
}) {
  const id = useId();
  const priceCents = promotion?.priceCents ?? product.priceCents;
  const compact = layout === "compact";
  return (
    <article className={`product-card ${layout}${!product.inStock ? " sold-out" : ""}`}>
      <button
        aria-describedby={`${id}-label ${id}-price ${id}-stock ${id}-desc`}
        aria-label={`Ver ${product.name}`}
        className="product-main"
        data-product-trigger={product.slug}
        onClick={onOpen}
        type="button"
      >
        <div className="product-image-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element -- mock photography; next/image lands with real assets (BB-02) */}
          {product.imageUrl ? <img alt="" className="product-image" src={product.imageUrl} style={focalStyle(product)} /> : <ProductPlaceholder type={product.type} />}
          {product.featured && layout === "hero" ? <span className="featured-dot" aria-hidden="true"><Flame size={18} /></span> : null}
          {!product.inStock ? <span className="sold-out-badge" aria-hidden="true">Agotado</span> : null}
        </div>
        <div className="product-copy">
          <div className="product-title-row">
            <h3>{product.name}</h3>
            {/* Read as "$X Antes $Y"; shown (column-reverse) with the struck price on top. */}
            <span className="product-price" id={`${id}-price`}>
              <strong>{formatArs(priceCents)}</strong>
              {promotion ? <>{" "}<s className="compare-at"><span className="sr-only">Antes</span> {formatArs(promotion.compareAtPriceCents)}</s></> : null}
            </span>
          </div>
          {promotion ? <span className="promo-note">{promotion.promotionName}: {promotion.explanation}</span> : null}
          <p id={`${id}-desc`}>{product.description}</p>
          {!compact && categoryName ? <span className="product-meta" aria-hidden="true">{categoryName}</span> : null}
          <span className="sr-only" id={`${id}-label`}>Precio</span>
          <span className="sr-only" id={`${id}-stock`}>{product.inStock ? "Disponible." : "Agotado, no se puede pedir."}</span>
        </div>
      </button>
      <button
        aria-label={product.inStock ? `Agregar ${product.name}` : `${product.name} agotado`}
        className={compact ? "add-button round" : "add-button"}
        disabled={!product.inStock}
        onClick={onAdd}
        type="button"
      >
        {compact ? <Plus aria-hidden="true" size={18} /> : product.inStock ? <>Agregar <Plus aria-hidden="true" size={16} /></> : "Sin stock"}
      </button>
    </article>
  );
}
