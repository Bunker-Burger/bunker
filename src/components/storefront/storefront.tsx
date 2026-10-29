"use client";

import { MapPin, 
  ArrowLeft,
  ArrowRight,
  Banknote,
  Check,
  Hamburger,
  Landmark,
  Minus,
  NotebookPen,
  Plus,
  ReceiptText,
  ScrollText,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  Wallet,
  X
} from "lucide-react";
import { Fragment, useEffect, useId, useMemo, useRef, useState } from "react";
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
import { comboCount, removeOneCombo } from "@/domain/combos";
import { MAX_SAME_EXTRA } from "@/domain/options";
import { quoteCart } from "@/domain/pricing";
import { promotionalPrice, type PromotionalPrice, type PromotionLine } from "@/domain/promotions";
import { toPromotionRule, type PublicPromotion } from "@/domain/public-promotions";
import { PUBLIC_PAYMENT_NOTE } from "@/domain/public-payment-options";
import type { CartLine, FulfilmentMethod, PaymentMethodKind, Product, PromotionRule, PublicCatalogSnapshot, SelectedOptions } from "@/domain/types";
import { formatArs } from "@/lib/money";
import { useOnlineStatus } from "@/lib/use-online-status";
import { useCart, useRevalidationNotice, useStorageDegraded } from "@/lib/cart-store";
import { STORE_TIMEZONE } from "@/data/catalog";
import { ALLERGEN_NOTICE, LEGAL_PAGES, PAYMENT_DATA_RETENTION_NOTICE } from "@/content/legal";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { AppShell, SiteHeader } from "@/components/shell/app-shell";
import { BottomNav, type BottomNavItem } from "@/components/shell/bottom-nav";
import { useVirtualKeyboardOpen } from "@/components/shell/use-virtual-keyboard";
import {
  changeLineQuantity,
  clearOptionGroup,
  toggleOption,
  type PaymentMethod
} from "./storefront-state";
import { focalStyle } from "./focal-style";
import { ComboSection, comboContents, comboPromotions, PromoShowcase, showcasePromotions, usePromoLayout } from "./promo-showcase";
import { useNow } from "./use-now";
import { usePublicCatalog, type CatalogVerificationStatus } from "./use-public-catalog";
import { usePublicPromotions } from "./use-public-promotions";
import { acceptsOrdersNow, describeStoreStatus, useStoreStatus, type StoreStatusView } from "./use-store-status";
import { useWhatsAppCheckout, type WhatsAppCheckoutRequest } from "./use-whatsapp-checkout";
import { forgetOrderSent, markOrderSent, shouldAskOrderSent } from "./order-sent";
import { OrderSentPrompt } from "./order-sent-prompt";
import { Menu } from "./menu";
import { OrderReturnModal } from "./order-return-modal";
import { LONG_TOAST_DURATION_MS, StoreToast, TOAST_DURATION_MS, type ToastMessage } from "./store-toast";
import { useStoreView, type StoreView } from "./use-store-view";
import "./storefront.css";

const INVALID_PRODUCT_NOTICE = "Ese producto ya no está disponible.";
const PENDING_PRODUCT_NOTICE = "Buscando el producto en la carta…";
const UNVERIFIED_PRODUCT_NOTICE = "No pudimos confirmar ese producto con el local todavía. Reintentamos en un momento.";
const DEFAULT_PAYMENT_METHODS: readonly PaymentMethodKind[] = ["cash", "bank_transfer", "mercado_pago"];

const VIEW_TITLES: Record<StoreView, string> = { menu: "menu-title", carrito: "cart-title", checkout: "checkout-title" };

/** A stable number for a text, so the same notice keeps its timer and a new one restarts it. */
function textKey(text: string) {
  let hash = 7;
  for (let index = 0; index < text.length; index++) hash = (hash * 31 + text.charCodeAt(index)) | 0;
  return Math.abs(hash) + 2;
}

function removeProductParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete("producto");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

/** Credit in the footer: opens the developer's WhatsApp with a message asking about their services. */
const CREDIT_WHATSAPP_URL = `https://wa.me/543865575688?text=${encodeURIComponent("Hola Lautaro! Vi la carta online de Búnker Burguer y me gustaría consultarte por tus servicios.")}`;

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
  /** Promotions published when the page was rendered, so they arrive with it (null: read them after). */
  initialPromotions?: readonly PublicPromotion[] | null | undefined;
  /** Minute the server rendered the page at, to judge promotion windows the same way on both sides. */
  renderedAt?: number | null | undefined;
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

