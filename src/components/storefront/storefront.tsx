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
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { addCartLine, parsePersistedCart, serializeCart } from "@/domain/cart";
import { calculateConfiguredUnitPrice, getDefaultSelection } from "@/domain/catalog";
import { quoteCart } from "@/domain/pricing";
import type { CartLine, FulfilmentMethod, Product, SelectedOptions } from "@/domain/types";
import { formatArs } from "@/lib/money";
import { categoryLabels, products, type StoreCategory } from "@/data/catalog";
import {
  changeLineQuantity,
  createWhatsAppUrl,
  toggleOption,
  type PaymentMethod
} from "./storefront-state";

const CART_KEY = "bunker-cart";
const INVALID_PRODUCT_NOTICE = "Ese producto ya no está disponible.";
const categories = Object.keys(categoryLabels) as StoreCategory[];

// The cart lives in localStorage; useSyncExternalStore keeps SSR output empty and
// re-renders on same-tab writes and cross-tab `storage` events.
const cartListeners = new Set<() => void>();
const EMPTY_CART: CartLine[] = [];
let cartSnapshot: { raw: string | null; lines: CartLine[] } = { raw: null, lines: EMPTY_CART };

function readCart(): CartLine[] {
  const raw = localStorage.getItem(CART_KEY);
  if (raw !== cartSnapshot.raw) cartSnapshot = { raw, lines: parsePersistedCart(raw) };
  return cartSnapshot.lines;
}

function readServerCart(): CartLine[] {
  return EMPTY_CART;
}

function subscribeCart(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === CART_KEY || event.key === null) listener();
  };
  cartListeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    cartListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function setCart(next: CartLine[] | ((current: CartLine[]) => CartLine[])) {
  const lines = typeof next === "function" ? next(readCart()) : next;
  localStorage.setItem(CART_KEY, serializeCart(lines));
  cartListeners.forEach((listener) => listener());
}

function isKnownSlug(slug: string) {
  return products.some((product) => product.slug === slug);
}

