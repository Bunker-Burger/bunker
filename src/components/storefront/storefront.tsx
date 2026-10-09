"use client";

import {
  Banknote,
  Check,
  ChevronRight,
  CircleDollarSign,
  Minus,
  Plus,
  Settings2,
  ShoppingBag,
  Store,
  Truck,
  UtensilsCrossed,
  X
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import {
  addCartLine,
  clearCart,
  editCartLine,
  formatRevalidationNotice,
  removeCartLine,
  revalidateCart,
  serializeCart
} from "@/domain/cart";
import {
  calculateConfiguredUnitPrice,
  getApplicableOptionGroups,
  getDefaultSelection,
  validateOptionSelection
} from "@/domain/catalog";
import { quoteCart } from "@/domain/pricing";
import { promotionalPrice, type PromotionalPrice, type PromotionLine } from "@/domain/promotions";
import { toPromotionRule } from "@/domain/public-promotions";
import type { CartLine, FulfilmentMethod, PaymentMethodKind, Product, PromotionRule, SelectedOptions } from "@/domain/types";
import { formatArs } from "@/lib/money";
import { useCart, useRevalidationNotice, useStorageDegraded } from "@/lib/cart-store";
import { categoryLabels, products as fallbackProducts, STORE_TIMEZONE, type StoreCategory } from "@/data/catalog";
import { AppShell, SiteHeader } from "@/components/shell/app-shell";
import { useActiveSection } from "@/components/shell/use-active-section";
import { BottomNav, type BottomNavItem } from "@/components/shell/bottom-nav";
import { useVirtualKeyboardOpen } from "@/components/shell/use-virtual-keyboard";
import {
  changeLineQuantity,
  clearOptionGroup,
  toggleOption,
  type PaymentMethod
} from "./storefront-state";
import { useNow } from "./use-now";
import { usePublicCatalog, type CatalogVerificationStatus } from "./use-public-catalog";
import { usePublicPromotions } from "./use-public-promotions";
import { describeStoreStatus, useStoreStatus, type StoreStatusView } from "./use-store-status";
import { useWhatsAppCheckout, type WhatsAppCheckoutRequest } from "./use-whatsapp-checkout";
import "./storefront.css";

const SECTION_IDS = ["menu", "carrito", "checkout"] as const;
const INVALID_PRODUCT_NOTICE = "Ese producto ya no está disponible.";
const categories = Object.keys(categoryLabels) as StoreCategory[];
const DEFAULT_PAYMENT_METHODS: readonly PaymentMethodKind[] = ["cash", "bank_transfer"];

// Browsers leave a focused chip half-cut inside a horizontal scroller; bring it fully into view.
function revealInScroller(event: FocusEvent<HTMLElement>) {
  event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function removeProductParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete("producto");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

interface StorefrontProps {
  initialProductSlug: string | null;
  mercadoPagoEnabled: boolean;
  /** Methods the store has enabled (`store_payment_methods`); the server enforces them again. */
  paymentMethods?: readonly PaymentMethodKind[] | undefined;
  showAdminNav?: boolean;
  onInvalidProduct?: () => void;
  initialProducts?: Product[] | undefined;
}

function makeCartLine(product: Product, selectedOptions: SelectedOptions, quantity: number, notes: string): CartLine {
  return {
    id: product.id,
    productId: product.id,
    productSlug: product.slug,
    productName: product.name,
    unitPriceCents: calculateConfiguredUnitPrice(product, selectedOptions),
    quantity,
    notes,
    selectedOptions
  };
}

export function Storefront({
  initialProductSlug,
  mercadoPagoEnabled,
  paymentMethods = DEFAULT_PAYMENT_METHODS,
  showAdminNav = false,
  onInvalidProduct,
  initialProducts
}: StorefrontProps) {
  const now = useNow();
  const storeStatus = useStoreStatus();
  const [fulfilment, setFulfilment] = useState<FulfilmentMethod>("pickup");
  const [cart, setCart] = useCart();
  const resolvedInitialProducts = initialProducts && initialProducts.length > 0 ? initialProducts : fallbackProducts;
  const { products, verificationStatus, recheckProducts } = usePublicCatalog({
    initialProducts: resolvedInitialProducts
  });
  const storageDegraded = useStorageDegraded();

  /** Promotion items name products by slug; the cart uses the storefront's product ids. */
  const productIdBySlug = useMemo(
    () => new Map(products.map((product) => [product.slug, product.id])),
    [products]
  );

  // Rules published by the server (fresh read, same as the quote); never a static copy.
  const publicPromotions = usePublicPromotions();
  const promotions = useMemo(
    () => publicPromotions.map((promotion) => toPromotionRule(promotion, productIdBySlug)),
    [publicPromotions, productIdBySlug]
  );
  const deliveryFeeCents =
    storeStatus.kind === "ready" && storeStatus.status.deliveryFeeCents !== null ? BigInt(storeStatus.status.deliveryFeeCents) : null;
  const timezone = storeStatus.kind === "ready" ? storeStatus.status.timezone : STORE_TIMEZONE;
  // The card price is what this product alone would cost with the selected fulfilment.
  const cardContext = now
    ? { now, timezone, fulfilment, deliveryCents: fulfilment === "delivery" ? deliveryFeeCents ?? 0n : 0n }
    : null;
  const [category, setCategory] = useState<StoreCategory>("burgers");
  const [editingLine, setEditingLine] = useState<CartLine | null>(null);

  const isKnownSlug = useCallback(
    (slug: string) => products.some((product) => product.slug === slug),
    [products]
  );

  const [initialSlugInvalid] = useState(
    () => initialProductSlug !== null && !resolvedInitialProducts.some((p) => p.slug === initialProductSlug)
  );
  const [activeSlug, setActiveSlug] = useState(initialSlugInvalid ? null : initialProductSlug);
  const [notice, setNotice] = useState(initialSlugInvalid ? INVALID_PRODUCT_NOTICE : "");
  const [revalidationNotice, setRevalidationNotice] = useRevalidationNotice();
  const onInvalidProductRef = useRef(onInvalidProduct);
  const invalidSlugHandled = useRef(false);

  // Only revalidate the persisted cart when the catalog has been verified against the server.
  // Never wipe or alter cart lines while verification is pending or if it failed (503 / network).
  useEffect(() => {
    if (verificationStatus !== "verified") {
      return;
    }

    const revalidation = revalidateCart(cart, products);
    if (revalidation.hasChanges) {
      setCart(revalidation.validLines);
      if (revalidation.issues.length > 0) {
        setRevalidationNotice(formatRevalidationNotice(revalidation.issues));
      }
    }
  }, [verificationStatus, products, cart, setCart, setRevalidationNotice]);

  useEffect(() => {
    onInvalidProductRef.current = onInvalidProduct;
  }, [onInvalidProduct]);

  const rejectInvalidSlug = useCallback(() => {
    removeProductParam();
    onInvalidProductRef.current?.();
  }, []);

  useEffect(() => {
    if (!initialSlugInvalid || invalidSlugHandled.current) return;
    invalidSlugHandled.current = true;
    rejectInvalidSlug();
  }, [initialSlugInvalid, rejectInvalidSlug]);

  useEffect(() => {
    const syncRoute = () => {
      const slug = new URL(window.location.href).searchParams.get("producto");
      if (slug !== null && !isKnownSlug(slug)) {
        setNotice(INVALID_PRODUCT_NOTICE);
        setActiveSlug(null);
        rejectInvalidSlug();
        return;
      }
      setActiveSlug(slug);
    };
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, [isKnownSlug, rejectInvalidSlug]);

  const activeProduct = activeSlug ? products.find((product) => product.slug === activeSlug) : undefined;

  const openProduct = (product: Product) => {
    const url = new URL(window.location.href);
    url.searchParams.set("producto", product.slug);
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
    setEditingLine(null);
    setActiveSlug(product.slug);
  };

  const handleEditLine = (lineToEdit: CartLine) => {
    const product = products.find((p) => p.id === lineToEdit.productId);
    if (!product) return;
    setEditingLine(lineToEdit);
    setActiveSlug(product.slug);
  };

  const closeProduct = () => {
    removeProductParam();
    setActiveSlug(null);
    setEditingLine(null);
  };

  const addDirect = (product: Product) => {
    if (!product.inStock) return;
    const defaults = getDefaultSelection(product);
    const validation = validateOptionSelection(product, defaults);
    if (!validation.ok) {
      setNotice(`No se puede agregar ${product.name}: configuración incompleta.`);
      return;
    }
    setCart((current) => addCartLine(current, makeCartLine(product, defaults, 1, "")));
    setRevalidationNotice("");
    setNotice(`${product.name} se agregó al carrito.`);
  };

  const keyboardOpen = useVirtualKeyboardOpen();
  const activeSection = useActiveSection(SECTION_IDS);
  const itemCount = cart.reduce((total, line) => total + line.quantity, 0);
  const subtotal = cart.reduce((total, line) => total + line.unitPriceCents * BigInt(line.quantity), 0n);
  const visibleProducts = products.filter((product) => {
    if (!product.published) return false;
    if (product.categoryId === category) return true;
    if (category === "burgers" && product.type === "burger") return true;
    if (category === "sandwiches" && product.type === "sandwich") return true;
    if (category === "fries" && product.type === "fries") return true;
    if (category === "drinks" && product.type === "beverage") return true;
    return false;
  });

  const navItems: BottomNavItem[] = [
    { href: "#menu", label: "Menú", icon: UtensilsCrossed },
    { href: "#carrito", label: "Carrito", icon: ShoppingBag, badge: itemCount },
    { href: "#checkout", label: "Checkout", icon: CircleDollarSign },
    ...(showAdminNav ? [{ href: "/bunker", label: "Admin", icon: Settings2 }] : [])
  ];

  return (
    <AppShell
      header={
        <SiteHeader>
          <a className="brand" href="#menu" aria-label="Búnker Burger, ir al menú">
            <span className="brand-mark" aria-hidden="true">BB</span>
            <span>BÚNKER BURGER</span>
          </a>
          <a className="header-cart" href="#carrito" aria-label={`Carrito, ${itemCount} productos`}>
            <ShoppingBag size={20} aria-hidden="true" />
            {itemCount > 0 ? <span>{itemCount}</span> : null}
          </a>
        </SiteHeader>
      }
      bottomNav={<BottomNav activeHref={`#${activeSection}`} items={navItems} />}
    >
      {revalidationNotice || notice ? <div className="toast" role="status">{revalidationNotice || notice}</div> : null}

      <section className="menu-section" id="menu" aria-labelledby="menu-title">
        <div className="menu-intro">
          <p>Hechas al fuego. Sin vueltas.</p>
          <h1 id="menu-title">LA CARTA DEL BÚNKER</h1>
        </div>

        <div className="category-tabs" aria-label="Categorías">
          {categories.map((key) => (
            <button
              className={category === key ? "category-tab active" : "category-tab"}
              key={key}
              onClick={() => setCategory(key)}
              onFocus={revealInScroller}
              type="button"
            >
              {categoryLabels[key]}
            </button>
          ))}
        </div>

        <div className="section-heading">
          <div>
            <span>{category === "burgers" ? "LAS MÁS PEDIDAS" : "ELEGÍ TU FAVORITO"}</span>
            <h2>{categoryLabels[category]}</h2>
          </div>
          <span>{visibleProducts.length} opciones</span>
        </div>

        <div className="product-grid">
          {visibleProducts.map((product, index) => (
            <ProductCard
              promotion={cardContext ? promotionalPrice(product, promotions, cardContext) : null}
              featured={category === "burgers" && index === 0}
              key={product.id}
              onAdd={() => addDirect(product)}
              onOpen={() => openProduct(product)}
              product={product}
            />
          ))}
        </div>
      </section>

      <CartSection
        cart={cart}
        onChange={setCart}
        onEditLine={handleEditLine}
        subtotal={subtotal}
        storageDegraded={storageDegraded}
      />
      <CheckoutSection
        cart={cart}
        deliveryFeeCents={deliveryFeeCents}
        fulfilment={fulfilment}
        mercadoPagoEnabled={mercadoPagoEnabled}
        now={now}
        onCartRejected={recheckProducts}
        onFulfilmentChange={setFulfilment}
        paymentMethods={paymentMethods}
        products={products}
        promotions={promotions}
        storeStatus={storeStatus}
        timezone={timezone}
        verificationStatus={verificationStatus}
      />

      {itemCount > 0 && !keyboardOpen ? (
        <a className="cart-tray" href="#carrito">
          <span><strong>{itemCount}</strong> {itemCount === 1 ? "producto" : "productos"}</span>
          <strong>{formatArs(subtotal)} <ChevronRight size={18} aria-hidden="true" /></strong>
        </a>
      ) : null}

      {activeProduct ? (
        <ProductDrawer
          initialLine={editingLine}
          onClose={closeProduct}
          onSubmit={(submittedLine) => {
            if (editingLine) {
              setCart((current) =>
                editCartLine(current, editingLine.id, {
                  selectedOptions: submittedLine.selectedOptions,
                  unitPriceCents: submittedLine.unitPriceCents,
                  notes: submittedLine.notes,
                  quantity: submittedLine.quantity
                })
              );
              setNotice(`${submittedLine.productName} se actualizó en el carrito.`);
              setEditingLine(null);
            } else {
              setCart((current) => addCartLine(current, submittedLine));
              setNotice(`${submittedLine.productName} se agregó al carrito.`);
            }
            closeProduct();
          }}
          product={activeProduct}
        />
      ) : null}
    </AppShell>
  );
}

function ProductCard({ product, promotion, featured, onOpen, onAdd }: {
  product: Product;
  promotion: PromotionalPrice | null;
  featured: boolean;
  onOpen: () => void;
  onAdd: () => void;
}) {
  return (
    <article className={`product-card${featured ? " featured" : ""}${!product.inStock ? " sold-out" : ""}`}>
      <button className="product-main" onClick={onOpen} type="button" aria-label={`Ver ${product.name}`}>
        <div className="product-image-wrap">
          {/* Remote mock photography is intentionally kept as reference content until supplied assets arrive. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- mock photography; next/image lands with real assets (BB-02) */}
          {product.imageUrl ? <img alt={product.imageAlt ?? product.name} className="product-image" src={product.imageUrl} /> : null}
          {product.featured ? <span className="featured-dot" aria-label="Destacado"><Check size={16} /></span> : null}
          {!product.inStock ? <span className="sold-out-badge">Agotado</span> : null}
        </div>
        <div className="product-copy">
          <div className="product-title-row">
            <h3>{product.name}</h3>
            <span className="product-price">
              {promotion ? <s className="compare-at"><span className="sr-only">Antes </span>{formatArs(promotion.compareAtPriceCents)}</s> : null}
              <strong>{formatArs(promotion?.priceCents ?? product.priceCents)}</strong>
            </span>
          </div>
          {promotion ? <span className="promo-note">{promotion.promotionName}: {promotion.explanation}</span> : null}
          <p>{product.description}</p>
          <span className="product-meta">{product.type === "burger" ? "SMASH • 200G" : (categoryLabels[product.categoryId as StoreCategory] ?? (product.type === "sandwich" ? "Sándwiches" : product.type === "fries" ? "Papas" : "Bebidas"))}</span>
        </div>
      </button>
      <button className="add-button" disabled={!product.inStock} onClick={onAdd} type="button" aria-label={`Agregar ${product.name}`}>
        {product.inStock ? <>Agregar <Plus size={16} /></> : "Sin stock"}
      </button>
    </article>
  );
}

export function ProductDrawer({ product, initialLine, onClose, onSubmit }: {
  product: Product;
  initialLine?: CartLine | null;
  onClose: () => void;
  onSubmit: (line: CartLine) => void;
}) {
  const [selected, setSelected] = useState<SelectedOptions>(() => initialLine?.selectedOptions ?? getDefaultSelection(product));
  const [quantity, setQuantity] = useState(() => initialLine?.quantity ?? 1);
  const [notes, setNotes] = useState(() => initialLine?.notes ?? "");
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Focus moves to the close button once, on open: a parent re-render (status, promotions or
  // checkout answers) must not pull focus out of the field being typed in.
  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.body.classList.add("drawer-open");
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("drawer-open");
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const applicableGroups = getApplicableOptionGroups(product);
  const validation = validateOptionSelection(product, selected);
  const isValid = validation.ok;
  const unitPrice = calculateConfiguredUnitPrice(product, selected);

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div aria-label={`Personalizar ${product.name}`} aria-modal="true" className="product-drawer" role="dialog">
        <div className="drawer-grabber" />
        <button aria-label="Cerrar personalizador" className="close-button" onClick={onClose} ref={closeRef} type="button"><X /></button>
        {/* eslint-disable-next-line @next/next/no-img-element -- mock photography; next/image lands with real assets (BB-02) */}
        {product.imageUrl ? <img alt={product.imageAlt ?? product.name} className="drawer-image" src={product.imageUrl} /> : null}
        <div className="drawer-content">
          <div className="drawer-title"><h2>{product.name}</h2><strong>{formatArs(product.priceCents)}</strong></div>
          <p>{product.description}</p>

          {applicableGroups.map((group) => {
            const groupSelections = selected[group.id] ?? [];
            const isOptionalSingle = group.selectionMode === "single" && !group.required;
            return (
              <fieldset className="option-group" key={group.id}>
                <legend>
                  <span>{group.name}</span>
                  <div className="option-group-meta">
                    {isOptionalSingle && groupSelections.length > 0 ? (
                      <button
                        aria-label={`Limpiar ${group.name}`}
                        className="clear-option-button"
                        onClick={() => setSelected((current) => clearOptionGroup(current, group.id))}
                        type="button"
                      >
                        Limpiar
                      </button>
                    ) : null}
                    <small>{group.required ? "Requerido" : `Hasta ${group.maxSelections}`}</small>
                  </div>
                </legend>
                {group.options.map((option) => {
                  const checked = groupSelections.includes(option.id);
                  const inputType = group.selectionMode === "single" ? "radio" : "checkbox";
                  const isAvailable = option.available;
                  return (
                    <label className={`option-row${checked ? " selected" : ""}${!isAvailable ? " opacity-50 cursor-not-allowed" : ""}`} key={option.id}>
                      <span>{option.name}{!isAvailable ? <small> (Sin stock)</small> : null}</span>
                      {option.priceDeltaCents > 0n ? <strong>+ {formatArs(option.priceDeltaCents)}</strong> : <small>Incluido</small>}
                      <input
                        checked={checked}
                        disabled={!isAvailable}
                        name={group.id}
                        onChange={() => {
                          if (!isAvailable) return;
                          setSelected((current) =>
                            toggleOption(current, group.id, option.id, group.maxSelections, isAvailable, group.selectionMode, group.required)
                          );
                        }}
                        onClick={() => {
                          if (isOptionalSingle && checked && isAvailable) {
                            setSelected((current) =>
                              toggleOption(current, group.id, option.id, group.maxSelections, isAvailable, group.selectionMode, group.required)
                            );
                          }
                        }}
                        type={inputType}
                      />
                    </label>
                  );
                })}
              </fieldset>
            );
          })}

          <label className="notes-field">
            <span>Aclaraciones para la cocina</span>
            <textarea aria-label="Aclaraciones para la cocina" maxLength={180} onChange={(event) => setNotes(event.target.value)} placeholder="Ej: sin cebolla, salsa aparte…" value={notes} />
          </label>
        </div>
        <div className="drawer-footer">
          <div className="quantity-stepper">
            <button aria-label="Disminuir cantidad" disabled={quantity === 1} onClick={() => setQuantity((value) => Math.max(1, value - 1))} type="button"><Minus /></button>
            <strong>{quantity}</strong>
            <button aria-label="Aumentar cantidad" onClick={() => setQuantity((value) => value + 1)} type="button"><Plus /></button>
          </div>
          <button
            className="primary-action"
            disabled={!isValid}
            onClick={() => {
              if (!isValid) return;
              onSubmit(makeCartLine(product, selected, quantity, notes));
            }}
            type="button"
          >
            {initialLine ? (
              <>Guardar cambios <span>{formatArs(unitPrice * BigInt(quantity))}</span></>
            ) : (
              <>Agregar {quantity} al carrito <span>{formatArs(unitPrice * BigInt(quantity))}</span></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function CartSection({
  cart,
  subtotal,
  onChange,
  onEditLine,
  storageDegraded
}: {
  cart: CartLine[];
  subtotal: bigint;
  onChange: (cart: CartLine[]) => void;
  onEditLine: (line: CartLine) => void;
  storageDegraded?: boolean;
}) {
  return (
    <section className="order-section" id="carrito" aria-labelledby="cart-title">
      <div className="section-heading"><div><span>TU PEDIDO</span><h2 id="cart-title">Carrito</h2></div><ShoppingBag /></div>
      {storageDegraded ? (
        <div
          className="storage-degraded-banner"
          data-testid="storage-degraded-banner"
          role="status"
          style={{
            padding: "0.75rem 1rem",
            marginBottom: "1rem",
            borderRadius: "var(--radius-md)",
            background: "var(--color-surface-raised)",
            border: "1px solid var(--color-border-strong)",
            fontSize: "var(--text-body-sm)",
            color: "var(--color-muted)"
          }}
        >
          ⚠️ El almacenamiento local no está disponible en este navegador. Tu carrito se mantendrá durante esta sesión activa.
        </div>
      ) : null}
      {cart.length === 0 ? (
        <div className="empty-state"><ShoppingBag /><h3>Tu carrito está vacío</h3><p>Elegí algo rico de la carta para empezar.</p><a href="#menu">Ver menú</a></div>
      ) : (
        <div className="cart-panel">
          {cart.map((line) => (
            <div className="cart-line" key={line.id}>
              <div>
                <strong>{line.productName}</strong>
                <small>{line.notes || "Personalización estándar"}</small>
                <span>{formatArs(line.unitPriceCents * BigInt(line.quantity))}</span>
              </div>
              <div className="cart-line-actions">
                <div className="quantity-stepper compact">
                  <button aria-label={`Quitar uno de ${line.productName}`} onClick={() => onChange(changeLineQuantity(cart, line.id, -1))} type="button"><Minus /></button>
                  <strong>{line.quantity}</strong>
                  <button aria-label={`Agregar uno de ${line.productName}`} onClick={() => onChange(changeLineQuantity(cart, line.id, 1))} type="button"><Plus /></button>
                </div>
                <button
                  aria-label={`Editar ${line.productName}`}
                  className="cart-action-btn"
                  onClick={() => onEditLine(line)}
                  type="button"
                >
                  Editar
                </button>
                <button
                  aria-label={`Quitar ${line.productName} del carrito`}
                  className="cart-action-btn text-danger"
                  onClick={() => onChange(removeCartLine(cart, line.id))}
                  type="button"
                >
                  Eliminar
                </button>
              </div>
            </div>
          ))}
          <div className="cart-actions-row">
            <button
              aria-label="Vaciar carrito completo"
              className="clear-cart-btn"
              onClick={() => onChange(clearCart())}
              type="button"
            >
              Vaciar carrito
            </button>
          </div>
          <div className="cart-total"><span>Subtotal</span><strong>{formatArs(subtotal)}</strong></div>
          <a className="primary-action wide" href="#checkout">Continuar al checkout <ChevronRight /></a>
        </div>
      )}
    </section>
  );
}

/** Cart lines as the promotion engine reads them; base prices come from the catalog, not the cart. */
function toPromotionLines(cart: CartLine[], catalogProducts: readonly Product[]): PromotionLine[] {
  return cart.map((line) => {
    const basePriceCents = catalogProducts.find((product) => product.id === line.productId)?.priceCents ?? line.unitPriceCents;
    return {
      productId: line.productId,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      basePriceCents: basePriceCents > line.unitPriceCents ? line.unitPriceCents : basePriceCents
    };
  });
}

/** Why the server refused to give a WhatsApp link for this cart. */
const CHECKOUT_ERRORS: Record<string, string> = {
  store_closed: "El local no está tomando pedidos ahora.",
  invalid_cart: "Algo de tu carrito cambió o ya no está disponible. Revisá el carrito antes de enviarlo.",
  payment_method_unavailable: "Ese método de pago no está disponible ahora. Elegí otro.",
  invalid_request: "No pudimos procesar el pedido. Revisá las cantidades (hasta 20 por producto)."
};

function CheckoutSection({
  cart,
  products,
  verificationStatus,
  mercadoPagoEnabled,
  paymentMethods,
  now,
  promotions,
  fulfilment,
  onFulfilmentChange: setFulfilment,
  onCartRejected,
  storeStatus,
  deliveryFeeCents,
  timezone
}: {
  cart: CartLine[];
  products: readonly Product[];
  verificationStatus: CatalogVerificationStatus;
  mercadoPagoEnabled: boolean;
  paymentMethods: readonly PaymentMethodKind[];
  now: Date | null;
  promotions: readonly PromotionRule[];
  fulfilment: FulfilmentMethod;
  onFulfilmentChange: (fulfilment: FulfilmentMethod) => void;
  onCartRejected: () => void;
  storeStatus: StoreStatusView;
  deliveryFeeCents: bigint | null;
  timezone: string;
}) {
  const offered: PaymentMethod[] = [
    ...(mercadoPagoEnabled ? ["mercado-pago" as const] : []),
    ...(paymentMethods.includes("bank_transfer") ? ["transfer" as const] : []),
    ...(paymentMethods.includes("cash") ? ["cash" as const] : [])
  ];
  const [selectedPayment, setPayment] = useState<PaymentMethod | null>(null);
  const payment = selectedPayment !== null && offered.includes(selectedPayment) ? selectedPayment : offered[0] ?? null;
  const nowMs = now?.getTime() ?? null;
  // Display-only estimate with the same engine the server quote uses; the server recomputes it.
  const estimate = useMemo(
    () =>
      quoteCart(toPromotionLines(cart, products), nowMs === null ? [] : promotions, fulfilment, deliveryFeeCents ?? 0n, {
        now: new Date(nowMs ?? 0),
        timezone
      }),
    [cart, products, fulfilment, deliveryFeeCents, promotions, nowMs, timezone]
  );
  const acceptingOrders = storeStatus.kind === "ready" && storeStatus.status.acceptingOrders;
  const deliveryPending = fulfilment === "delivery" && deliveryFeeCents === null;
  const hasValidLines = cart.length > 0;
  const isVerified = verificationStatus === "verified";

  // Only ids, quantities, notes and choices go to the server, which prices them and builds the
  // WhatsApp message; nothing is requested while the order could not be sent anyway.
  const request = useMemo<WhatsAppCheckoutRequest | null>(
    () =>
      acceptingOrders && isVerified && hasValidLines && (payment === "cash" || payment === "transfer")
        ? {
            items: cart.map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              optionSelections: line.selectedOptions,
              notes: line.notes
            })),
            fulfilment,
            paymentMethod: payment === "cash" ? "cash_exact" : "transfer"
          }
        : null,
    [acceptingOrders, isVerified, hasValidLines, cart, fulfilment, payment]
  );
  const serverCheckout = useWhatsAppCheckout(request);
  const confirmed = serverCheckout.kind === "ready" ? serverCheckout.checkout : null;
  const cartRejected = serverCheckout.kind === "error" && serverCheckout.code === "invalid_cart";

  // A cart the server refuses is re-checked against the catalog (once per cart content), which
  // fixes or flags its lines.
  const cartKey = useMemo(() => serializeCart(cart), [cart]);
  const recheckedCart = useRef<string | null>(null);
  useEffect(() => {
    if (!cartRejected || recheckedCart.current === cartKey) return;
    recheckedCart.current = cartKey;
    onCartRejected();
  }, [cartRejected, cartKey, onCartRejected]);

  const totals = confirmed ?? estimate;
  const promotion = confirmed ? confirmed.promotion : estimate.promotion;
  const blockedLabel = !acceptingOrders
    ? "No se pueden enviar pedidos ahora"
    : payment === "mercado-pago"
      ? "Mercado Pago próximamente"
      : serverCheckout.kind === "loading"
        ? "Calculando el total…"
        : "Enviar pedido por WhatsApp";

  return (
    <section className="order-section checkout" id="checkout" aria-labelledby="checkout-title">
      <div className="section-heading"><div><span>ÚLTIMO PASO</span><h2 id="checkout-title">Finalizar pedido</h2></div><CircleDollarSign /></div>
      <div className="checkout-layout">
        <div className="checkout-form">
          <fieldset className="choice-group">
            <legend>Tipo de entrega</legend>
            <div className="choice-grid">
              <label className={fulfilment === "delivery" ? "choice-card active" : "choice-card"}><input checked={fulfilment === "delivery"} name="fulfilment" onChange={() => setFulfilment("delivery")} type="radio" /><Truck /><span>Delivery</span><strong>{deliveryFeeCents === null ? "A confirmar" : formatArs(deliveryFeeCents)}</strong></label>
              <label className={fulfilment === "pickup" ? "choice-card active" : "choice-card"}><input checked={fulfilment === "pickup"} name="fulfilment" onChange={() => setFulfilment("pickup")} type="radio" /><Store /><span>Retiro en local</span><strong>Gratis</strong></label>
            </div>
          </fieldset>

          <fieldset className="choice-group payment-group">
            <legend>Método de pago</legend>
            {offered.includes("mercado-pago") ? <PaymentChoice checked={payment === "mercado-pago"} label="Mercado Pago" note="Pagá online de forma segura" onChange={() => setPayment("mercado-pago")} value="mercado-pago" /> : null}
            {offered.includes("transfer") ? <PaymentChoice checked={payment === "transfer"} label="Transferencia" note="Pedí el alias por WhatsApp y enviá el comprobante por ese chat" onChange={() => setPayment("transfer")} value="transfer" /> : null}
            {offered.includes("cash") ? <PaymentChoice checked={payment === "cash"} label="Efectivo exacto" note="Tené el importe justo al recibir o retirar" onChange={() => setPayment("cash")} value="cash" /> : null}
          </fieldset>
          <p className="checkout-whatsapp-note">
            No te pedimos datos acá: tu nombre{fulfilment === "delivery" ? ", la dirección" : ""} y el pago se coordinan en el chat de WhatsApp del local.
          </p>
        </div>

        <div className="summary-card">
          <h3>Resumen de la orden</h3>
          {cart.map((line) => <div className="summary-line" key={line.id}><span>{line.quantity}× {line.productName}</span><strong>{formatArs(line.unitPriceCents * BigInt(line.quantity))}</strong></div>)}
          <div className="summary-rule" />
          <div className="summary-line muted"><span>Subtotal</span><strong>{formatArs(totals.subtotalCents)}</strong></div>
          <div className="summary-line muted"><span>Envío</span><strong>{deliveryPending && !confirmed ? "A confirmar" : totals.deliveryCents === 0n ? "$0" : formatArs(totals.deliveryCents)}</strong></div>
          {promotion ? (
            <div className="summary-promotion" data-testid="applied-promotion">
              <div className="summary-line"><span>Promoción: {promotion.name}</span><strong>-{formatArs(totals.discountCents)}</strong></div>
              <small>{promotion.explanation}. No se acumula con otras promociones.</small>
            </div>
          ) : null}
          <div className="summary-total" data-testid="checkout-total"><span>{confirmed ? "Total" : "Total estimado"}</span><strong>{formatArs(totals.totalCents)}</strong></div>
          <p aria-live="polite" className="store-status-note" data-testid="store-status">{describeStoreStatus(storeStatus)}</p>
          {!hasValidLines ? (
            <p aria-live="polite" className="store-status-note text-muted">
              El carrito está vacío. Agregá productos para finalizar el pedido.
            </p>
          ) : null}
          {!isVerified ? (
            <p aria-live="polite" className="store-status-note text-warning" data-testid="verification-status-note">
              {verificationStatus === "pending"
                ? "Verificando disponibilidad de los productos con el servidor…"
                : "Pendiente de verificar: no pudimos confirmar la disponibilidad de los productos con el servidor. Revisá tu conexión."}
            </p>
          ) : null}
          {serverCheckout.kind === "error" ? (
            <p className="store-status-note text-warning" data-testid="checkout-error" role="alert">
              {CHECKOUT_ERRORS[serverCheckout.code] ?? "No pudimos calcular el total con el local. Probá de nuevo en un momento."}
            </p>
          ) : null}
          {/* Only a total recomputed by the server yields a link; a browser estimate never confirms an order. */}
          {confirmed ? (
            <a className="whatsapp-button" href={confirmed.url} rel="noopener noreferrer" target="_blank">
              Enviar pedido por WhatsApp
            </a>
          ) : (
            <button className="whatsapp-button" disabled type="button">
              {blockedLabel}
            </button>
          )}
          <small>
            {confirmed
              ? "Se abre WhatsApp con tu pedido para que el local lo confirme. El carrito queda guardado en este dispositivo."
              : "Podés seguir armando tu pedido: el carrito queda guardado en este dispositivo."}
          </small>
        </div>
      </div>
    </section>
  );
}

function PaymentChoice({ checked, label, note, onChange, value }: { checked: boolean; label: string; note: string; onChange: () => void; value: PaymentMethod }) {
  return (
    <label className={checked ? "payment-choice active" : "payment-choice"}>
      <input checked={checked} name="payment" onChange={onChange} type="radio" value={value} />
      <Banknote aria-hidden="true" />
      <span><strong>{label}</strong><small>{note}</small></span>
    </label>
  );
}