function makeCartLine(product: Product, selectedOptions: SelectedOptions, quantity: number, notes: string, comboId?: string): CartLine {
  return {
    ...(comboId ? { comboId } : {}),
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
  initialPromotions = null,
  renderedAt = null,
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

  const now = useNow(renderedAt);
  const storeStatus = useStoreStatus();
  const [fulfilment, setFulfilment] = useState<FulfilmentMethod>("pickup");
  const [cart, setCart] = useCart();
  // Back from WhatsApp (the page was hidden, or it is opened again later): ask whether the order
  // went out before emptying the cart. See order-sent.ts.
  const [askOrderSent, setAskOrderSent] = useState(false);
  const leftPageRef = useRef(false);
  const checkedOnLoadRef = useRef(false);
  useEffect(() => {
    const ask = () => {
      if (shouldAskOrderSent(cart, Date.now())) setAskOrderSent(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        leftPageRef.current = true;
      } else if (leftPageRef.current) {
        leftPageRef.current = false;
        ask();
      }
    };
    let timer = 0;
    if (!checkedOnLoadRef.current && cart.length > 0) {
      checkedOnLoadRef.current = true;
      timer = window.setTimeout(ask, 0);
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [cart]);
  const { products, categories, verificationStatus, verifiedGeneration, recheckProducts } = usePublicCatalog({ initialCatalog, fallback: catalogFallback });
  const storageDegraded = useStorageDegraded();

  /** Promotion items name products by slug; the cart uses the storefront's product ids. */
  const productIdBySlug = useMemo(
    () => new Map(products.map((product) => [product.slug, product.id])),
    [products]
  );

  // Rules published by the server (fresh read, same as the quote); never a static copy.
  const publicPromotions = usePublicPromotions(initialPromotions ?? undefined);
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
  const promoLayout = usePromoLayout();
  const showcase = useMemo(() => showcasePromotions(promotions, now, timezone), [promotions, now, timezone]);
  const combos = useMemo(() => comboPromotions(promotions, now, timezone), [promotions, now, timezone]);
  const hasComboCategory = categories.some((category) => category.type === "other");
  const cardContext = now
    ? { now, timezone, fulfilment, deliveryCents: fulfilment === "delivery" ? deliveryFeeCents ?? 0n : 0n }
    : null;
  const [editingLine, setEditingLine] = useState<CartLine | null>(null);

  // The product in the URL (or being edited). It is only judged against a verified catalog: a
  // server-rendered or fallback copy may be stale, so an unknown slug waits for the fresh read.
  const [activeSlug, setActiveSlug] = useState(initialProductSlug);
  // One message at a time; every new one gets a new key so a repeated add restarts its timer.
  const [notice, setNoticeMessage] = useState<ToastMessage | null>(null);
  const setNotice = (text: string) =>
    setNoticeMessage((previous) => ({ text, key: (previous?.key ?? 0) + 1, durationMs: TOAST_DURATION_MS }));
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

  // A combo opens its detail: what it includes, its description and the extras of each product. Adding it puts
  // its products in the cart; the cart then applies the combo's price by itself.
  const [activeCombo, setActiveCombo] = useState<PromotionRule | null>(null);
  const openCombo = (combo: PromotionRule) => {
    if (!comboContents(combo, products)) {
      setNotice(`No se puede abrir ${combo.name}: falta un producto del combo.`);
      return;
    }
    setActiveCombo(combo);
  };
  // One more combo from the cart: the combo again with its standard choices (extras can be edited per line).
  const addAnotherCombo = (combo: PromotionRule) => {
    const lines: CartLine[] = [];
    for (const item of combo.items) {
      const product = products.find((candidate) => candidate.id === item.productId);
      if (!product || !product.inStock || !validateOptionSelection(product, getDefaultSelection(product)).ok) {
        setNotice(`No se puede sumar otro ${combo.name}: ${product?.name ?? "un producto"} no está disponible.`);
        return;
      }
      lines.push(makeCartLine(product, getDefaultSelection(product), item.quantity, "", combo.id));
    }
    setCart((current) => lines.reduce((acc, line) => addCartLine(acc, line), current));
  };
  // Editing a combo of the cart reopens its detail with what was chosen; saving replaces the combo's lines.
  const [editingComboId, setEditingComboId] = useState<string | null>(null);
  const editingCombo = editingComboId ? promotions.find((promotion) => promotion.id === editingComboId) ?? null : null;
  const saveComboEdit = (combo: PromotionRule, lines: CartLine[]) => {
    setCart((current) => lines.reduce((acc, line) => addCartLine(acc, line), current.filter((line) => line.comboId !== combo.id)));
    setNotice(`${combo.name} se actualizó en el carrito.`);
    setEditingComboId(null);
  };
  const addComboLines = (combo: PromotionRule, lines: CartLine[]) => {
    setCart((current) => lines.reduce((acc, line) => addCartLine(acc, line), current));
    setRevalidationNotice("");
    setNotice(`${combo.name} se agregó al carrito.`);
    setAddedThisVisit(true);
    setActiveCombo(null);
  };

  const comboSection = <ComboSection combos={combos} onAdd={openCombo} products={products} />;

  const keyboardOpen = useVirtualKeyboardOpen();
  const view = useStoreView();

  // Search lives in the header (owner's call on issue #54): a magnifier that opens a field there.
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const searchWasOpen = useRef(false);
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
    else if (searchWasOpen.current) searchButtonRef.current?.focus();
    searchWasOpen.current = searchOpen;
  }, [searchOpen]);
  const closeSearch = () => {
    setQuery("");
    setSearchOpen(false);
  };
  const itemCount = cart.reduce((total, line) => total + line.quantity, 0);
  const subtotal = cart.reduce((total, line) => total + line.unitPriceCents * BigInt(line.quantity), 0n);
  // The promotion that takes something off the products (delivery aside), as the checkout will apply it:
  // the tray and the cart screen show the total with it.
  const cartPromotion = (() => {
    if (cart.length === 0 || now === null) return null;
    const applied = quoteCart(toPromotionLines(cart, products), promotions, fulfilment, 0n, { now, timezone }).promotion;
    return applied && applied.productDiscountCents > 0n ? { name: applied.name, discountCents: applied.productDiscountCents } : null;
  })();
  const trayDiscount = cartPromotion?.discountCents ?? 0n;

  // A new screen starts at its top with focus on its title, as a page load would.
  const shownView = useRef<StoreView>(view);
  useEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    window.scrollTo({ top: 0 });
    document.getElementById(VIEW_TITLES[view])?.focus({ preventScroll: true });
  }, [view]);

  const toast: ToastMessage | null = revalidationNotice
    ? { text: revalidationNotice, key: -textKey(revalidationNotice), durationMs: LONG_TOAST_DURATION_MS }
    : notice ?? (linkNotice ? { text: linkNotice, key: -1, durationMs: null } : null);
  const dismissToast = () => {
    if (revalidationNotice) setRevalidationNotice("");
    else setNoticeMessage(null);
  };

  const navItems: BottomNavItem[] = [
    { href: "#menu", label: "Menú", icon: Hamburger },
    { href: "#carrito", label: "Carrito", icon: ShoppingCart, badge: itemCount, ariaLabel: `Carrito, ${itemCount} productos` },
    { href: "#checkout", label: "Checkout", icon: ReceiptText },
    ...(showAdminNav ? [{ href: "/bunker/admin", label: "Admin", icon: SlidersHorizontal }] : [])
  ];

  return (
    <AppShell
      className="storefront"
      header={
        view === "menu" ? (
          <SiteHeader>
            {searchOpen ? (
              <div className="header-search" role="search">
                <Search aria-hidden="true" size={18} />
                <label className="sr-only" htmlFor="menu-search">Buscar en la carta</label>
                <input
                  autoComplete="off"
                  enterKeyHint="search"
                  id="menu-search"
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") closeSearch();
                  }}
                  placeholder="Buscar hamburguesas, papas, bebidas…"
                  ref={searchInputRef}
                  type="search"
                  value={query}
                />
                <button aria-label="Cerrar búsqueda" className="header-icon" onClick={closeSearch} type="button">
                  <X aria-hidden="true" size={20} />
                </button>
              </div>
            ) : (
              <>
                <a className="brand" href="#menu" aria-label="Búnker Burguer, ir al menú">
                  {/* eslint-disable-next-line @next/next/no-img-element -- 80px brand mark, already sized */}
                  <img alt="" className="brand-mark" height={40} src="/assets/bunker-logo.webp" width={40} />
                  <span>BÚNKER BURGUER</span>
                </a>
                <button aria-label="Buscar en la carta" className="header-icon" onClick={() => setSearchOpen(true)} ref={searchButtonRef} type="button">
                  <Search aria-hidden="true" size={20} />
                </button>
              </>
            )}
          </SiteHeader>
        ) : null
      }
      bottomNav={<BottomNav activeHref={`#${view}`} items={navItems} />}
    >
      <StoreToast message={toast} onDismiss={dismissToast} />
      <InstallPrompt engaged={addedThisVisit} />

      <section aria-labelledby="menu-title" className="store-view menu-section" data-active={view === "menu"} id="menu">
        {/* The captures open straight on the menu; the page title stays for screen readers and links. */}
        <h1 className="sr-only" id="menu-title" tabIndex={-1}>LA CARTA DEL BÚNKER</h1>

        {query.trim() === "" ? <PromoShowcase layout={promoLayout} onAdd={openCombo} promotions={showcase} /> : null}
        {/* Without a Combos category the section goes first; with one, it sits where the store ordered it. */}
        {query.trim() === "" && !hasComboCategory ? comboSection : null}
        <Menu
          categories={categories}
          combosSection={query.trim() === "" && hasComboCategory ? comboSection : null}
          onAdd={addDirect}
          onOpen={openProduct}
          products={products}
          onClearQuery={closeSearch}
          promotionFor={(product) => (cardContext ? promotionalPrice(product, promotions, cardContext) : null)}
          query={query}
          unavailable={catalogFallback === "empty" && initialCatalog === null && verifiedGeneration === 0}
        />

        <footer className="store-legal">
          <p>{ALLERGEN_NOTICE}</p>
          <p className="store-copyright">© {new Date().getFullYear()} Búnker Burguer. Todos los derechos reservados.</p>
          <p className="store-credit">
            Creado por{" "}
            <a aria-label="Lautaro Jimenez: consultar por sus servicios por WhatsApp" data-credit href={CREDIT_WHATSAPP_URL} rel="noopener noreferrer" target="_blank">
              Lautaro Jimenez
            </a>
          </p>
          {/* Quitar `hidden` de este contenedor cuando se quieran mostrar los enlaces. */}
          <div hidden>
            <nav aria-label="Textos legales">
              {LEGAL_PAGES.map((page) => (
                <a href={page.href} key={page.href}>{page.label}</a>
              ))}
            </nav>
          </div>
        </footer>
      </section>

      <CartSection
        active={view === "carrito"}
        cart={cart}
        onChange={setCart}
        onEditLine={handleEditLine}
        onAddCombo={addAnotherCombo}
        onEditCombo={(combo) => setEditingComboId(combo.id)}
        products={products}
        promotion={cartPromotion}
        promotions={promotions}
        subtotal={subtotal}
        storageDegraded={storageDegraded}
      />
      <CheckoutSection
        active={view === "checkout"}
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
        onOrderSent={() => markOrderSent(cart, Date.now())}
      />

      {askOrderSent ? (
        <OrderSentPrompt
          onKeep={() => {
            forgetOrderSent();
            setAskOrderSent(false);
          }}
          onSent={() => {
            forgetOrderSent();
            setAskOrderSent(false);
            setCart([]);
            clearCart();
            setNotice("Listo, vaciamos el carrito. El local te confirma el pedido por WhatsApp.");
            window.location.hash = "menu";
          }}
        />
      ) : null}

      {itemCount > 0 && !keyboardOpen && view === "menu" ? (
        <a className="cart-tray" href="#carrito">
          <span className="cart-tray-icon" aria-hidden="true"><ShoppingCart size={18} /></span>
          <span className="cart-tray-copy">
            <small>{itemCount === 1 ? "1 producto" : `${itemCount} productos`}</small>
            <span className="cart-tray-total">
              <strong>{formatArs(subtotal - trayDiscount)}</strong>
              {trayDiscount > 0n ? <s><span className="sr-only">Antes</span> {formatArs(subtotal)}</s> : null}
            </span>
          </span>
          <span className="cart-tray-action">Ver pedido <ArrowRight aria-hidden="true" size={16} /></span>
        </a>
      ) : null}

      {activeProduct ? (
        <ProductDrawer
          // A different product (Back/Forward between two) is a new dialog with its own defaults.
          key={`${activeProduct.id}:${editingLine?.id ?? "new"}`}
          cart={cart}
          initialLine={editingLine}
          promotion={cardContext ? promotionalPrice(activeProduct, promotions, cardContext) : null}
          onClose={closeProduct}
          onSubmit={(drawerLine, drawerOthers = []) => {
            // A line that came from a combo stays in it when edited.
            const inCombo = (line: CartLine): CartLine => (editingLine?.comboId ? { ...line, comboId: editingLine.comboId } : line);
            const submittedLine = inCombo(drawerLine);
            const otherLines = drawerOthers.map(inCombo);
            if (editingLine && otherLines.length > 0) {
              // Extras for only some of the units: the line comes back split by what each unit carries.
              setCart((current) =>
                [submittedLine, ...otherLines].reduce((lines, line) => addCartLine(lines, line), current.filter((line) => line.id !== editingLine.id))
              );
              setNotice(`${submittedLine.productName} se actualizó en el carrito.`);
              setEditingLine(null);
            } else if (editingLine) {
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
              setCart((current) => [submittedLine, ...otherLines].reduce((lines, line) => addCartLine(lines, line), current));
              setNotice(`${submittedLine.productName} se agregó al carrito.`);
              setAddedThisVisit(true);
            }
            closeProduct();
          }}
          product={activeProduct}
        />
      ) : null}

      {activeCombo ? (
        <ComboDrawer
          key={activeCombo.id}
          combo={activeCombo}
          onAdd={(lines) => addComboLines(activeCombo, lines)}
          onClose={() => setActiveCombo(null)}
          products={products}
        />
      ) : null}

      {editingCombo ? (
        <ComboDrawer
          key={`edit-${editingCombo.id}`}
          combo={editingCombo}
          copies={Math.max(1, comboCount(cart, editingCombo))}
          initial={comboDrawerState(editingCombo, cart, products)}
          onAdd={(lines) => saveComboEdit(editingCombo, lines)}
          onClose={() => setEditingComboId(null)}
          products={products}
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

/** Detail of a combo (issue #54): what it includes, its description and the extras of each product, then the price. */
/** What the combo's detail starts from when a combo already in the cart is edited. */
export interface ComboDrawerState {
  selections: SelectedOptions[];
  extraUnits: ExtraLevels[];
  notes: string;
}

/**
 * The choices of a combo in the cart as the detail shows them: per included product, the options
 * the units carry and how many carry each extra (rebuilt from the cart's lines).
 */
export function comboDrawerState(combo: PromotionRule, lines: readonly CartLine[], products: readonly Product[]): ComboDrawerState {
  const own = lines.filter((line) => line.comboId === combo.id);
  const entries = combo.items.flatMap((item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    return product ? [product] : [];
  });
  const perProduct = entries.map((product) => {
    const mine = own.filter((line) => line.productId === product.id);
    const selected: SelectedOptions = {};
    const units: ExtraLevels = {};
    for (const group of getApplicableOptionGroups(product)) {
      if (group.selectionMode === "multiple") {
        const ids = new Set(mine.flatMap((line) => line.selectedOptions[group.id] ?? []));
        selected[group.id] = [...ids];
        const total = mine.reduce((sum, line) => sum + line.quantity, 0);
        for (const id of ids) {
          const timesIn = (line: CartLine) => (line.selectedOptions[group.id] ?? []).filter((optionId) => optionId === id).length;
          const most = Math.max(...mine.map(timesIn));
          // Level k: the units with more than k of this extra. On every unit: Infinity, so it follows the number of combos.
          const levels = Array.from({ length: most }, (_, k) => {
            const carrying = mine.filter((line) => timesIn(line) > k).reduce((sum, line) => sum + line.quantity, 0);
            return carrying < total ? carrying : Infinity;
          });
          if (levels.length > 1 || levels[0] !== Infinity) units[id] = levels;
        }
      } else {
        const biggest = [...mine].sort((a, b) => b.quantity - a.quantity)[0];
        selected[group.id] = biggest?.selectedOptions[group.id] ?? getDefaultSelection(product)[group.id] ?? [];
      }
    }
    return { selected, units };
  });
  return {
    selections: perProduct.map((entry) => entry.selected),
    extraUnits: perProduct.map((entry) => entry.units),
    notes: own.find((line) => line.notes)?.notes ?? ""
  };
}

export function ComboDrawer({ combo, products, onClose, onAdd, copies = 1, initial }: {
  combo: PromotionRule;
  products: readonly Product[];
  onClose: () => void;
  onAdd: (lines: CartLine[]) => void;
  /** How many combos are being edited: every included product's quantity is multiplied by it. */
  copies?: number;
  /** Set when a combo already in the cart is being edited. */
  initial?: ComboDrawerState;
}) {
  // How many combos: the quantity of every included product is the combo's times this.
  const [count, setCount] = useState(Math.max(1, copies));
  const items = combo.items.flatMap((item) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    return product ? [{ product, quantity: item.quantity * count }] : [];
  });
  const editing = initial !== undefined;
  const [selections, setSelections] = useState<SelectedOptions[]>(() => initial?.selections ?? items.map((item) => getDefaultSelection(item.product)));
  const [extraUnits, setExtraUnits] = useState<ExtraLevels[]>(() => initial?.extraUnits ?? items.map(() => ({})));
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- opened once; the handler only closes
  }, []);

  const perItem = items.map((item, index) => ({ ...item, groups: unitGroupsOf(item.product, selections[index] ?? {}, item.quantity, extraUnits[index] ?? {}) }));
  const unavailable = perItem.find((item) => !item.product.inStock);
  const valid = perItem.every((item) => item.groups.every((group) => validateOptionSelection(item.product, group.selected).ok));
  const extrasCents = perItem.reduce(
    (total, item) =>
      total + item.groups.reduce((sum, group) => sum + (calculateConfiguredUnitPrice(item.product, group.selected) - item.product.priceCents) * BigInt(group.quantity), 0n),
    0n
  );
  const fixedCents = (combo.mechanic.type === "fixed_price" ? combo.mechanic.fixedPriceCents : 0n) * BigInt(count);
  const normalCents = perItem.reduce((total, item) => total + item.product.priceCents * BigInt(item.quantity), 0n);
  const totalCents = fixedCents + extrasCents;

  const submit = () => {
    if (unavailable || !valid) return;
    onAdd(perItem.flatMap((item) => item.groups.map((group) => makeCartLine(item.product, group.selected, group.quantity, notes, combo.id))));
  };

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div aria-labelledby={titleId} aria-modal="true" className="product-drawer" role="dialog">
        <div className="drawer-bar">
          <button className="drawer-back" onClick={onClose} ref={closeRef} type="button">
            <ArrowLeft aria-hidden="true" size={20} /> Seguir pidiendo
          </button>
        </div>
        <div className="drawer-content">
          <div className="drawer-card drawer-hero">
            {/* eslint-disable-next-line @next/next/no-img-element -- public catalog bucket, same as product photos */}
            {combo.imageUrl ? <img alt="" className="drawer-image" src={combo.imageUrl} style={focalStyle(combo)} /> : null}
            <div className="drawer-hero-copy">
              <div className="drawer-title">
                <h2 id={titleId}>{combo.name}{count > 1 ? <small className="combo-copies"> · {count} combos</small> : null}</h2>
                <span className="product-price">
                  <strong>{formatArs(fixedCents)}</strong>
                  {normalCents > fixedCents ? <s className="compare-at"><span className="sr-only">Antes</span> {formatArs(normalCents)}</s> : null}
                </span>
              </div>
              {combo.badgeText ? <span className="promo-badge combo-badge">{combo.badgeText}</span> : null}
              {combo.description ? <p className="combo-description">{combo.description}</p> : null}
              <p className="combo-includes-title">Incluye</p>
              <ul className="combo-includes">
                {perItem.map(({ product, quantity }) => (
                  <li key={product.id}>
                    <strong>{quantity}×</strong> {product.name}
                  </li>
                ))}
              </ul>
              {unavailable ? <p className="drawer-sold-out" role="alert">{unavailable.product.name} no está disponible por ahora.</p> : null}
            </div>
          </div>

          {perItem.map((item, index) =>
            getApplicableOptionGroups(item.product).length > 0 ? (
              <section aria-label={`Opciones de ${item.product.name}`} className="combo-item" key={item.product.id}>
                <h3 className="combo-item-title">{item.quantity}× {item.product.name}</h3>
                <OptionGroups
                  extraUnits={extraUnits[index] ?? {}}
                  namePrefix={`item-${index}:`}
                  product={item.product}
                  quantity={item.quantity}
                  selected={selections[index] ?? {}}
                  setExtraUnits={(update) => setExtraUnits((current) => current.map((value, i) => (i === index ? update(value) : value)))}
                  setSelected={(update) => setSelections((current) => current.map((value, i) => (i === index ? update(value) : value)))}
                />
              </section>
            ) : null
          )}

          <label className="drawer-card notes-field">
            <span>Aclaraciones para la cocina</span>
            <small>Aclaraciones (ej: sin pepinillos, aderezos aparte)</small>
            <textarea aria-label="Aclaraciones para la cocina" maxLength={180} onChange={(event) => setNotes(event.target.value)} placeholder="Escribí acá tus preferencias para el equipo…" value={notes} />
          </label>

          <section aria-label="Resumen del combo" className="drawer-card order-summary">
            <header>
              <NotebookPen aria-hidden="true" />
              <h3>Resumen del combo</h3>
            </header>
            <div className="order-summary-line current">
              <span><strong>{combo.name}</strong><small>Precio del combo</small></span>
              <strong>{formatArs(fixedCents)}</strong>
            </div>
            {perItem.map((item) => {
              const cents = item.groups.reduce((sum, group) => sum + (calculateConfiguredUnitPrice(item.product, group.selected) - item.product.priceCents) * BigInt(group.quantity), 0n);
              if (cents <= 0n) return null;
              const chosenNames = [...new Set(item.groups.flatMap((group) => paidExtraNames(item.product, group.selected)))];
              return (
                <div className="order-summary-line current" key={item.product.id}>
                  <span><strong>{item.product.name}</strong><small>{chosenNames.map((name) => `+ ${name}`).join(", ")}</small></span>
                  <strong>+ {formatArs(cents)}</strong>
                </div>
              );
            })}
            <div className="order-summary-total"><span>Total</span><strong>{formatArs(totalCents)}</strong></div>
          </section>
        </div>
        <div className="drawer-footer combo-footer">
          <div className="quantity-stepper">
            <button aria-label="Quitar un combo" disabled={count <= 1} onClick={() => setCount((value) => Math.max(1, value - 1))} type="button"><Minus /></button>
            <strong aria-label={`${count} combos`}>{count}</strong>
            <button aria-label="Agregar otro combo" onClick={() => setCount((value) => value + 1)} type="button"><Plus /></button>
          </div>
          <button className="primary-action" disabled={Boolean(unavailable) || !valid} onClick={submit} type="button">
            {unavailable ? "Combo no disponible" : <>{editing ? "Guardar cambios" : "Agregar combo"} <span>{formatArs(totalCents)}</span></>}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Per extra, how many units carry at least 1, 2, 3… of it (2 patties on one burger, 1 on the rest).
 * Infinity is "all of them", so it follows the quantity; not set is one on every unit.
 */
