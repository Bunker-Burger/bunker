"use client";

import {
  Banknote,
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
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
import { promotionalPrice, type PromotionLine } from "@/domain/promotions";
import { toPromotionRule } from "@/domain/public-promotions";
import { PUBLIC_PAYMENT_NOTE } from "@/domain/public-payment-options";
import type { CartLine, FulfilmentMethod, PaymentMethodKind, Product, PromotionRule, PublicCatalogSnapshot, SelectedOptions } from "@/domain/types";
import { formatArs } from "@/lib/money";
import { useOnlineStatus } from "@/lib/use-online-status";
import { useCart, useRevalidationNotice, useStorageDegraded } from "@/lib/cart-store";
import { STORE_TIMEZONE } from "@/data/catalog";
import { ALLERGEN_NOTICE, LEGAL_PAGES, PAYMENT_DATA_RETENTION_NOTICE } from "@/content/legal";
import { InstallPrompt } from "@/components/pwa/install-prompt";
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
import { focalStyle } from "./focal-style";
import { useNow } from "./use-now";
import { usePublicCatalog, type CatalogVerificationStatus } from "./use-public-catalog";
import { usePublicPromotions } from "./use-public-promotions";
import { acceptsOrdersNow, describeStoreStatus, useStoreStatus, type StoreStatusView } from "./use-store-status";
import { useWhatsAppCheckout, type WhatsAppCheckoutRequest } from "./use-whatsapp-checkout";
import { Menu } from "./menu";
import { OrderReturnModal } from "./order-return-modal";
import "./storefront.css";

const SECTION_IDS = ["menu", "carrito", "checkout"] as const;
const INVALID_PRODUCT_NOTICE = "Ese producto ya no está disponible.";
const PENDING_PRODUCT_NOTICE = "Buscando el producto en la carta…";
const UNVERIFIED_PRODUCT_NOTICE = "No pudimos confirmar ese producto con el local todavía. Reintentamos en un momento.";
const DEFAULT_PAYMENT_METHODS: readonly PaymentMethodKind[] = ["cash", "bank_transfer", "mercado_pago"];

function removeProductParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete("producto");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export interface StorefrontProps {
  initialProductSlug: string | null;
  mercadoPagoEnabled: boolean;
  /** Methods the store has enabled (`store_payment_methods`); the server enforces them again. */
  paymentMethods?: readonly PaymentMethodKind[] | undefined;
  showAdminNav?: boolean;
  onInvalidProduct?: () => void;
  /**
   * Snapshot the page was rendered with (empty when nothing is published), or null when the
   * server could not read the catalog; the client then re-reads it and that answer is the truth.
   */
  initialCatalog?: PublicCatalogSnapshot | null | undefined;
  /** Without a snapshot: the demo menu (no Supabase configured) or nothing until the server answers (BB-18). */
  catalogFallback?: "demo" | "empty";
  initialReturnReference?: string | null;
  initialReturnPaymentId?: string | null;
  onCheckoutRedirect?: ((url: string) => void) | undefined;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab and Shift+Tab inside the open dialog (aria-modal alone does not stop the keyboard). */
function trapFocus(event: KeyboardEvent, container: HTMLElement | null) {
  if (!container) return;
  const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  const active = document.activeElement;
  const outside = !container.contains(active);
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus();
  }
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
  initialCatalog = null,
  catalogFallback = "demo",
  initialReturnReference = null,
  initialReturnPaymentId = null,
  onCheckoutRedirect
}: StorefrontProps) {
  const [returnRef, setReturnRef] = useState<string | null>(() => {
    if (initialReturnReference) return initialReturnReference;
    if (typeof window !== "undefined") {
      return new URLSearchParams(window.location.search).get("ref");
    }
    return null;
  });
  const [returnPaymentId, setReturnPaymentId] = useState<string | null>(() => {
    if (initialReturnPaymentId) return initialReturnPaymentId;
    if (typeof window !== "undefined") {
      const searchParams = new URLSearchParams(window.location.search);
      return searchParams.get("payment_id") ?? searchParams.get("collection_id");
    }
    return null;
  });

  useEffect(() => {
    const handlePopState = () => {
      const searchParams = new URLSearchParams(window.location.search);
      const ref = searchParams.get("ref");
      if (ref) {
        setReturnRef(ref);
        setReturnPaymentId(searchParams.get("payment_id") ?? searchParams.get("collection_id"));
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const now = useNow();
  const storeStatus = useStoreStatus();
  const [fulfilment, setFulfilment] = useState<FulfilmentMethod>("pickup");
  const [cart, setCart] = useCart();
  const { products, categories, verificationStatus, verifiedGeneration, recheckProducts } = usePublicCatalog({ initialCatalog, fallback: catalogFallback });
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
  // Versions of everything a server quote depends on beyond the request itself: a new catalog
  // verification, store status or promotion set discards any quote shown so far.
  const quoteFreshness = JSON.stringify([
    verifiedGeneration,
    storeStatus.kind === "ready" ? storeStatus.status : storeStatus.kind,
    publicPromotions
  ]);
  const deliveryFeeCents =
    storeStatus.kind === "ready" && storeStatus.status.deliveryFeeCents !== null ? BigInt(storeStatus.status.deliveryFeeCents) : null;
  const timezone = storeStatus.kind === "ready" ? storeStatus.status.timezone : STORE_TIMEZONE;
  // The card price is what this product alone would cost with the selected fulfilment.
  const cardContext = now
    ? { now, timezone, fulfilment, deliveryCents: fulfilment === "delivery" ? deliveryFeeCents ?? 0n : 0n }
    : null;
  const [editingLine, setEditingLine] = useState<CartLine | null>(null);

  // The product in the URL (or being edited). It is only judged against a verified catalog: a
  // server-rendered or fallback copy may be stale, so an unknown slug waits for the fresh read.
  const [activeSlug, setActiveSlug] = useState(initialProductSlug);
  const [notice, setNotice] = useState("");
  const [revalidationNotice, setRevalidationNotice] = useRevalidationNotice();
  const onInvalidProductRef = useRef(onInvalidProduct);

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

  useEffect(() => {
    const syncRoute = () => setActiveSlug(new URL(window.location.href).searchParams.get("producto"));
    window.addEventListener("popstate", syncRoute);
    return () => window.removeEventListener("popstate", syncRoute);
  }, []);

  const activeProduct = activeSlug
    ? products.find((product) => product.published && product.slug === activeSlug)
    : undefined;
  const slugUnresolved = activeSlug !== null && activeProduct === undefined;
  const slugRejected = slugUnresolved && verificationStatus === "verified";

  // A verified catalog without the product (never existed, or retired since the page or the
  // fallback was rendered): close it, clean the URL and say so. Pending/unverified keeps the URL.
  const [rejection, setRejection] = useState<{ slug: string; id: number } | null>(null);
  if (slugRejected) {
    setRejection((previous) => ({ slug: activeSlug, id: (previous?.id ?? 0) + 1 }));
    setActiveSlug(null);
    setEditingLine(null);
    setNotice(INVALID_PRODUCT_NOTICE);
  }
  useEffect(() => {
    if (!rejection) return;
    if (new URL(window.location.href).searchParams.get("producto") === rejection.slug) removeProductParam();
    onInvalidProductRef.current?.();
  }, [rejection]);
  const linkNotice = slugUnresolved && !slugRejected
    ? verificationStatus === "pending" ? PENDING_PRODUCT_NOTICE : UNVERIFIED_PRODUCT_NOTICE
    : "";

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

  // The install suggestion waits for a real interaction in this visit, not a cart restored from storage.
  const [addedThisVisit, setAddedThisVisit] = useState(false);

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
    setAddedThisVisit(true);
  };

  const keyboardOpen = useVirtualKeyboardOpen();
  const activeSection = useActiveSection(SECTION_IDS);
  const itemCount = cart.reduce((total, line) => total + line.quantity, 0);
  const subtotal = cart.reduce((total, line) => total + line.unitPriceCents * BigInt(line.quantity), 0n);

  const navItems: BottomNavItem[] = [
    { href: "#menu", label: "Menú", icon: UtensilsCrossed },
    { href: "#carrito", label: "Carrito", icon: ShoppingBag, badge: itemCount },
    { href: "#checkout", label: "Checkout", icon: CircleDollarSign },
    ...(showAdminNav ? [{ href: "/bunker/admin", label: "Admin", icon: Settings2 }] : [])
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
      {revalidationNotice || notice || linkNotice ? (
        <div className="toast" role="status">{revalidationNotice || notice || linkNotice}</div>
      ) : null}
      <InstallPrompt engaged={addedThisVisit} />

      <section className="menu-section" id="menu" aria-labelledby="menu-title">
        <div className="menu-intro">
          <p>Hechas al fuego. Sin vueltas.</p>
          <h1 id="menu-title">LA CARTA DEL BÚNKER</h1>
        </div>

        <Menu
          categories={categories}
          onAdd={addDirect}
          onOpen={openProduct}
          products={products}
          promotionFor={(product) => (cardContext ? promotionalPrice(product, promotions, cardContext) : null)}
          unavailable={catalogFallback === "empty" && initialCatalog === null && verifiedGeneration === 0}
        />
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
        quoteFreshness={quoteFreshness}
        products={products}
        promotions={promotions}
        storeStatus={storeStatus}
        timezone={timezone}
        verificationStatus={verificationStatus}
        onCheckoutRedirect={onCheckoutRedirect}
      />

      <footer className="store-legal">
        <p>{ALLERGEN_NOTICE}</p>
        {/* Quitar `hidden` de este contenedor cuando se quieran mostrar los enlaces. */}
        <div hidden>
          <nav aria-label="Textos legales">
            {LEGAL_PAGES.map((page) => (
              <a href={page.href} key={page.href}>{page.label}</a>
            ))}
          </nav>
        </div>
      </footer>

      {itemCount > 0 && !keyboardOpen ? (
        <a className="cart-tray" href="#carrito">
          <span><strong>{itemCount}</strong> {itemCount === 1 ? "producto" : "productos"}</span>
          <strong>{formatArs(subtotal)} <ChevronRight size={18} aria-hidden="true" /></strong>
        </a>
      ) : null}

      {activeProduct ? (
        <ProductDrawer
          // A different product (Back/Forward between two) is a new dialog with its own defaults.
          key={`${activeProduct.id}:${editingLine?.id ?? "new"}`}
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
              setAddedThisVisit(true);
            }
            closeProduct();
          }}
          product={activeProduct}
        />
      ) : null}

      {returnRef ? (
        <OrderReturnModal
          externalReference={returnRef}
          paymentId={returnPaymentId}
          onClose={() => {
            setReturnRef(null);
            setReturnPaymentId(null);
            const url = new URL(window.location.href);
            url.searchParams.delete("ref");
            url.searchParams.delete("payment_id");
            url.searchParams.delete("collection_id");
            url.searchParams.delete("collection_status");
            url.searchParams.delete("payment_type");
            url.searchParams.delete("status");
            url.searchParams.delete("preference_id");
            url.searchParams.delete("merchant_order_id");
            window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
          }}
          onApproved={() => {
            setCart([]);
            clearCart();
          }}
        />
      ) : null}
    </AppShell>
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const summaryId = useId();
  const slug = product.slug;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Focus moves to the close button once, on open: a parent re-render (status, promotions or
  // checkout answers) must not pull focus out of the field being typed in. Closing (button,
  // Escape, Back or adding) returns focus to whatever opened the drawer and the page to where it
  // was; a drawer opened from a shared link returns to its product's card.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const scrollY = window.scrollY;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      else if (event.key === "Tab") trapFocus(event, dialogRef.current);
    };
    document.body.classList.add("drawer-open");
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("drawer-open");
      window.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected) {
        opener.focus({ preventScroll: true });
        if (Math.abs(window.scrollY - scrollY) > 1) window.scrollTo({ top: scrollY });
        return;
      }
      document.querySelector<HTMLElement>(`[data-product-trigger="${CSS.escape(slug)}"]`)?.focus();
    };
  }, [slug]);

  const applicableGroups = getApplicableOptionGroups(product);
  const validation = validateOptionSelection(product, selected);
  const isValid = validation.ok;
  const unitPrice = calculateConfiguredUnitPrice(product, selected);

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div aria-describedby={summaryId} aria-label={`Personalizar ${product.name}`} aria-modal="true" className="product-drawer" ref={dialogRef} role="dialog">
        <div className="drawer-grabber" />
        <button aria-label="Cerrar personalizador" className="close-button" onClick={onClose} ref={closeRef} type="button"><X /></button>
        {/* eslint-disable-next-line @next/next/no-img-element -- mock photography; next/image lands with real assets (BB-02) */}
        {product.imageUrl ? <img alt={product.imageAlt ?? product.name} className="drawer-image" src={product.imageUrl} style={focalStyle(product)} /> : null}
        <div className="drawer-content">
          <div className="drawer-title"><h2>{product.name}</h2><strong>{formatArs(product.priceCents)}</strong></div>
          <p className="sr-only" id={summaryId}>
            {`Precio ${formatArs(product.priceCents)}. ${product.inStock ? "Disponible." : "Agotado, no se puede agregar al carrito."}`}
          </p>
          {!product.inStock ? <p className="drawer-sold-out" aria-hidden="true">Agotado · no se puede agregar al carrito</p> : null}
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
            disabled={!isValid || !product.inStock}
            onClick={() => {
              if (!isValid || !product.inStock) return;
              onSubmit(makeCartLine(product, selected, quantity, notes));
            }}
            type="button"
          >
            {!product.inStock ? (
              "Producto agotado"
            ) : initialLine ? (
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

/** Same choices, same JSON: empty groups dropped and groups in a stable order. */
function canonicalSelections(selections: SelectedOptions): SelectedOptions {
  return Object.fromEntries(
    Object.entries(selections)
      .filter(([, optionIds]) => optionIds.length > 0)
      .sort(([a], [b]) => a.localeCompare(b))
  );
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
  quoteFreshness,
  storeStatus,
  deliveryFeeCents,
  timezone,
  onCheckoutRedirect
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
  quoteFreshness: string;
  storeStatus: StoreStatusView;
  deliveryFeeCents: bigint | null;
  timezone: string;
  onCheckoutRedirect?: ((url: string) => void) | undefined;
}) {
  const offered: PaymentMethod[] = [
    ...(mercadoPagoEnabled && paymentMethods.includes("mercado_pago") ? ["mercado-pago" as const] : []),
    ...(paymentMethods.includes("bank_transfer") ? ["transfer" as const] : []),
    ...(paymentMethods.includes("cash") ? ["cash" as const] : [])
  ];
  const [selectedPayment, setPayment] = useState<PaymentMethod | null>(null);
  const payment = selectedPayment !== null && offered.includes(selectedPayment) ? selectedPayment : offered[0] ?? null;

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [isSubmittingMp, setIsSubmittingMp] = useState(false);
  const [mpError, setMpError] = useState<string | null>(null);
  const checkoutNonceRef = useRef<string | null>(null);

  useEffect(() => {
    checkoutNonceRef.current = null;
  }, [cart, fulfilment]);

  const isCustomerValid = customerName.trim().length >= 2 && customerPhone.trim().length >= 6;
  // Offline the menu can still be browsed from the cache, but nothing is sent or paid (BB-16).
  const online = useOnlineStatus();
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
  // A status being re-read authorizes nothing until the server answers again (fail closed).
  const acceptingOrders = acceptsOrdersNow(storeStatus);
  const deliveryPending = fulfilment === "delivery" && deliveryFeeCents === null;
  const hasValidLines = cart.length > 0;
  const isVerified = verificationStatus === "verified";

  const canSubmitMp =
    online &&
    acceptingOrders &&
    isVerified &&
    hasValidLines &&
    !deliveryPending &&
    isCustomerValid &&
    !isSubmittingMp;

  const handleMercadoPagoSubmit = async () => {
    if (!canSubmitMp) return;
    setIsSubmittingMp(true);
    setMpError(null);
    if (!checkoutNonceRef.current) {
      checkoutNonceRef.current = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `nonce-${Date.now()}`;
    }
    try {
      const payload = {
        items: cart.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          optionSelections: canonicalSelections(line.selectedOptions),
          notes: line.notes
        })),
        fulfilment,
        paymentMethod: "mercado_pago" as const,
        customer: {
          name: customerName.trim(),
          phone: customerPhone.trim()
        },
        intentNonce: checkoutNonceRef.current
      };

      const res = await fetch("/api/checkout/mercado-pago", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 409) {
          setMpError("El local no está recibiendo pedidos en este momento.");
        } else if (res.status === 429) {
          setMpError("Demasiadas solicitudes. Por favor esperá un minuto antes de reintentar.");
        } else if (res.status === 503) {
          setMpError("Mercado Pago no está disponible en este momento.");
        } else if (data?.error === "invalid_cart") {
          checkoutNonceRef.current = null;
          onCartRejected();
          setMpError("El carrito cambió de precio o disponibilidad. Revisá el pedido.");
        } else {
          setMpError(data?.message || "No se pudo iniciar el pago con Mercado Pago.");
        }
        setIsSubmittingMp(false);
        return;
      }

      if (data?.checkoutUrl) {
        checkoutNonceRef.current = null;
        if (onCheckoutRedirect) {
          onCheckoutRedirect(data.checkoutUrl);
        } else if (typeof window.location.assign === "function") {
          window.location.assign(data.checkoutUrl);
        } else {
          window.location.href = data.checkoutUrl;
        }
      } else {
        setMpError("Respuesta inesperada de Mercado Pago.");
        setIsSubmittingMp(false);
      }
    } catch {
      setMpError("Error de conexión al procesar el pago. Revisá tu conexión a internet.");
      setIsSubmittingMp(false);
    }
  };

  // Only ids, quantities, notes and choices go to the server, which prices them and builds the
  // WhatsApp message; nothing is requested while the order could not be sent anyway.
  const request = useMemo<WhatsAppCheckoutRequest | null>(
    () =>
      acceptingOrders && isVerified && hasValidLines && (payment === "cash" || payment === "transfer")
        ? {
            items: cart.map((line) => ({
              productId: line.productId,
              quantity: line.quantity,
              optionSelections: canonicalSelections(line.selectedOptions),
              notes: line.notes
            })),
            fulfilment,
            paymentMethod: payment === "cash" ? "cash_exact" : "transfer"
          }
        : null,
    [acceptingOrders, isVerified, hasValidLines, cart, fulfilment, payment]
  );
  const serverCheckout = useWhatsAppCheckout(request, quoteFreshness);
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
  const blockedLabel = !online
    ? "Sin conexión"
    : storeStatus.kind === "ready" && storeStatus.checking
    ? "Verificando el local…"
    : !acceptingOrders
      ? "No se pueden enviar pedidos ahora"
      : serverCheckout.kind === "loading"
        ? "Calculando el total…"
        : "Enviar pedido por WhatsApp";

  const mpButtonLabel = isSubmittingMp
    ? "Conectando con Mercado Pago…"
    : !online
      ? "Sin conexión"
      : storeStatus.kind === "ready" && storeStatus.checking
      ? "Verificando el local…"
      : !acceptingOrders
        ? "No se pueden enviar pedidos ahora"
        : !hasValidLines
          ? "El carrito está vacío"
          : !isVerified
            ? "Verificando disponibilidad…"
            : deliveryPending
              ? "Confirmando costo de envío…"
              : !isCustomerValid
                ? "Ingresá nombre y teléfono"
                : "Pagar con Mercado Pago";

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
            {offered.includes("mercado-pago") ? <PaymentChoice checked={payment === "mercado-pago"} label="Mercado Pago" note={PUBLIC_PAYMENT_NOTE.mercado_pago} onChange={() => setPayment("mercado-pago")} value="mercado-pago" /> : null}
            {offered.includes("transfer") ? <PaymentChoice checked={payment === "transfer"} label="Transferencia" note={PUBLIC_PAYMENT_NOTE.bank_transfer} onChange={() => setPayment("transfer")} value="transfer" /> : null}
            {offered.includes("cash") ? <PaymentChoice checked={payment === "cash"} label="Efectivo exacto" note={PUBLIC_PAYMENT_NOTE.cash} onChange={() => setPayment("cash")} value="cash" /> : null}
          </fieldset>

          {payment === "mercado-pago" ? (
            <div className="customer-fields" data-testid="mp-customer-fields">
              <label htmlFor="customer-name">
                Nombre y apellido
                <input
                  id="customer-name"
                  name="customerName"
                  type="text"
                  autoComplete="name"
                  placeholder="Ej: Juan Pérez"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  required
                />
              </label>
              <label htmlFor="customer-phone">
                Teléfono / WhatsApp
                <input
                  id="customer-phone"
                  name="customerPhone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="Ej: 11 1234-5678"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  required
                />
              </label>
            </div>
          ) : null}

          <p className="checkout-whatsapp-note">
            {payment === "mercado-pago"
              ? `Solo te pedimos nombre y teléfono para identificar tu pago. La entrega${fulfilment === "delivery" ? " y dirección" : ""} se coordina por WhatsApp tras abonar.`
              : `No te pedimos datos acá: tu nombre${fulfilment === "delivery" ? ", la dirección" : ""} y el pago se coordinan en el chat de WhatsApp del local.`}
            {payment === "mercado-pago" ? (
              <> {PAYMENT_DATA_RETENTION_NOTICE} <a href="/legal/privacidad">Privacidad</a></>
            ) : null}
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
          {!online ? (
            <p aria-live="polite" className="store-status-note text-warning" data-testid="offline-note">
              Sin conexión: podés ver la carta y armar el carrito, pero para enviar o pagar el pedido necesitás internet.
            </p>
          ) : null}
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
          {payment === "mercado-pago" && mpError ? (
            <p className="store-status-note text-warning" data-testid="mp-error" role="alert">
              {mpError}
            </p>
          ) : null}
          {/* Only a total recomputed by the server yields a link; a browser estimate never confirms an order. */}
          {payment === "mercado-pago" ? (
            <button
              className="whatsapp-button"
              data-testid="mp-submit-button"
              disabled={!canSubmitMp}
              onClick={handleMercadoPagoSubmit}
              type="button"
            >
              {mpButtonLabel}
            </button>
          ) : confirmed && online ? (
            <a className="whatsapp-button" href={confirmed.url} rel="noopener noreferrer" target="_blank">
              Enviar pedido por WhatsApp
            </a>
          ) : (
            <button className="whatsapp-button" disabled type="button">
              {blockedLabel}
            </button>
          )}
          <small>
            {payment === "mercado-pago"
              ? "Serás redirigido al sitio seguro de Mercado Pago. Al finalizar el pago volverás a esta página para coordinar la entrega por WhatsApp."
              : confirmed
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
