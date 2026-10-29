import type { FulfilmentMethod } from "@/domain/types";
import type { CheckoutPricing } from "./quote";

/** Everything the message states comes from a server-priced checkout; never from the browser. */
export interface WhatsAppOrder {
  /** The store's configured number (`stores.whatsapp_e164`). */
  businessPhone: string;
  fulfilment: FulfilmentMethod;
  pricing: CheckoutPricing;
}

const NOT_A_RECEIPT =
  "Pedido a confirmar por este chat.";

/** ARS without decimals, plain ASCII so the text reads the same in every WhatsApp client. */
export function formatWhatsAppArs(cents: bigint): string {
  return `$${(cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

/**
 * Customer text (notes) and catalog names on a single line: a line break typed in a note must not
 * be able to forge a "Total" or "Pago" line in the owner's chat.
 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function orderLines(pricing: CheckoutPricing): string[] {
  return pricing.lines.flatMap((line) => {
    // The same extra twice reads "Bacon x2", not "Bacon, Bacon".
    const counts = new Map<string, number>();
    for (const option of line.selectedOptions) {
      const name = oneLine(option.optionName);
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const options = [...counts].map(([name, times]) => (times > 1 ? `${name} x${times}` : name));
    const notes = oneLine(line.notes);
    return [
      `• ${line.quantity}x ${oneLine(line.productName)} — ${formatWhatsAppArs(line.unitPriceCents * BigInt(line.quantity))}`,
      ...(options.length > 0 ? [`   Opciones: ${options.join(", ")}`] : []),
      ...(notes ? [`   Nota: ${notes}`] : [])
    ];
  });
}

function totalsLines(order: WhatsAppOrder): string[] {
  const { pricing } = order;
  return [
    `Modalidad: ${order.fulfilment === "delivery" ? "Delivery" : "Retiro en el local"}`,
    `Subtotal: ${formatWhatsAppArs(pricing.subtotalCents)}`,
    ...(order.fulfilment === "delivery" ? [`Envío: ${formatWhatsAppArs(pricing.deliveryCents)}`] : []),
    ...(pricing.promotion
      ? [`Promoción: ${oneLine(pricing.promotion.name)} (${pricing.promotion.explanation}): -${formatWhatsAppArs(pricing.discountCents)}`]
      : []),
    `Total a pagar: ${formatWhatsAppArs(pricing.totalCents)}`
  ];
}

function buildUrl(businessPhone: string, message: string[]): string {
  const phone = businessPhone.replace(/\D/g, "");
  if (!phone) throw new Error("Número de WhatsApp inválido");
  return `https://wa.me/${phone}?text=${encodeURIComponent(message.join("\n"))}`;
}

function orderMessage(order: WhatsAppOrder, payment: string, closing: string): string[] {
  return [
    "Hola Búnker Burger! Quiero hacer este pedido:",
    "",
    ...orderLines(order.pricing),
    "",
    ...totalsLines(order),
    "",
    payment,
    ...(order.fulfilment === "delivery" ? ["Te paso la dirección de entrega por este chat."] : []),
    "",
    closing
  ];
}

/** Cash orders: the customer brings the exact amount; the text never claims a payment. */
export function buildExactCashWhatsAppUrl(order: WhatsAppOrder): string {
  const total = formatWhatsAppArs(order.pricing.totalCents);
  return buildUrl(order.businessPhone, orderMessage(order, `Método de pago: Efectivo. Tengo el importe exacto: ${total}.`, NOT_A_RECEIPT));
}

/**
 * Transfer orders: the app shows no alias or bank details. The customer asks for them here and
 * sends the receipt in this chat, where the owner checks it; the message itself proves nothing.
 */
export function buildTransferWhatsAppUrl(order: WhatsAppOrder): string {
  const total = formatWhatsAppArs(order.pricing.totalCents);
  return buildUrl(
    order.businessPhone,
    orderMessage(order, `Método de pago: Transferencia de ${total}. ¿Me pasás el alias o CBU? Te envío el comprobante por este chat.`, NOT_A_RECEIPT)
  );
}

/** After a payment approved by the webhook (BB-15): states the provider reference. */
export function buildApprovedMercadoPagoWhatsAppUrl(order: WhatsAppOrder & { paymentReference: string }): string {
  if (!order.paymentReference.trim()) throw new Error("Referencia de pago requerida");
  return buildUrl(
    order.businessPhone,
    orderMessage(order, `Método de pago: Mercado Pago acreditado por webhook (ref. ${oneLine(order.paymentReference)})`, "Pedido a confirmar por este chat.")
  );
}