export type ExtraLevels = Record<string, number[]>;
const levelsOf = (extraUnits: ExtraLevels, optionId: string, quantity: number) => (extraUnits[optionId] ?? [Infinity]).map((units) => Math.min(units, quantity));

/** A saved selection, where repeating an extra means several of it, as the detail's state: each extra once, plus how many. */
function splitRepeats(options: SelectedOptions): { selected: SelectedOptions; extraUnits: ExtraLevels } {
  const selected: SelectedOptions = {};
  const extraUnits: ExtraLevels = {};
  for (const [groupId, ids] of Object.entries(options)) {
    const unique = [...new Set(ids)];
    selected[groupId] = unique;
    for (const id of unique) {
      const times = ids.filter((optionId) => optionId === id).length;
      if (times > 1) extraUnits[id] = Array.from({ length: times }, () => Infinity);
    }
  }
  return { selected, extraUnits };
}

/** Paid extras of a selection, with "×2" when the same one is repeated. */
function paidExtraNames(product: Product, options: SelectedOptions): string[] {
  return getApplicableOptionGroups(product).flatMap((group) =>
    group.options.flatMap((option) => {
      const times = (options[group.id] ?? []).filter((id) => id === option.id).length;
      return times > 0 && option.priceDeltaCents > 0n ? [times > 1 ? `${option.name} ×${times}` : option.name] : [];
    })
  );
}

