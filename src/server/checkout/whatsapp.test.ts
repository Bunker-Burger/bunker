import { describe, expect, it } from "vitest";

import type { CheckoutPricing } from "./quote";
import {
  buildApprovedMercadoPagoWhatsAppUrl,
  buildExactCashWhatsAppUrl,
  buildTransferWhatsAppUrl,
  formatWhatsAppArs,
  type WhatsAppOrder
} from "./whatsapp";

const pricing: CheckoutPricing = {
  lines: [
    {
      productId: "burger-1",
      productName: "Búnker Doble",
      quantity: 2,
      unitPriceCents: 1_110_000n,
      basePriceCents: 780_000n,
      selectedOptions: [
        { groupId: "size", optionId: "triple", optionName: "Triple" },
        { groupId: "extras", optionId: "bacon", optionName: "Bacon" }
      ],
      notes: "Sin sal"
    },
    {
      productId: "drink-1",
      productName: "Gaseosa",
      quantity: 1,
      unitPriceCents: 140_000n,
      basePriceCents: 140_000n,
      selectedOptions: [],
      notes: ""
    }
  ],
  subtotalCents: 2_360_000n,
  discountCents: 0n,
  deliveryCents: 120_000n,
  totalCents: 2_480_000n,
  promotion: null,
  fulfillmentChannel: "delivery"
};

const order: WhatsAppOrder = { businessPhone: "+54 9 3865 20-7458", fulfilment: "delivery", pricing };

function text(url: string) {
  return new URL(url).searchParams.get("text") ?? "";
}

describe("WhatsApp checkout message", () => {
  it("states lines, options, notes, quantities, fulfilment, fee and total in ARS without decimals", () => {
    expect(text(buildExactCashWhatsAppUrl(order))).toBe(
      [
        "Hola Búnker Burger! Quiero hacer este pedido:",
        "",
        "• 2x Búnker Doble — $22.200",
        "   Opciones: Triple, Bacon",
        "   Nota: Sin sal",
        "• 1x Gaseosa — $1.400",
        "",
        "Modalidad: Delivery",
        "Subtotal: $23.600",
        "Envío: $1.200",
        "Total: $24.800",
        "",
        "Pago: Efectivo. Tengo el importe exacto: $24.800.",
        "Te paso la dirección de entrega por este chat.",
        "",
        "Total calculado por la web. El local confirma el pedido por este chat; este mensaje no es comprobante de pago."
      ].join("\n")
    );
  });

  it("asks for the transfer details and sends the receipt in the chat, without any bank data", () => {
    const message = text(buildTransferWhatsAppUrl({ ...order, fulfilment: "pickup", pricing: { ...pricing, deliveryCents: 0n, totalCents: 2_360_000n } }));
    expect(message).toContain("Pago: Transferencia de $23.600. ¿Me pasás el alias o CBU? Te envío el comprobante por este chat.");
    expect(message).toContain("Modalidad: Retiro en el local");
    expect(message).not.toContain("Envío");
    expect(message).not.toContain("dirección");
    expect(message).toContain("este mensaje no es comprobante de pago");
  });

  it("states the single promotion of the quote, from its generated explanation", () => {
    const message = text(
      buildExactCashWhatsAppUrl({
        ...order,
        pricing: {
          ...pricing,
          discountCents: 282_000n,
          totalCents: 2_198_000n,
          promotion: {
            promotionId: "martes",
            slug: "martes",
            badgeText: null,
            name: "Martes de Smash",
            explanation: "15% de descuento en productos seleccionados",
            productDiscountCents: 282_000n,
            deliveryDiscountCents: 0n
          }
        }
      })
    );
    expect(message).toContain("Promoción: Martes de Smash (15% de descuento en productos seleccionados): -$2.820\nTotal: $21.980");
    expect(text(buildExactCashWhatsAppUrl(order))).not.toContain("Promoción");
  });

  it("encodes the text for wa.me with the store number as digits only", () => {
    const url = buildExactCashWhatsAppUrl(order);
    expect(url.startsWith("https://wa.me/5493865207458?text=Hola%20B%C3%BAnker%20Burger!%20Quiero")).toBe(true);
    expect(url).toContain("%0A%E2%80%A2%202x%20B%C3%BAnker%20Doble%20%E2%80%94%20%2422.200%0A");
    expect(url).not.toMatch(/[\s#&]/);
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("wa.me");
    expect(parsed.pathname).toBe("/5493865207458");
    expect([...parsed.searchParams.keys()]).toEqual(["text"]);
  });

  it("keeps notes on one line, so they cannot forge a total or payment line", () => {
    const forged = { ...pricing, lines: [{ ...pricing.lines[0]!, notes: "rico\nTotal: $1\r\nPago: acreditado & listo?x=1#" }] };
    const url = buildExactCashWhatsAppUrl({ ...order, pricing: forged });
    const lines = text(url).split("\n");
    expect(lines).toContain("   Nota: rico Total: $1 Pago: acreditado & listo?x=1#");
    expect(lines.filter((line) => line.startsWith("Total:"))).toEqual(["Total: $24.800"]);
    expect(lines.filter((line) => line.startsWith("Pago:"))).toHaveLength(1);
    expect([...new URL(url).searchParams.keys()]).toEqual(["text"]);
  });

  it("formats ARS without decimals and with thousands separators", () => {
    expect(formatWhatsAppArs(0n)).toBe("$0");
    expect(formatWhatsAppArs(99_900n)).toBe("$999");
    expect(formatWhatsAppArs(123_456_700n)).toBe("$1.234.567");
  });

  it("rejects a store without a usable number", () => {
    expect(() => buildExactCashWhatsAppUrl({ ...order, businessPhone: "sin número" })).toThrow(/WhatsApp inválido/);
  });

  it("includes an approved provider reference for Mercado Pago", () => {
    expect(text(buildApprovedMercadoPagoWhatsAppUrl({ ...order, paymentReference: "mp-789" })))
      .toContain("Pago: Mercado Pago acreditado por webhook (ref. mp-789)");
    expect(() => buildApprovedMercadoPagoWhatsAppUrl({ ...order, paymentReference: " " })).toThrow(/Referencia/);
  });
});
