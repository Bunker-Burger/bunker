"use client";

import {
  MapPin,
  ArrowRight,
  Banknote,
  Check,
  Hamburger,
  Landmark,
  ReceiptText,
  ScrollText,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Truck,
  Wallet,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addCartLine,
  clearCart,
  editCartLine,
  formatRevalidationNotice,
  revalidateCart,
  serializeCart
} from "@/domain/cart";
import { getDefaultSelection, validateOptionSelection } from "@/domain/catalog";
import { comboCount } from "@/domain/combos";
import { quoteCart } from "@/domain/pricing";
import { promotionalPrice } from "@/domain/promotions";
import { toPromotionRule, type PublicPromotion } from "@/domain/public-promotions";
import { PUBLIC_PAYMENT_NOTE } from "@/domain/public-payment-options";
import type {
  CartLine,
  FulfilmentMethod,
  PaymentMethodKind,
  Product,
  PromotionRule,
  PublicCatalogSnapshot,
  SelectedOptions
} from "@/domain/types";
import { formatArs } from "@/lib/money";
import { useOnlineStatus } from "@/lib/use-online-status";
import { useCart, useRevalidationNotice, useStorageDegraded } from "@/lib/cart-store";
import { STORE_TIMEZONE } from "@/data/catalog";
import { ALLERGEN_NOTICE, LEGAL_PAGES, PAYMENT_DATA_RETENTION_NOTICE } from "@/content/legal";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { AppShell, SiteHeader } from "@/components/shell/app-shell";
import { BottomNav, type BottomNavItem } from "@/components/shell/bottom-nav";
import { useVirtualKeyboardOpen } from "@/components/shell/use-virtual-keyboard";
import { type PaymentMethod } from "./storefront-state";
import {
  ComboSection,
  comboContents,
  comboPromotions,
  PromoShowcase,
  showcasePromotions,
  usePromoLayout
} from "./promo-showcase";
import { useNow } from "./use-now";
import { usePublicCatalog, type CatalogVerificationStatus } from "./use-public-catalog";
import { usePublicPromotions } from "./use-public-promotions";
import { acceptsOrdersNow, describeStoreStatus, useStoreStatus, type StoreStatusView } from "./use-store-status";
import { useWhatsAppCheckout, type WhatsAppCheckoutRequest } from "./use-whatsapp-checkout";
import { Menu } from "./menu";
import { OrderReturnModal } from "./order-return-modal";
import { LONG_TOAST_DURATION_MS, StoreToast, TOAST_DURATION_MS, type ToastMessage } from "./store-toast";
import { useStoreView, type StoreView } from "./use-store-view";
import { makeCartLine, toPromotionLines } from "./cart-lines";
import { ViewBar } from "./shared/view-bar";
import { ProductDrawer } from "./drawers/product-drawer";
import { ComboDrawer, comboDrawerState } from "./drawers/combo-drawer";
import { CartSection } from "./cart/cart-section";
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

interface StorefrontProps {
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
      />

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
  onCheckoutRedirect
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
            <a className="whatsapp-button" href={confirmed.url} rel="noopener noreferrer" target="_blank">
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
                ? "Se abre WhatsApp con tu pedido para que el local lo confirme. El carrito queda guardado en este dispositivo."
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
