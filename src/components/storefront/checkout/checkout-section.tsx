"use client";

import {
  MapPin,
  Check,
  ScrollText,
  Truck,
  Wallet
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { serializeCart } from "@/domain/cart";
import { quoteCart } from "@/domain/pricing";
import { PUBLIC_PAYMENT_NOTE } from "@/domain/public-payment-options";
import type {
  CartLine,
  FulfilmentMethod,
  PaymentMethodKind,
  Product,
  PromotionRule,
  SelectedOptions
} from "@/domain/types";
import { formatArs } from "@/lib/money";
import { useOnlineStatus } from "@/lib/use-online-status";
import { PAYMENT_DATA_RETENTION_NOTICE } from "@/content/legal";
import { type PaymentMethod } from "../storefront-state";
import { type CatalogVerificationStatus } from "../use-public-catalog";
import { acceptsOrdersNow, describeStoreStatus, type StoreStatusView } from "../use-store-status";
import { useWhatsAppCheckout, type WhatsAppCheckoutRequest } from "../use-whatsapp-checkout";
import { toPromotionLines } from "../cart-lines";
import { ViewBar } from "../shared/view-bar";
import { PaymentChoice } from "./payment-choice";

/** Why the server refused to give a WhatsApp link for this cart. */
const CHECKOUT_ERRORS: Record<string, string> = {
  store_closed: "El local no está tomando pedidos ahora.",
  invalid_cart: "Algo de tu carrito cambió o ya no está disponible. Revisá el carrito antes de enviarlo.",
  payment_method_unavailable: "Ese método de pago no está disponible ahora. Elegí otro.",
  invalid_request: "No pudimos procesar el pedido. Revisá las cantidades (hasta 20 por producto)."
};

/** Same choices, same JSON: empty groups dropped and groups in a stable order. */
function canonicalSelections(selections: SelectedOptions): SelectedOptions {
  return Object.fromEntries(
    Object.entries(selections)
      .filter(([, optionIds]) => optionIds.length > 0)
      .sort(([a], [b]) => a.localeCompare(b))
  );
}

export function CheckoutSection({
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
