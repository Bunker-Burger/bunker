"use client";

import { Check, Plus, Search, UtensilsCrossed, X } from "lucide-react";
import { useId, useMemo, useRef, useState, type FocusEvent } from "react";
import type { Category, Product } from "@/domain/types";
import type { PromotionalPrice } from "@/domain/promotions";
import { formatArs } from "@/lib/money";
import { focalStyle } from "./focal-style";
import { buildMenuSections, menuCategories, menuFilters, type MenuFilter } from "./menu-sections";

// Browsers leave a focused chip half-cut inside a horizontal scroller; bring it fully into view.
function revealInScroller(event: FocusEvent<HTMLElement>) {
  event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
}

const plural = (count: number) => (count === 1 ? "1 producto" : `${count} productos`);

interface MenuProps {
  products: readonly Product[];
  /** Categories of the same snapshot as `products`. */
  categories: readonly Category[];
  promotionFor: (product: Product) => PromotionalPrice | null;
  onOpen: (product: Product) => void;
  onAdd: (product: Product) => void;
  /** No snapshot could be read yet (and no demo menu is allowed): not the same as an empty menu. */
  unavailable?: boolean;
}

/** The public menu: search, section filters and the sections in the configured order. */
export function Menu({ products, categories, promotionFor, onOpen, onAdd, unavailable = false }: MenuProps) {
  const [filter, setFilter] = useState<MenuFilter>("all");
  const [query, setQuery] = useState("");
  const searchId = useId();
  const resultsRef = useRef<HTMLParagraphElement>(null);

  // Picking a section while scrolled deep into the menu jumps back to where the results start.
  const chooseFilter = (next: MenuFilter) => {
    setFilter(next);
    const results = resultsRef.current;
    if (results && results.getBoundingClientRect().top < 0) {
      requestAnimationFrame(() => results.scrollIntoView({ block: "start" }));
    }
  };
  const sectionCategories = useMemo(() => menuCategories(categories), [categories]);
  const filters = useMemo(() => menuFilters(products, sectionCategories), [products, sectionCategories]);
  // A filter whose category disappeared from the catalog falls back to the full menu.
  const activeFilter = filters.some((option) => option.id === filter) ? filter : "all";
  const sections = buildMenuSections(products, sectionCategories, activeFilter, query);
  const shown = sections.reduce((total, section) => total + section.products.length, 0);
  const published = products.some((product) => product.published);
  const narrowed = activeFilter !== "all" || query.trim() !== "";

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
      <label className="menu-search" htmlFor={searchId}>
        <Search aria-hidden="true" size={18} />
        <span className="sr-only">Buscar en la carta</span>
        <input
          autoComplete="off"
          enterKeyHint="search"
          id={searchId}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar hamburguesas, papas, bebidas…"
          type="search"
          value={query}
        />
        {query ? (
          <button aria-label="Borrar búsqueda" className="menu-search-clear" onClick={() => setQuery("")} type="button">
            <X aria-hidden="true" size={16} />
          </button>
        ) : null}
      </label>

      {/* Only the chips stay pinned while scrolling: at 320px a pinned search too would eat the screen. */}
      <div className="menu-tools">
        <div className="category-tabs" role="group" aria-label="Secciones de la carta">
          {filters.map((option) => (
            <button
              aria-pressed={activeFilter === option.id}
              className={activeFilter === option.id ? "category-tab active" : "category-tab"}
              key={option.id}
              onClick={() => chooseFilter(option.id)}
              onFocus={revealInScroller}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <p aria-live="polite" className={narrowed ? "menu-results" : "sr-only"} ref={resultsRef}>
        {narrowed ? (shown === 0 ? "" : `Mostrando ${plural(shown)}.`) : ""}
      </p>

      {shown === 0 ? (
        <div className="empty-state menu-empty" role="status">
          <Search aria-hidden="true" />
          <h3>No encontramos productos</h3>
          <p>{query.trim() ? `Nada coincide con “${query.trim()}”.` : "No hay productos en esta sección por ahora."}</p>
          <button
            className="primary-action"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
            type="button"
          >
            Ver toda la carta
          </button>
        </div>
      ) : null}

      {sections.map((section) => (
        <section aria-labelledby={`seccion-${section.id}`} className="menu-category" key={section.id}>
          <div className="section-heading">
            <div>
              <span>{section.eyebrow}</span>
              <h2 id={`seccion-${section.id}`}>{section.title}</h2>
            </div>
            <span>{plural(section.products.length)}</span>
          </div>
          <div className={section.featured ? "product-grid featured-grid" : "product-grid"}>
            {section.products.map((product) => (
              <ProductCard
                featured={section.featured}
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

function ProductCard({ product, promotion, featured, onOpen, onAdd }: {
  product: Product;
  promotion: PromotionalPrice | null;
  featured: boolean;
  onOpen: () => void;
  onAdd: () => void;
}) {
  const id = useId();
  const priceCents = promotion?.priceCents ?? product.priceCents;
  return (
    <article className={`product-card${featured ? " featured" : ""}${!product.inStock ? " sold-out" : ""}`}>
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
          {product.imageUrl ? <img alt="" className="product-image" src={product.imageUrl} style={focalStyle(product)} /> : null}
          {product.featured ? <span className="featured-dot" aria-hidden="true"><Check size={16} /></span> : null}
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
          <span className="sr-only" id={`${id}-label`}>Precio</span>
          <span className="sr-only" id={`${id}-stock`}>{product.inStock ? "Disponible." : "Agotado, no se puede pedir."}</span>
        </div>
      </button>
      <button
        aria-label={product.inStock ? `Agregar ${product.name}` : `${product.name} agotado`}
        className="add-button"
        disabled={!product.inStock}
        onClick={onAdd}
        type="button"
      >
        {product.inStock ? <>Agregar <Plus aria-hidden="true" size={16} /></> : "Sin stock"}
      </button>
    </article>
  );
}
