interface WhatsAppOrder {
  businessPhone: string;
  quoteId: string;
  totalCents: bigint;
  lines: Array<{ name: string; quantity: number }>;
  /** From the authoritative quote (`PaymentQuote.promotion`); never from the browser. */
  promotion?: { name: string; explanation: string; productDiscountCents: bigint; deliveryDiscountCents: bigint } | null;
}

function formatArs(cents: bigint): string {
  return `$${(cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

function buildUrl(order: WhatsAppOrder, paymentLine: string): string {
  const phone = order.businessPhone.replace(/\D/g, "");
  if (!phone) throw new Error("Número de WhatsApp inválido");
  const lines = order.lines.map((line) => `- ${line.quantity}x ${line.name}`).join("\n");
  const message = [
    `Pedido ${order.quoteId}`,
    lines,
    ...(order.promotion
      ? [
          `Promoción: ${order.promotion.name} (${order.promotion.explanation}), ` +
            `-${formatArs(order.promotion.productDiscountCents + order.promotion.deliveryDiscountCents)}`
        ]
      : []),
    `Total cotizado: ${formatArs(order.totalCents)}`,
    `Pago: ${paymentLine}`,
    "Solicitud enviada por WhatsApp; el local debe confirmar el pedido."
  ].join("\n");
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function buildExactCashWhatsAppUrl(order: WhatsAppOrder): string {
  return buildUrl(order, "Efectivo exacto (a pagar)");
}

export function buildTransferWhatsAppUrl(order: WhatsAppOrder): string {
  return buildUrl(order, "Transferencia pendiente de verificación");
}

export function buildApprovedMercadoPagoWhatsAppUrl(
  order: WhatsAppOrder & { paymentReference: string }
): string {
  if (!order.paymentReference.trim()) throw new Error("Referencia de pago requerida");
  return buildUrl(order, `Mercado Pago acreditado por webhook (ref. ${order.paymentReference})`);
}