function removeProductParam() {
  const url = new URL(window.location.href);
  url.searchParams.delete("producto");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

interface StorefrontProps {
  initialProductSlug: string | null;
  mercadoPagoEnabled: boolean;
  showAdminNav?: boolean;
  onInvalidProduct?: () => void;
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
  showAdminNav = false,
  onInvalidProduct
}: StorefrontProps) {
  const [category, setCategory] = useState<StoreCategory>("burgers");
  const cart = useSyncExternalStore(subscribeCart, readCart, readServerCart);
  const [initialSlugInvalid] = useState(() => initialProductSlug !== null && !isKnownSlug(initialProductSlug));
  const [activeSlug, setActiveSlug] = useState(initialSlugInvalid ? null : initialProductSlug);
  const [notice, setNotice] = useState(initialSlugInvalid ? INVALID_PRODUCT_NOTICE : "");
  const onInvalidProductRef = useRef(onInvalidProduct);
  const invalidSlugHandled = useRef(false);

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
  }, [rejectInvalidSlug]);

  const activeProduct = activeSlug ? products.find((product) => product.slug === activeSlug) : undefined;

  const openProduct = (product: Product) => {
    const url = new URL(window.location.href);
    url.searchParams.set("producto", product.slug);
    window.history.pushState({}, "", `${url.pathname}${url.search}${url.hash}`);
    setActiveSlug(product.slug);
  };

  const closeProduct = useCallback(() => {
    removeProductParam();
    setActiveSlug(null);
  }, []);

  const addDirect = (product: Product) => {
    if (!product.inStock) return;
    const defaults = getDefaultSelection(product);
    setCart((current) => addCartLine(current, makeCartLine(product, defaults, 1, "")));
    setNotice(`${product.name} se agregó al carrito.`);
  };

  const itemCount = cart.reduce((total, line) => total + line.quantity, 0);
  const subtotal = cart.reduce((total, line) => total + line.unitPriceCents * BigInt(line.quantity), 0n);
  const visibleProducts = products.filter((product) => product.categoryId === category && product.published);

  return (
    <div className="storefront-shell">
      <header className="site-header">
        <a className="brand" href="#menu" aria-label="Búnker Burger, ir al menú">
          <span className="brand-mark" aria-hidden="true">BB</span>
          <span>BÚNKER BURGER</span>
        </a>
        <a className="header-cart" href="#carrito" aria-label={`Carrito, ${itemCount} productos`}>
          <ShoppingBag size={20} aria-hidden="true" />
          {itemCount > 0 ? <span>{itemCount}</span> : null}
        </a>
      </header>

      {notice ? <div className="toast" role="status">{notice}</div> : null}

      <main>
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
                featured={category === "burgers" && index === 0}
                key={product.id}
                onAdd={() => addDirect(product)}
                onOpen={() => openProduct(product)}
                product={product}
              />
            ))}
          </div>
        </section>

        <CartSection cart={cart} onChange={setCart} subtotal={subtotal} />
        <CheckoutSection
          cart={cart}
          mercadoPagoEnabled={mercadoPagoEnabled}
        />
      </main>

      {itemCount > 0 ? (
        <a className="cart-tray" href="#carrito">
          <span><strong>{itemCount}</strong> {itemCount === 1 ? "producto" : "productos"}</span>
          <strong>{formatArs(subtotal)} <ChevronRight size={18} aria-hidden="true" /></strong>
        </a>
      ) : null}

      <nav className="bottom-nav" aria-label="Navegación principal">
        <a className="active" href="#menu"><UtensilsCrossed aria-hidden="true" /><span>Menú</span></a>
        <a href="#carrito"><ShoppingBag aria-hidden="true" /><span>Carrito</span>{itemCount > 0 ? <b>{itemCount}</b> : null}</a>
        <a href="#checkout"><CircleDollarSign aria-hidden="true" /><span>Checkout</span></a>
        {showAdminNav ? <a href="/bunker"><Settings2 aria-hidden="true" /><span>Admin</span></a> : null}
      </nav>

      {activeProduct ? (
        <ProductDrawer product={activeProduct} onClose={closeProduct} onSubmit={(line) => {
          setCart((current) => addCartLine(current, line));
          setNotice(`${line.productName} se agregó al carrito.`);
          closeProduct();
        }} />
      ) : null}
    </div>
  );
}

function ProductCard({ product, featured, onOpen, onAdd }: {
  product: Product;
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
          <img alt={product.imageAlt ?? product.name} className="product-image" src={product.imageUrl} />
          {product.featured ? <span className="featured-dot" aria-label="Destacado"><Check size={16} /></span> : null}
          {!product.inStock ? <span className="sold-out-badge">Agotado</span> : null}
        </div>
        <div className="product-copy">
          <div className="product-title-row">
            <h3>{product.name}</h3>
            <strong>{formatArs(product.priceCents)}</strong>
          </div>
          <p>{product.description}</p>
          <span className="product-meta">{product.type === "burger" ? "SMASH • 200G" : categoryLabels[product.categoryId as StoreCategory]}</span>
        </div>
      </button>
      <button className="add-button" disabled={!product.inStock} onClick={onAdd} type="button" aria-label={`Agregar ${product.name}`}>
        {product.inStock ? <>Agregar <Plus size={16} /></> : "Sin stock"}
      </button>
    </article>
  );
}

