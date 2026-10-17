"use client";

import { CirclePlus, Hamburger, Search, Store, Tag } from "lucide-react";
import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { normalizeSearch } from "@/components/storefront/menu-sections";
import type { ProductType } from "@/domain/types";
import { ADMIN_CATALOG_PATH } from "@/app/bunker/admin/catalogo/form-state";
import { ADMIN_PROMOTIONS_PATH } from "@/app/bunker/admin/paths";
import { setStoreStatusAction } from "@/app/bunker/admin/tienda/actions";
import { OVERRIDE_OPTIONS } from "@/app/bunker/admin/tienda/status-labels";
import shared from "@/components/admin/shared/admin-shared.module.css";
import styles from "@/app/bunker/admin.module.css";
import type { ProductFormValues } from "@/components/admin/catalogo/product-form";
import { StoreSettings, type StoreSettingsProps } from "@/components/admin/tienda/store-settings";
import { CategoryTools, type DashboardCategory } from "./category-tools";
import { ProductRows } from "./product-rows";
import { PromotionRows } from "./promotion-rows";
import { QuickForm } from "./quick-form";
import { StoreSwitch } from "./store-switch";

export interface DashboardProduct {
  form: ProductFormValues;
  type: ProductType;
  description: string;
  categoryName: string;
  imageUrl: string | null;
  imageStyle?: CSSProperties | undefined;
}

export interface DashboardPromotion {
  id: string;
  name: string;
  explanation: string;
  badgeText: string | null;
  phaseLabel: string;
  phaseClass: "badge" | "badgeMuted" | "badgeWarning";
  active: boolean;
  /** "$ 12.500", "15% OFF", "2x1", "Envío gratis". */
  valueLabel: string;
  /** Applies to an order right now. */
  running: boolean;
  /** The banner photo (issue #54), cropped where the admin left it; the flame without one. */
  imageUrl: string | null;
  imageStyle?: CSSProperties | undefined;
}

export interface DashboardStore {
  state: "open" | "paused" | "closed";
  stateLabel: string;
  reason: string;
  /** "auto" follows the opening hours; the others force open, paused or closed. */
  statusOverride: string;
  deliveryFee: string;
  whatsapp: string;
}

/**
 * The owner's control panel, after the canonical capture admin_configuraci_n_precios (issue #54):
 * store status, search and shortcuts, then prices and stock of products and promotions, and the
 * delivery fee. Every change goes through the admin Server Actions the full screens already use.
 * No metrics: the scope excludes orders, sales and KPIs.
 */
export function AdminDashboard({
  products,
  promotions,
  store,
  categories,
  settings
}: {
  products: DashboardProduct[];
  promotions: DashboardPromotion[];
  store: DashboardStore;
  categories: DashboardCategory[];
  settings: StoreSettingsProps;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const needle = normalizeSearch(query);
  const shownProducts = products.filter(
    (product) => (category === null || product.form.categoryId === category) && normalizeSearch(`${product.form.name} ${product.description}`).includes(needle)
  );
  // Products are ordered within their category, so dragging is offered with one category and no search.
  const sortable = category !== null && needle === "";
  const shownPromotions = promotions.filter((promotion) => normalizeSearch(`${promotion.name} ${promotion.explanation}`).includes(needle));

  return (
    <div className={styles.dashboard}>
      {/* Side column on desktop; on phones its cards keep the capture's order around the list. */}
      <div className={styles.dashboardSide}>
      {/* The capture's two cards, with what the catalog really knows (no orders or sales are recorded). */}
      <div className={styles.metrics}>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>
            Disponibles <Hamburger aria-hidden="true" size={18} />
          </span>
          <strong>
            {products.filter((product) => product.form.published && product.form.inStock).length}
            <small> de {products.filter((product) => product.form.published).length} publicados</small>
          </strong>
        </div>
        <div className={styles.metric}>
          <span className={styles.metricLabel}>
            Promos vigentes <Tag aria-hidden="true" size={18} />
          </span>
          <strong>{promotions.filter((promotion) => promotion.running).length}</strong>
        </div>
      </div>
      <section aria-labelledby="store-state-title" className={shared.statusCard}>
        <div className={styles.statusHead}>
          <span className={styles.statusTitle}>
            <Store aria-hidden="true" size={18} />
            <span id="store-state-title">Estado del local</span>
          </span>
          <span className={styles[`state_${store.state}`]}>{store.stateLabel}</span>
        </div>
        <QuickForm action={setStoreStatusAction} className={styles.statusForm} label="Abrir o cerrar el local">
          <StoreSwitch open={store.state === "open"} reason={store.reason} />
        </QuickForm>
        <QuickForm action={setStoreStatusAction} className={styles.modeForm} label="Modo del local">
          <label htmlFor="store-mode">Modo</label>
          <select
            className={shared.categorySelect}
            defaultValue={store.statusOverride}
            id="store-mode"
            key={store.statusOverride}
            name="statusOverride"
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            {OVERRIDE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </QuickForm>
      </section>

      <div className={styles.toolbar}>
        <label className={styles.searchField}>
          <Search aria-hidden="true" size={18} />
          <span className="sr-only">Buscar producto o promoción</span>
          <input onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto o promo…" type="search" value={query} />
        </label>
        <div className={styles.toolbarActions}>
          <Link className={styles.addPrimary} href={`${ADMIN_CATALOG_PATH}/productos/nuevo${category ? `?categoria=${category}` : ""}`}>
            <CirclePlus aria-hidden="true" size={18} /> Producto
          </Link>
          <Link className={styles.addSecondary} href={`${ADMIN_PROMOTIONS_PATH}/nueva`}>
            <CirclePlus aria-hidden="true" size={18} /> Promoción
          </Link>
        </div>
        <CategoryTools categories={categories} onSelect={setCategory} selected={category} totalProducts={products.length} />
      </div>
      </div>

      <section aria-labelledby="prices-title" className={styles.prices}>
        <div className={shared.pricesHead}>
          <div>
            <h2 id="prices-title">Gestión de precios &amp; stock</h2>
            <p>Activá, pausá o actualizá precios y promociones.</p>
          </div>
          <nav aria-label="Listas" className={styles.segmented}>
            <a aria-current="true" href="#lista-productos">
              <Hamburger aria-hidden="true" size={16} /> Productos <span>{products.length}</span>
            </a>
            <a href="#lista-promociones">
              <Tag aria-hidden="true" size={16} /> Promociones <span>{promotions.length}</span>
            </a>
          </nav>
        </div>

        <ProductRows categoryId={category} products={shownProducts} sortable={sortable} />

        <h3 className={styles.promosTitle} id="promos-title">
          <Tag aria-hidden="true" size={20} /> Promociones &amp; combos activos
        </h3>
        <p className={shared.hint}>
          Nunca se acumulan: a cada pedido se le aplica una sola, la primera de esta lista que le dé descuento.
          {needle === "" && promotions.length > 1 ? " Arrastralas por su asa para cambiar el orden." : null}
        </p>
        <PromotionRows promotions={shownPromotions} sortable={needle === ""} />
      </section>

      <StoreSettings {...settings} />
    </div>
  );
}