/** The units of a line grouped by what each carries: the first units take the extras, as many of each as its levels say. */
export function unitGroupsOf(product: Product, selected: SelectedOptions, quantity: number, extraUnits: ExtraLevels) {
  const applicable = getApplicableOptionGroups(product);
  const groups = new Map<string, { selected: SelectedOptions; quantity: number }>();
  for (let unit = 0; unit < quantity; unit += 1) {
    const options: SelectedOptions = {};
    for (const [groupId, ids] of Object.entries(selected)) {
      const multiple = applicable.find((group) => group.id === groupId)?.selectionMode === "multiple";
      options[groupId] = multiple ? ids.flatMap((id) => Array.from({ length: levelsOf(extraUnits, id, quantity).filter((units) => unit < units).length }, () => id)) : ids;
    }
    const key = JSON.stringify(options);
    const found = groups.get(key);
    if (found) found.quantity += 1;
    else groups.set(key, { selected: options, quantity: 1 });
  }
  return [...groups.values()];
}

/**
 * How many of a chosen extra (2 eggs) and, with several units, on how many of them: one row per
 * level, so 3 burgers can carry one extra patty each and one of them a second one.
 */
function ExtraAmount({ option, quantity, extraUnits, setExtraUnits }: {
  option: { id: string; name: string; priceDeltaCents: bigint };
  quantity: number;
  extraUnits: ExtraLevels;
  setExtraUnits: (update: (current: ExtraLevels) => ExtraLevels) => void;
}) {
  const raw = extraUnits[option.id] ?? [Infinity];
  const levels = levelsOf(extraUnits, option.id, quantity);
  const setLevels = (next: number[]) =>
    setExtraUnits((current) => {
      const copy = { ...current };
      if (next.length === 1 && next[0] === Infinity) delete copy[option.id];
      else copy[option.id] = next;
      return copy;
    });
  const setLevel = (index: number, units: number) => {
    const ceiling = index === 0 ? quantity : levels[index - 1]!;
    const next = [...raw];
    // Reaching the ceiling keeps following it (all units, or all those with one less).
    next[index] = units >= ceiling ? (index === 0 ? Infinity : raw[index - 1]!) : units;
    for (let after = index + 1; after < next.length; after += 1) next[after] = Math.min(next[after]!, next[index]!);
    setLevels(next);
  };
  const total = levels.reduce((sum, units) => sum + units, 0);
  return (
    <>
      <div className="option-units">
        <span className="option-units-label">{quantity > 1 ? "Cantidad por unidad" : "Cantidad"}</span>
        <div aria-label={`Cantidad de ${option.name}`} className="option-units-stepper" role="group">
          <button aria-label={`Una ${option.name} menos`} disabled={levels.length <= 1} onClick={() => setLevels(raw.slice(0, -1))} type="button">
            <Minus aria-hidden="true" />
          </button>
          <strong>{levels.length}</strong>
          <button aria-label={`Una ${option.name} más`} disabled={levels.length >= MAX_SAME_EXTRA} onClick={() => setLevels([...raw, raw.at(-1)!])} type="button">
            <Plus aria-hidden="true" />
          </button>
        </div>
        {option.priceDeltaCents > 0n ? <strong className="option-units-cost">+ {formatArs(option.priceDeltaCents * BigInt(total))}</strong> : null}
      </div>
      {quantity > 1
        ? levels.map((units, index) => {
            const nth = levels.length > 1 ? `${index + 1}× ` : "";
            const ceiling = index === 0 ? quantity : levels[index - 1]!;
            const name = index === 0 ? option.name : `${option.name} ×${index + 1}`;
            return (
              <div className="option-units" key={index}>
                <span className="option-units-label">{units === quantity ? `${nth}En las ${quantity}` : `${nth}En ${units} de ${quantity}`}</span>
                <div aria-label={`Unidades con ${name}`} className="option-units-stepper" role="group">
                  <button aria-label={`Quitar ${name} de una unidad`} disabled={units <= 1} onClick={() => setLevel(index, units - 1)} type="button">
                    <Minus aria-hidden="true" />
                  </button>
                  <strong>{units}</strong>
                  <button aria-label={`Poner ${name} en una unidad más`} disabled={units >= ceiling} onClick={() => setLevel(index, units + 1)} type="button">
                    <Plus aria-hidden="true" />
                  </button>
                </div>
                {index === 0 && units < quantity ? (
                  <button className="option-units-all" onClick={() => setLevel(0, quantity)} type="button">
                    Todas
                  </button>
                ) : null}
              </div>
            );
          })
        : null}
    </>
  );
}