function ProductDrawer({ product, onClose, onSubmit }: {
  product: Product;
  onClose: () => void;
  onSubmit: (line: CartLine) => void;
}) {
  const [selected, setSelected] = useState<SelectedOptions>(() => getDefaultSelection(product));
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.classList.add("drawer-open");
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("drawer-open");
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const unitPrice = calculateConfiguredUnitPrice(product, selected);

  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div aria-label={`Personalizar ${product.name}`} aria-modal="true" className="product-drawer" role="dialog">
        <div className="drawer-grabber" />
        <button aria-label="Cerrar personalizador" className="close-button" onClick={onClose} ref={closeRef} type="button"><X /></button>
        {/* eslint-disable-next-line @next/next/no-img-element -- mock photography; next/image lands with real assets (BB-02) */}
        <img alt={product.imageAlt ?? product.name} className="drawer-image" src={product.imageUrl} />
        <div className="drawer-content">
          <div className="drawer-title"><h2>{product.name}</h2><strong>{formatArs(product.priceCents)}</strong></div>
          <p>{product.description}</p>

          {product.optionGroups.map((group) => (
            <fieldset className="option-group" key={group.id}>
              <legend><span>{group.name}</span><small>{group.required ? "Requerido" : `Hasta ${group.maxSelections}`}</small></legend>
              {group.options.filter((option) => option.available).map((option) => {
                const checked = (selected[group.id] ?? []).includes(option.id);
                const inputType = group.maxSelections === 1 ? "radio" : "checkbox";
                return (
                  <label className={checked ? "option-row selected" : "option-row"} key={option.id}>
                    <span>{option.name}</span>
                    {option.priceDeltaCents > 0n ? <strong>+ {formatArs(option.priceDeltaCents)}</strong> : <small>Incluido</small>}
                    <input
                      checked={checked}
                      name={group.id}
                      onChange={() => setSelected((current) => toggleOption(current, group.id, option.id, group.maxSelections))}
                      type={inputType}
                    />
                  </label>
                );
              })}
            </fieldset>
          ))}

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
          <button className="primary-action" onClick={() => onSubmit(makeCartLine(product, selected, quantity, notes))} type="button">
            Agregar {quantity} al carrito <span>{formatArs(unitPrice * BigInt(quantity))}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function CartSection({ cart, subtotal, onChange }: { cart: CartLine[]; subtotal: bigint; onChange: (cart: CartLine[]) => void }) {
  return (
    <section className="order-section" id="carrito" aria-labelledby="cart-title">
      <div className="section-heading"><div><span>TU PEDIDO</span><h2 id="cart-title">Carrito</h2></div><ShoppingBag /></div>
      {cart.length === 0 ? (
        <div className="empty-state"><ShoppingBag /><h3>Tu carrito está vacío</h3><p>Elegí algo rico de la carta para empezar.</p><a href="#menu">Ver menú</a></div>
      ) : (
        <div className="cart-panel">
          {cart.map((line) => (
            <div className="cart-line" key={line.id}>
              <div><strong>{line.productName}</strong><small>{line.notes || "Personalización estándar"}</small><span>{formatArs(line.unitPriceCents * BigInt(line.quantity))}</span></div>
              <div className="quantity-stepper compact">
                <button aria-label={`Quitar uno de ${line.productName}`} onClick={() => onChange(changeLineQuantity(cart, line.id, -1))} type="button"><Minus /></button>
                <strong>{line.quantity}</strong>
                <button aria-label={`Agregar uno de ${line.productName}`} onClick={() => onChange(changeLineQuantity(cart, line.id, 1))} type="button"><Plus /></button>
              </div>
            </div>
          ))}
          <div className="cart-total"><span>Subtotal</span><strong>{formatArs(subtotal)}</strong></div>
          <a className="primary-action wide" href="#checkout">Continuar al checkout <ChevronRight /></a>
        </div>
      )}
    </section>
  );
}

function CheckoutSection({ cart, mercadoPagoEnabled }: { cart: CartLine[]; mercadoPagoEnabled: boolean }) {
  const [fulfilment, setFulfilment] = useState<FulfilmentMethod>("pickup");
  const [selectedPayment, setPayment] = useState<PaymentMethod>(mercadoPagoEnabled ? "mercado-pago" : "transfer");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const quote = useMemo(() => quoteCart(cart, [], fulfilment, 120000n), [cart, fulfilment]);
  const payment = !mercadoPagoEnabled && selectedPayment === "mercado-pago" ? "transfer" : selectedPayment;

  const whatsappUrl = createWhatsAppUrl({
    phone: "5493865207458",
    fulfilment,
    payment,
    totalCents: quote.totalCents,
    lines: cart,
    customerName: name,
    address: fulfilment === "delivery" ? address : ""
  });
  const canSubmit = cart.length > 0 && name.trim().length >= 2 && (fulfilment === "pickup" || address.trim().length >= 5);

  return (
    <section className="order-section checkout" id="checkout" aria-labelledby="checkout-title">
      <div className="section-heading"><div><span>ÚLTIMO PASO</span><h2 id="checkout-title">Finalizar pedido</h2></div><CircleDollarSign /></div>
      <div className="checkout-layout">
        <div className="checkout-form">
          <fieldset className="choice-group">
            <legend>Tipo de entrega</legend>
            <div className="choice-grid">
              <label className={fulfilment === "delivery" ? "choice-card active" : "choice-card"}><input checked={fulfilment === "delivery"} name="fulfilment" onChange={() => setFulfilment("delivery")} type="radio" /><Truck /><span>Delivery</span><strong>{formatArs(120000n)}</strong></label>
              <label className={fulfilment === "pickup" ? "choice-card active" : "choice-card"}><input checked={fulfilment === "pickup"} name="fulfilment" onChange={() => setFulfilment("pickup")} type="radio" /><Store /><span>Retiro en local</span><strong>Gratis</strong></label>
            </div>
          </fieldset>

          <div className="customer-fields">
            <label><span>Tu nombre</span><input autoComplete="name" onChange={(event) => setName(event.target.value)} placeholder="¿A nombre de quién?" value={name} /></label>
            {fulfilment === "delivery" ? <label><span>Dirección</span><input autoComplete="street-address" onChange={(event) => setAddress(event.target.value)} placeholder="Calle, número y referencia" value={address} /></label> : null}
          </div>

          <fieldset className="choice-group payment-group">
            <legend>Método de pago</legend>
            {mercadoPagoEnabled ? <PaymentChoice checked={payment === "mercado-pago"} label="Mercado Pago" note="Pagá online de forma segura" onChange={() => setPayment("mercado-pago")} value="mercado-pago" /> : null}
            <PaymentChoice checked={payment === "transfer"} label="Transferencia" note="CBU / CVU / Alias de Búnker" onChange={() => setPayment("transfer")} value="transfer" />
            <PaymentChoice checked={payment === "cash"} label="Efectivo exacto" note="Prepará el monto justo al recibir o retirar" onChange={() => setPayment("cash")} value="cash" />
          </fieldset>
        </div>

        <div className="summary-card">
          <h3>Resumen de la orden</h3>
          {cart.map((line) => <div className="summary-line" key={line.id}><span>{line.quantity}× {line.productName}</span><strong>{formatArs(line.unitPriceCents * BigInt(line.quantity))}</strong></div>)}
          <div className="summary-rule" />
          <div className="summary-line muted"><span>Subtotal</span><strong>{formatArs(quote.subtotalCents)}</strong></div>
          <div className="summary-line muted"><span>Envío</span><strong>{quote.deliveryCents === 0n ? "$0" : formatArs(quote.deliveryCents)}</strong></div>
          <div className="summary-total"><span>Total</span><strong>{formatArs(quote.totalCents)}</strong></div>
          {canSubmit ? <a className="whatsapp-button" href={whatsappUrl} rel="noreferrer" target="_blank">Confirmar por WhatsApp <ChevronRight /></a> : <button className="whatsapp-button" disabled type="button">Completá tus datos</button>}
          <small>Vas a revisar el mensaje antes de enviarlo.</small>
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
