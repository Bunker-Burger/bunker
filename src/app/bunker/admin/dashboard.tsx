"use client";

import { CirclePlus, CupSoda, Flame, GripVertical, Hamburger, Popcorn, Sandwich, Search, Store, Tag, UtensilsCrossed, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type CSSProperties } from "react";
import { AdminNav } from "./admin-nav";
import { normalizeSearch } from "@/components/storefront/menu-sections";
import type { ProductType } from "@/domain/types";
import styles from "../admin.module.css";
import { CategoryTools, useOrderSaver, type DashboardCategory } from "./category-tools";
import { reorderProductsAction, saveProductAction } from "./catalogo/actions";
import type { ProductFormValues } from "./catalogo/product-form";
import { ADMIN_CATALOG_PATH, productEditPath } from "./catalogo/form-state";
import { ADMIN_PROMOTIONS_PATH, promotionEditPath } from "./paths";
import { reorderPromotionsAction, setPromotionActiveAction } from "./promociones/actions";
import { PriceField, QuickForm, QuickSubmit, QuickToggle } from "./quick-form";
import { useDragOrder } from "./use-drag-order";
import { saveStoreContactAction, setStoreStatusAction } from "./tienda/actions";

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
}

export interface DashboardStore {
  state: "open" | "paused" | "closed";
  stateLabel: string;
  reason: string;
  deliveryFee: string;
  whatsapp: string;
}

const ICONS: Record<ProductType, LucideIcon> = { burger: Hamburger, sandwich: Sandwich, fries: Popcorn, beverage: CupSoda, other: UtensilsCrossed };

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
  categories
}: {
  products: DashboardProduct[];
  promotions: DashboardPromotion[];
  store: DashboardStore;
  categories: DashboardCategory[];
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
      <section aria-labelledby="store-state-title" className={styles.statusCard}>
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
        <div className={styles.pricesHead}>
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
        <p className={styles.hint}>
          Nunca se acumulan: a cada pedido se le aplica una sola, la primera de esta lista que le dé descuento.
          {needle === "" && promotions.length > 1 ? " Arrastralas por su asa para cambiar el orden." : null}
        </p>
        <PromotionRows promotions={shownPromotions} sortable={needle === ""} />
      </section>

      <section aria-labelledby="delivery-title" className={styles.deliveryCard}>
        <div>
          <h2 id="delivery-title">Ajuste de costo de envío</h2>
          <p>Configurá el precio del delivery.</p>
        </div>
        <QuickForm action={saveStoreContactAction} className={styles.deliveryForm} label="Costo de delivery">
          <input name="whatsapp" type="hidden" value={store.whatsapp} />
          <label htmlFor="quick-delivery">Costo de delivery</label>
          <PriceField defaultValue={store.deliveryFee} id="quick-delivery" name="deliveryFee" />
          <QuickSubmit className={styles.smallAction}>Actualizar</QuickSubmit>
        </QuickForm>
      </section>

      <div className={styles.moreSettings}>
        <p>Horarios, WhatsApp y medios de pago:</p>
        <AdminNav />
      </div>
    </div>
  );
}

/** Promotions in the order they are tried; without a search they can be dragged to reorder. */
function PromotionRows({ promotions, sortable }: { promotions: DashboardPromotion[]; sortable: boolean }) {
  const { saveOrder, message } = useOrderSaver(reorderPromotionsAction);
  const { list, rowProps, handleProps } = useDragOrder(promotions, (ids) => saveOrder({ promotionId: ids }));
  const draggable = sortable && list.length > 1;
  return (
    <>
      {message ? (
        <p className={styles.quickError} role="alert">
          {message}
        </p>
      ) : null}
      <ul aria-labelledby="promos-title" className={styles.quickList} id="lista-promociones">
        {list.length === 0 ? <li className={styles.empty}>No hay promociones que coincidan.</li> : null}
        {list.map((promotion, index) => (
          <li className={`${styles.quickRow} ${styles.quickRowPromo}`} key={promotion.id} {...(draggable ? rowProps(promotion.id, index) : {})}>
            {draggable ? (
              <button className={styles.rowGrip} {...handleProps(promotion.id, index, `Mover ${promotion.name}`)}>
                <GripVertical aria-hidden="true" size={18} />
              </button>
            ) : null}
            <QuickRowInfo
              badges={[{ label: promotion.phaseLabel, className: promotion.phaseClass }]}
              description={promotion.explanation}
              href={promotionEditPath(promotion.id)}
              icon={Flame}
              name={promotion.name}
              tag={promotion.badgeText}
            />
            <QuickForm action={setPromotionActiveAction} className={styles.quickControls} label={`Estado de ${promotion.name}`}>
              <span className={styles.priceValue}>{promotion.valueLabel}</span>
              <Link className={styles.smallActionLink} href={promotionEditPath(promotion.id)}>
                Editar
              </Link>
              <input name="promotionId" type="hidden" value={promotion.id} />
              <QuickToggle defaultChecked={promotion.active} label={`${promotion.name} activa`} name="active" offLabel="Pausada" onLabel="Activa" />
            </QuickForm>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The price-and-stock rows; with one category chosen they can be dragged into the menu's order. */
function ProductRows({ products, sortable, categoryId }: { products: DashboardProduct[]; sortable: boolean; categoryId: string | null }) {
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
            {...(sortable ? rowProps(product.form.id, index) : {})}
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

function QuickRowInfo({
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

/**
 * Open or close the store, as the capture's switch: on sets "Abierto", off sets "Cerrado". Pausing
 * or going back to the opening hours stays on the store screen.
 */
function StoreSwitch({ open, reason }: { open: boolean; reason: string }) {
  const override = useRef<HTMLInputElement>(null);
  return (
    <label className={styles.storeSwitch}>
      <span>{open ? "Local abierto · recibiendo pedidos" : `Local cerrado · ${reason}`}</span>
      <input name="statusOverride" ref={override} type="hidden" defaultValue={open ? "open" : "closed"} />
      <input
        aria-label="Local abierto"
        defaultChecked={open}
        onChange={(event) => {
          if (override.current) override.current.value = event.currentTarget.checked ? "open" : "closed";
          event.currentTarget.form?.requestSubmit();
        }}
        type="checkbox"
      />
    </label>
  );
}