/** The option groups of a product (size, extras…), with how many of the units carry each extra. */
function OptionGroups({ product, selected, setSelected, quantity, extraUnits, setExtraUnits, namePrefix = "" }: {
  product: Product;
  /** Keeps the inputs of two products of a combo apart: radios of the same group id would otherwise be one group. */
  namePrefix?: string;
  selected: SelectedOptions;
  setSelected: (update: (current: SelectedOptions) => SelectedOptions) => void;
  quantity: number;
  extraUnits: ExtraLevels;
  setExtraUnits: (update: (current: ExtraLevels) => ExtraLevels) => void;
}) {
  const applicableGroups = getApplicableOptionGroups(product);
  return (
    <>
          {applicableGroups.map((group) => {
            const groupSelections = selected[group.id] ?? [];
            const isOptionalSingle = group.selectionMode === "single" && !group.required;
            // Few exclusive choices read as tiles side by side (size, medallions); the rest as a list.
            const tiles = group.selectionMode === "single" && group.required && group.options.length <= 3;
            // Extras without a real cap (issue #54): the customer adds as many as they want.
            const unlimited = group.maxSelections >= group.options.length;
            return (
              <fieldset className="drawer-card option-group" key={group.id}>
                <legend>
                  <span className="option-group-title">
                    <span>{group.name}</span>
                    <small>{group.selectionMode === "single" ? "Elegí una opción" : unlimited ? "Sumá los que quieras" : `Podés sumar hasta ${group.maxSelections}`}</small>
                  </span>
                  <span className="option-group-meta">
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
                    <small className="option-badge">{group.required ? "Requerido" : unlimited ? "Opcional" : `Hasta ${group.maxSelections}`}</small>
                  </span>
                </legend>
                <div className={tiles ? "option-tiles" : "option-list"}>
                  {group.options.map((option) => {
                    const checked = groupSelections.includes(option.id);
                    const inputType = group.selectionMode === "single" ? "radio" : "checkbox";
                    const isAvailable = option.available;
                    const row = (
                      <label className={`option-row${checked ? " selected" : ""}${!isAvailable ? " unavailable" : ""}`}>
                        <span>{option.name}{!isAvailable ? <small> (Sin stock)</small> : null}</span>
                        {option.priceDeltaCents > 0n ? <strong>+ {formatArs(option.priceDeltaCents)}</strong> : <small>Incluido</small>}
                        <input
                          checked={checked}
                          disabled={!isAvailable}
                          name={`${namePrefix}${group.id}`}
                          onChange={() => {
                            if (!isAvailable) return;
                            setExtraUnits((current) => {
                              const next = { ...current };
                              delete next[option.id];
                              return next;
                            });
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
                    return (
                      <Fragment key={option.id}>
                        {row}
                        {checked && group.selectionMode === "multiple" ? (
                          <ExtraAmount extraUnits={extraUnits} option={option} quantity={quantity} setExtraUnits={setExtraUnits} />
                        ) : null}
                      </Fragment>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
    </>
  );
}

export function ProductDrawer({ product, initialLine, cart = [], promotion = null, onClose, onSubmit }: {
  product: Product;
  /** The promotional price the menu card shows for this product, if any (issue #54). */
  promotion?: PromotionalPrice | null;
  /** The cart as it is now, for the order summary at the end (the line being edited is replaced). */
  cart?: readonly CartLine[];
  initialLine?: CartLine | null;
  onClose: () => void;
  /** The line to add or edit and, when extras go to only some of the units, the other lines the quantity splits into. */
  onSubmit: (line: CartLine, otherLines?: CartLine[]) => void;
}) {
  const [selected, setSelected] = useState<SelectedOptions>(() => splitRepeats(initialLine?.selectedOptions ?? getDefaultSelection(product)).selected);
  const [quantity, setQuantity] = useState(() => initialLine?.quantity ?? 1);
  // How many of each extra, and with several units on how many of them (one on every unit, when not set).
  const [extraUnits, setExtraUnits] = useState<ExtraLevels>(() => splitRepeats(initialLine?.selectedOptions ?? {}).extraUnits);
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

  const unitGroups = unitGroupsOf(product, selected, quantity, extraUnits);
  const isValid = unitGroups.every((group) => validateOptionSelection(product, group.selected).ok);
  const lineTotal = unitGroups.reduce((total, group) => total + calculateConfiguredUnitPrice(product, group.selected) * BigInt(group.quantity), 0n);
  // Order summary as in the capture: this product as configured plus what is already in the cart.
  const otherLines = cart.filter((line) => line.id !== initialLine?.id);
  const extrasOf = (options: SelectedOptions) => paidExtraNames(product, options);
  const summaryCount = otherLines.reduce((total, line) => total + line.quantity, 0) + quantity;
  const summaryTotal = otherLines.reduce((total, line) => total + line.unitPriceCents * BigInt(line.quantity), 0n) + lineTotal;

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div aria-describedby={summaryId} aria-label={`Personalizar ${product.name}`} aria-modal="true" className="product-drawer" ref={dialogRef} role="dialog">
        <div className="drawer-bar">
          <button className="drawer-back" onClick={onClose} ref={closeRef} type="button">
            <ArrowLeft aria-hidden="true" size={20} /> Seguir pidiendo
          </button>
        </div>
        <div className="drawer-content">
          <div className="drawer-card drawer-hero">
            {/* eslint-disable-next-line @next/next/no-img-element -- mock photography; next/image lands with real assets (BB-02) */}
            {product.imageUrl ? <img alt={product.imageAlt ?? product.name} className="drawer-image" src={product.imageUrl} style={focalStyle(product)} /> : null}
            <div className="drawer-hero-copy">
              <div className="drawer-title">
                <h2>{product.name}</h2>
                <span className="product-price">
                  <strong>{formatArs(promotion?.priceCents ?? product.priceCents)}</strong>
                  {promotion ? <s className="compare-at">{formatArs(promotion.compareAtPriceCents)}</s> : null}
                </span>
              </div>
              <p className="sr-only" id={summaryId}>
                {`Precio ${formatArs(promotion?.priceCents ?? product.priceCents)}${promotion ? `, antes ${formatArs(promotion.compareAtPriceCents)}` : ""}. ${product.inStock ? "Disponible." : "Agotado, no se puede agregar al carrito."}`}
              </p>
              {promotion ? (
                <p className="promo-note">
                  {promotion.promotionName}: {promotion.explanation}. El descuento se aplica al confirmar el pedido.
                </p>
              ) : null}
              {!product.inStock ? <p className="drawer-sold-out" aria-hidden="true">Agotado · no se puede agregar al carrito</p> : null}
              <p>{product.description}</p>
            </div>
          </div>

          <OptionGroups extraUnits={extraUnits} product={product} quantity={quantity} selected={selected} setExtraUnits={setExtraUnits} setSelected={setSelected} />

          <label className="drawer-card notes-field">
            <span>Aclaraciones para la cocina</span>
            <small>Aclaraciones (ej: sin pepinillos, aderezos aparte)</small>
            <textarea aria-label="Aclaraciones para la cocina" maxLength={180} onChange={(event) => setNotes(event.target.value)} placeholder="Escribí acá tus preferencias para el equipo…" value={notes} />
          </label>

          <section aria-labelledby={`${summaryId}-title`} className="drawer-card order-summary">
            <header>
              <NotebookPen aria-hidden="true" />
              <h3 id={`${summaryId}-title`}>Resumen de tu pedido</h3>
              <span className="option-badge">{summaryCount === 1 ? "1 item" : `${summaryCount} items`}</span>
            </header>
            {unitGroups.map((group) => {
              const names = extrasOf(group.selected);
              return (
                <div className="order-summary-line current" key={JSON.stringify(group.selected)}>
                  <span>
                    <strong>{group.quantity > 1 ? `${group.quantity}× ` : ""}{product.name}</strong>
                    <small>{names.length ? names.map((name) => `+ ${name}`).join(", ") : "Personalización estándar"}</small>
                  </span>
                  <strong>{formatArs(calculateConfiguredUnitPrice(product, group.selected) * BigInt(group.quantity))}</strong>
                </div>
              );
            })}
            {otherLines.map((line) => (
              <div className="order-summary-line" key={line.id}>
                <span>
                  <strong>{line.quantity > 1 ? `${line.quantity}× ` : ""}{line.productName}</strong>
                  <small>{line.notes || "En tu carrito"}</small>
                </span>
                <strong>{formatArs(line.unitPriceCents * BigInt(line.quantity))}</strong>
              </div>
            ))}
            <div className="order-summary-total"><span>Subtotal</span><strong>{formatArs(summaryTotal)}</strong></div>
          </section>
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
              const [first, ...rest] = unitGroups;
              if (!first) return;
              const line = makeCartLine(product, first.selected, first.quantity, notes);
              if (rest.length === 0) onSubmit(line);
              else onSubmit(line, rest.map((group) => makeCartLine(product, group.selected, group.quantity, notes)));
            }}
            type="button"
          >
            {!product.inStock ? (
              "Producto agotado"
            ) : initialLine ? (
              <>Guardar cambios <span>{formatArs(lineTotal)}</span></>
            ) : (
              <>Agregar {quantity} al carrito <span>{formatArs(lineTotal)}</span></>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Top bar of the cart and checkout screens: back arrow, store kicker and the screen title. */
function ViewBar({ back, backLabel, title, titleId }: { back: string; backLabel: string; title: string; titleId: string }) {
  return (
    <div className="view-bar">
      <a aria-label={backLabel} className="view-back" href={back}>
        <ArrowLeft aria-hidden="true" size={20} />
      </a>
      <div>
        <span>BÚNKER BURGUER</span>
        <h2 id={titleId} tabIndex={-1}>{title}</h2>
      </div>
    </div>
  );
}

/** "+ Extra bacon, + Cheddar": the paid choices of a cart line, read from the catalog. */
function chosenExtras(line: CartLine, products: readonly Product[]) {
  const product = products.find((candidate) => candidate.id === line.productId);
  if (!product) return [];
  return paidExtraNames(product, line.selectedOptions).map((name) => `+ ${name}`);
}

function CartSection({
  active,
  cart,
  products,
  subtotal,
  promotion,
  promotions,
  onAddCombo,
  onEditCombo,
  onChange,
  onEditLine,
  storageDegraded
}: {
  active: boolean;
  cart: CartLine[];
  products: readonly Product[];
  subtotal: bigint;
  /** The promotion taking something off the products right now, if any. */
  promotion: { name: string; discountCents: bigint } | null;
  /** The store's promotions, to know which combos the cart's lines belong to. */
  promotions: readonly PromotionRule[];
  /** One more of a combo already in the cart. */
  onAddCombo: (combo: PromotionRule) => void;
  /** Open the detail of a combo already in the cart to change its choices. */
  onEditCombo: (combo: PromotionRule) => void;
  onChange: (cart: CartLine[]) => void;
  onEditLine: (line: CartLine) => void;
  storageDegraded?: boolean;
}) {
  const count = cart.reduce((total, line) => total + line.quantity, 0);
  // Lines added from a combo that is still offered are shown together, as the combo; the rest one by one.
  const combosById = new Map(promotions.map((combo) => [combo.id, combo]));
  const entries = cart.reduce<Array<{ kind: "line"; line: CartLine } | { kind: "combo"; combo: PromotionRule; lines: CartLine[] }>>((list, line) => {
    const combo = line.comboId ? combosById.get(line.comboId) : undefined;
    if (!combo) return [...list, { kind: "line", line }];
    const existing = list.find((entry) => entry.kind === "combo" && entry.combo.id === combo.id);
    if (existing && existing.kind === "combo") {
      existing.lines.push(line);
      return list;
    }
    return [...list, { kind: "combo", combo, lines: [line] }];
  }, []);
  const renderLine = (line: CartLine, inCombo: boolean) => {
    const extras = chosenExtras(line, products);
    const detail = [extras.join(", "), line.notes].filter(Boolean).join(" · ") || "Personalización estándar";
    if (inCombo) {
      return (
        <li className="cart-combo-item" key={line.id}>
          <span>
            <strong>{line.quantity}× {line.productName}</strong>
            <small>{detail}</small>
          </span>
        </li>
      );
    }
    return (
      <div className="cart-line" key={line.id}>
        <div className="cart-line-copy">
          <strong>{line.productName}</strong>
          <small>{detail}</small>
        </div>
        <strong className="cart-line-price">{formatArs(line.unitPriceCents * BigInt(line.quantity))}</strong>
        <div className="cart-line-actions">
          <div className="quantity-stepper compact">
            <button aria-label={`Quitar uno de ${line.productName}`} onClick={() => onChange(changeLineQuantity(cart, line.id, -1))} type="button"><Minus /></button>
            <strong>{line.quantity}</strong>
            <button aria-label={`Agregar uno de ${line.productName}`} onClick={() => onChange(changeLineQuantity(cart, line.id, 1))} type="button"><Plus /></button>
          </div>
          <button aria-label={`Editar ${line.productName}`} className="cart-action-btn" onClick={() => onEditLine(line)} type="button">
            Editar
          </button>
          <button aria-label={`Quitar ${line.productName} del carrito`} className="cart-action-btn text-danger" onClick={() => onChange(removeCartLine(cart, line.id))} type="button">
            Eliminar
          </button>
        </div>
      </div>
    );
  };
  return (
    <section aria-labelledby="cart-title" className="store-view order-section" data-active={active} id="carrito">
      <ViewBar back="#menu" backLabel="Seguir pidiendo" title="Tu pedido" titleId="cart-title" />
      {storageDegraded ? (
        <div className="storage-degraded-banner" data-testid="storage-degraded-banner" role="status">
          El almacenamiento local no está disponible en este navegador. Tu carrito se mantendrá durante esta sesión activa.
        </div>
      ) : null}
      {cart.length === 0 ? (
        <div className="empty-state"><ShoppingCart /><h3>Tu carrito está vacío</h3><p>Elegí algo rico de la carta para empezar.</p><a href="#menu">Ver menú</a></div>
      ) : (
        <div className="drawer-card order-summary cart-panel">
          <header>
            <NotebookPen aria-hidden="true" />
            <h3>Resumen de tu pedido</h3>
            <span className="option-badge">{count === 1 ? "1 item" : `${count} items`}</span>
          </header>
          {entries.map((entry) => {
            if (entry.kind === "line") return renderLine(entry.line, false);
            const { combo, lines } = entry;
            const count = comboCount(cart, combo);
            const fixedCents = combo.mechanic.type === "fixed_price" ? combo.mechanic.fixedPriceCents : 0n;
            const extrasCents = lines.reduce((total, line) => {
              const base = products.find((product) => product.id === line.productId)?.priceCents ?? line.unitPriceCents;
              return total + (line.unitPriceCents > base ? (line.unitPriceCents - base) * BigInt(line.quantity) : 0n);
            }, 0n);
            return (
              <div className="cart-combo" key={`combo-${combo.id}`}>
                <div className="cart-line">
                  <div className="cart-line-copy">
                    <strong>{combo.name}</strong>
                    <small>{count === 1 ? "1 combo" : count > 1 ? `${count} combos` : "Combo incompleto"}</small>
                  </div>
                  <strong className="cart-line-price">{formatArs(fixedCents * BigInt(count) + extrasCents)}</strong>
                  <div className="cart-line-actions">
                    <div className="quantity-stepper compact">
                      <button aria-label={`Quitar un ${combo.name}`} onClick={() => onChange(removeOneCombo(cart, combo))} type="button"><Minus /></button>
                      <strong>{count}</strong>
                      <button aria-label={`Agregar otro ${combo.name}`} onClick={() => onAddCombo(combo)} type="button"><Plus /></button>
                    </div>
                    <button aria-label={`Editar ${combo.name}`} className="cart-action-btn" onClick={() => onEditCombo(combo)} type="button">
                      Editar
                    </button>
                    <button aria-label={`Quitar ${combo.name} del carrito`} className="cart-action-btn text-danger" onClick={() => onChange(cart.filter((line) => line.comboId !== combo.id))} type="button">
                      Eliminar
                    </button>
                  </div>
                </div>
                <ul className="cart-combo-items">{lines.map((line) => renderLine(line, true))}</ul>
              </div>
            );
          })}
          {promotion ? (
            <>
              <div className="order-summary-line"><span><strong>Productos</strong></span><strong>{formatArs(subtotal)}</strong></div>
              <div className="order-summary-line promo-applied"><span><strong>{promotion.name}</strong><small>Promo aplicada</small></span><strong>− {formatArs(promotion.discountCents)}</strong></div>
              <div className="order-summary-total"><span>Subtotal con promo</span><strong>{formatArs(subtotal - promotion.discountCents)}</strong></div>
            </>
          ) : (
            <div className="order-summary-total"><span>Subtotal</span><strong>{formatArs(subtotal)}</strong></div>
          )}
          <a className="primary-action wide" href="#checkout">Continuar al checkout <ArrowRight aria-hidden="true" /></a>
          <div className="cart-actions-row">
            <button aria-label="Vaciar carrito completo" className="clear-cart-btn" onClick={() => onChange(clearCart())} type="button">
              Vaciar carrito
            </button>
          </div>
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
      basePriceCents: basePriceCents > line.unitPriceCents ? line.unitPriceCents : basePriceCents,
      ...(line.comboId ? { comboId: line.comboId } : {})
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
  active,
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
  onCheckoutRedirect,
  onOrderSent
}: {
  active: boolean;
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
  /** The customer opened WhatsApp with the order. */
  onOrderSent: () => void;
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
          notes: line.notes,
          ...(line.comboId ? { comboId: line.comboId } : {})
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
              notes: line.notes,
              ...(line.comboId ? { comboId: line.comboId } : {})
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
      ? "El local no está tomando pedidos"
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
        ? "El local no está tomando pedidos"
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
    <section aria-labelledby="checkout-title" className="store-view order-section checkout" data-active={active} id="checkout">
      <ViewBar back="#carrito" backLabel="Volver al carrito" title="Finalizar pedido" titleId="checkout-title" />
      <div className="checkout-layout">
        <div className="checkout-form">
          <fieldset className="choice-group">
            <legend><span className="checkout-heading"><Truck aria-hidden="true" /> Tipo de entrega</span><small>Seleccioná una</small></legend>
            <div className="choice-grid">
              <label className={fulfilment === "delivery" ? "choice-card active" : "choice-card"}>
                <input checked={fulfilment === "delivery"} name="fulfilment" onChange={() => setFulfilment("delivery")} type="radio" />
                <span className="choice-title">Delivery a domicilio</span>
                <span className="choice-check" aria-hidden="true"><Check size={14} /></span>
                <span className="choice-cost"><small>Costo</small><strong>{deliveryFeeCents === null ? "A confirmar" : formatArs(deliveryFeeCents)}</strong></span>
              </label>
              <label className={fulfilment === "pickup" ? "choice-card active" : "choice-card"}>
                <input checked={fulfilment === "pickup"} name="fulfilment" onChange={() => setFulfilment("pickup")} type="radio" />
                <span className="choice-title">Retiro en local</span>
                <span className="choice-check" aria-hidden="true"><Check size={14} /></span>
                <span className="choice-cost"><small>Costo</small><strong>$0</strong></span>
              </label>
            </div>
            {fulfilment === "pickup" && storeStatus.kind === "ready" && storeStatus.status.pickupAddress ? (
              <p className="pickup-place">
                <MapPin aria-hidden="true" size={18} />
                <span>
                  <small>Retirás en</small>
                  <strong>{storeStatus.status.pickupAddress}</strong>
                </span>
                {storeStatus.status.pickupMapsUrl ? (
                  <a href={storeStatus.status.pickupMapsUrl} rel="noopener noreferrer" target="_blank">
                    Cómo llegar
                  </a>
                ) : null}
              </p>
            ) : null}
          </fieldset>

          <fieldset className="choice-group payment-group">
            <legend><span className="checkout-heading"><Wallet aria-hidden="true" /> Método de pago</span></legend>
            {offered.includes("mercado-pago") ? <PaymentChoice checked={payment === "mercado-pago"} label="Mercado Pago" note={PUBLIC_PAYMENT_NOTE.mercado_pago} onChange={() => setPayment("mercado-pago")} value="mercado-pago" /> : null}
            {offered.includes("transfer") ? <PaymentChoice checked={payment === "transfer"} label="Transferencia bancaria" note={PUBLIC_PAYMENT_NOTE.bank_transfer} onChange={() => setPayment("transfer")} value="transfer" /> : null}
            {offered.includes("cash") ? <PaymentChoice checked={payment === "cash"} label="Efectivo" note={PUBLIC_PAYMENT_NOTE.cash} onChange={() => setPayment("cash")} value="cash" /> : null}
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

        <div className="summary-block">
          <h3 className="checkout-heading"><ScrollText aria-hidden="true" /> Resumen de la orden</h3>
          <div className="summary-card">
            {cart.map((line) => (
              <div className="summary-line item" key={line.id}>
                <span><b className="qty-badge">{line.quantity}x</b> {line.productName}</span>
                <strong>{formatArs(line.unitPriceCents * BigInt(line.quantity))}</strong>
              </div>
            ))}
            {cart.length > 0 ? <div className="summary-rule" /> : null}
            <div className="summary-line muted"><span>Subtotal productos</span><strong>{formatArs(totals.subtotalCents)}</strong></div>
            {fulfilment === "pickup" ? (
              <div className="summary-line muted"><span>Retiro en local</span><strong>Sin costo</strong></div>
            ) : (
              <div className="summary-line muted"><span>Envío</span><strong>{deliveryPending && !confirmed ? "A confirmar" : totals.deliveryCents === 0n ? "$0" : formatArs(totals.deliveryCents)}</strong></div>
            )}
            {promotion ? (
              <div className="summary-promotion" data-testid="applied-promotion">
                <div className="summary-line"><span>Promoción: {promotion.name}</span><strong>-{formatArs(totals.discountCents)}</strong></div>
                <small>{promotion.explanation}. No se acumula con otras promociones.</small>
              </div>
            ) : null}
            <div className="summary-total" data-testid="checkout-total">
              <span>{confirmed ? "Total" : "Total estimado"}<small>{confirmed ? "Calculado por el local" : "El local confirma el total final"}</small></span>
              <strong>{formatArs(totals.totalCents)}</strong>
            </div>
          </div>
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
            <a className="whatsapp-button" href={confirmed.url} onClick={onOrderSent} rel="noopener noreferrer" target="_blank">
              Enviar pedido por WhatsApp
            </a>
          ) : (
            <button className="whatsapp-button" disabled type="button">
              {blockedLabel}
            </button>
          )}
          <small className="checkout-footnote">
            {payment === "mercado-pago"
              ? "Serás redirigido al sitio seguro de Mercado Pago. Al finalizar el pago volverás a esta página para coordinar la entrega por WhatsApp."
              : confirmed
                ? "Se abre WhatsApp con tu pedido para que el local lo confirme. Cuando vuelvas, te preguntamos si lo enviaste para vaciar el carrito."
                : "Podés seguir armando tu pedido: el carrito queda guardado en este dispositivo."}
          </small>
        </div>
      </div>
    </section>
  );
}

const PAYMENT_ICONS: Record<PaymentMethod, typeof Banknote> = { "mercado-pago": Wallet, transfer: Landmark, cash: Banknote };

function PaymentChoice({ checked, label, note, onChange, value }: { checked: boolean; label: string; note: string; onChange: () => void; value: PaymentMethod }) {
  const Icon = PAYMENT_ICONS[value];
  return (
    <label className={checked ? "payment-choice active" : "payment-choice"}>
      <input checked={checked} name="payment" onChange={onChange} type="radio" value={value} />
      <span><strong>{label}</strong><small>{note}</small></span>
      <Icon aria-hidden="true" />
    </label>
  );
}
