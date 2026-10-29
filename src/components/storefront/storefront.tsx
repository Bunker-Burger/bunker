"use client";

import {
  ArrowRight,
  Hamburger,
  ReceiptText,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  addCartLine,
  clearCart,
  editCartLine,
  formatRevalidationNotice,
  revalidateCart
} from "@/domain/cart";
import { getDefaultSelection, validateOptionSelection } from "@/domain/catalog";
import { comboCount } from "@/domain/combos";
import { quoteCart } from "@/domain/pricing";
import { promotionalPrice } from "@/domain/promotions";
import { toPromotionRule, type PublicPromotion } from "@/domain/public-promotions";
import type {
  CartLine,
  FulfilmentMethod,
  PaymentMethodKind,
  Product,
  PromotionRule,
  PublicCatalogSnapshot
} from "@/domain/types";
import { formatArs } from "@/lib/money";
import { useCart, useRevalidationNotice, useStorageDegraded } from "@/lib/cart-store";
import { STORE_TIMEZONE } from "@/data/catalog";
import { ALLERGEN_NOTICE, LEGAL_PAGES } from "@/content/legal";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { AppShell, SiteHeader } from "@/components/shell/app-shell";
import { BottomNav, type BottomNavItem } from "@/components/shell/bottom-nav";
import { useVirtualKeyboardOpen } from "@/components/shell/use-virtual-keyboard";
import { ComboSection, comboContents, comboPromotions } from "./promo/combo-section";
import { PromoShowcase, showcasePromotions, usePromoLayout } from "./promo/promo-showcase";
import { useNow } from "./use-now";
import { usePublicCatalog } from "./use-public-catalog";
import { usePublicPromotions } from "./use-public-promotions";
import { useStoreStatus } from "./use-store-status";
import { forgetOrderSent, markOrderSent, shouldAskOrderSent } from "./order-sent";
import { OrderSentPrompt } from "./order-sent-prompt";
import { Menu } from "./menu";
import { OrderReturnModal } from "./order-return-modal";
import { LONG_TOAST_DURATION_MS, StoreToast, TOAST_DURATION_MS, type ToastMessage } from "./store-toast";
import { useStoreView, type StoreView } from "./use-store-view";
import { makeCartLine, toPromotionLines } from "./cart-lines";
import { CompareAt } from "./shared/compare-at";
import { ProductDrawer } from "./drawers/product-drawer";
import { ComboDrawer, comboDrawerState } from "./drawers/combo-drawer";
import { CartSection } from "./cart/cart-section";
import { CheckoutSection } from "./checkout/checkout-section";
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
              {trayDiscount > 0n ? <CompareAt cents={subtotal} className="" /> : null}
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
