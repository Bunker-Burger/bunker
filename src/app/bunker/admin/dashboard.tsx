"use client";

import { CirclePlus, CupSoda, Flame, Hamburger, Popcorn, Sandwich, Search, Store, Tag, UtensilsCrossed, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type CSSProperties } from "react";
import { normalizeSearch } from "@/components/storefront/menu-sections";
import type { ProductType } from "@/domain/types";
import styles from "../admin.module.css";
import { saveProductAction } from "./catalogo/actions";
import type { ProductFormValues } from "./catalogo/product-form";
import { ADMIN_CATALOG_PATH, productEditPath } from "./catalogo/form-state";
import { ADMIN_PROMOTIONS_PATH, promotionEditPath } from "./paths";
import { setPromotionActiveAction } from "./promociones/actions";
import { QuickForm, QuickSubmit, QuickToggle } from "./quick-form";
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
export function AdminDashboard({ products, promotions, store }: { products: DashboardProduct[]; promotions: DashboardPromotion[]; store: DashboardStore }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const needle = normalizeSearch(query);
  const categories = [...new Set(products.map((product) => product.categoryName).filter(Boolean))];
  const shownProducts = products.filter(
    (product) => (category === null || product.categoryName === category) && normalizeSearch(`${product.form.name} ${product.description}`).includes(needle)
  );
  const shownPromotions = promotions.filter((promotion) => normalizeSearch(`${promotion.name} ${promotion.explanation}`).includes(needle));

  return (
    <div className={styles.dashboard}>
      {/* Side column on desktop; on phones its cards keep the capture's order around the list. */}
      <div className={styles.dashboardSide}>
      <section aria-labelledby="store-state-title" className={styles.statusCard}>
        <div className={styles.statusHead}>
          <span className={styles.statusTitle}>
            <Store aria-hidden="true" size={18} />
            <span id="store-state-title">Estado del local</span>
          </span>
          <span className={styles[`state_${store.state}`]}>{store.stateLabel}</span>
        </div>
        <p className={styles.statusReason}>{store.reason}</p>
        <QuickForm action={setStoreStatusAction} className={styles.statusForm} label="Abrir o cerrar el local">
          <StoreSwitch open={store.state === "open"} />
        </QuickForm>
      </section>

      <div className={styles.toolbar}>
        <label className={styles.searchField}>
          <Search aria-hidden="true" size={18} />
          <span className="sr-only">Buscar producto o promoción</span>
          <input onChange={(event) => setQuery(event.target.value)} placeholder="Buscar producto o promo…" type="search" value={query} />
        </label>
        <div className={styles.toolbarActions}>
          <Link className={styles.addPrimary} href={`${ADMIN_CATALOG_PATH}/productos/nuevo`}>
            <CirclePlus aria-hidden="true" size={18} /> Producto
          </Link>
          <Link className={styles.addSecondary} href={`${ADMIN_PROMOTIONS_PATH}/nueva`}>
            <CirclePlus aria-hidden="true" size={18} /> Promoción
          </Link>
        </div>
        <div aria-label="Categorías" className={styles.categoryPills} role="group">
          <button aria-pressed={category === null} onClick={() => setCategory(null)} type="button">
            Todas ({products.length})
          </button>
          {categories.map((name) => (
            <button aria-pressed={category === name} key={name} onClick={() => setCategory(name)} type="button">
              {name}
            </button>
          ))}
        </div>
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

        <ul aria-label="Productos" className={styles.quickList} id="lista-productos">
            {shownProducts.length === 0 ? <li className={styles.empty}>No hay productos que coincidan.</li> : null}
            {shownProducts.map((product) => (
              <li className={product.form.inStock ? styles.quickRow : `${styles.quickRow} ${styles.quickRowOff}`} key={product.form.id}>
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
                  <span className={styles.priceInput}>
                    <span aria-hidden="true">$</span>
                    <input aria-label={`Precio de ${product.form.name}`} defaultValue={product.form.price} inputMode="decimal" min={0} name="price" step="0.01" type="number" />
                  </span>
                  <QuickSubmit ariaLabel={`Guardar precio de ${product.form.name}`} className={styles.smallAction}>
                    Guardar
                  </QuickSubmit>
                  <QuickToggle defaultChecked={product.form.inStock} label={`${product.form.name} disponible`} name="inStock" offLabel="Pausado" onLabel="Disponible" />
                </QuickForm>
              </li>
            ))}
        </ul>

        <h3 className={styles.promosTitle} id="promos-title">
          <Tag aria-hidden="true" size={20} /> Promociones &amp; combos activos
        </h3>
        <ul aria-labelledby="promos-title" className={styles.quickList} id="lista-promociones">
            {shownPromotions.length === 0 ? <li className={styles.empty}>No hay promociones que coincidan.</li> : null}
            {shownPromotions.map((promotion) => (
              <li className={`${styles.quickRow} ${styles.quickRowPromo}`} key={promotion.id}>
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
      </section>

      <section aria-labelledby="delivery-title" className={styles.deliveryCard}>
        <div>
          <h2 id="delivery-title">Ajuste de costo de envío</h2>
          <p>Configurá el precio del delivery.</p>
        </div>
        <QuickForm action={saveStoreContactAction} className={styles.deliveryForm} label="Costo de delivery">
          <input name="whatsapp" type="hidden" value={store.whatsapp} />
          <label htmlFor="quick-delivery">Costo de delivery</label>
          <span className={styles.priceInput}>
            <span aria-hidden="true">$</span>
            <input defaultValue={store.deliveryFee} id="quick-delivery" inputMode="decimal" min={0} name="deliveryFee" step="0.01" type="number" />
          </span>
          <QuickSubmit className={styles.smallAction}>Actualizar</QuickSubmit>
        </QuickForm>
      </section>
    </div>
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
function StoreSwitch({ open }: { open: boolean }) {
  const override = useRef<HTMLInputElement>(null);
  return (
    <label className={styles.storeSwitch}>
      <span>{open ? "Local abierto · recibiendo pedidos" : "Local cerrado · no recibe pedidos"}</span>
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
