import { describe, expect, it } from "vitest";

import {
  buildApprovedMercadoPagoWhatsAppUrl,
  buildExactCashWhatsAppUrl,
  buildTransferWhatsAppUrl
} from "./whatsapp";

const order = {
  businessPhone: "+54 9 11 1234 5678",
  quoteId: "quote-1",
  totalCents: 1_500_000n,
  lines: [{ name: "Búnker Doble", quantity: 2 }]
};

describe("WhatsApp checkout helpers", () => {
  it("states the single promotion of the quote, from its generated explanation", () => {
    const text = new URL(
      buildExactCashWhatsAppUrl({
        ...order,
        promotion: { name: "Martes de Smash", explanation: "15% de descuento en productos seleccionados", productDiscountCents: 282_000n, deliveryDiscountCents: 0n }
      })
    ).searchParams.get("text");
    expect(text).toContain("Promoción: Martes de Smash (15% de descuento en productos seleccionados), -$2.820");
    expect(new URL(buildExactCashWhatsAppUrl(order)).searchParams.get("text")).not.toContain("Promoción");
  });

  it("labels exact cash without claiming payment", () => {
    const url = new URL(buildExactCashWhatsAppUrl(order));
    expect(url.hostname).toBe("wa.me");
    expect(url.pathname).toBe("/5491112345678");
    expect(url.searchParams.get("text")).toContain("Efectivo exacto (a pagar)");
  });

  it("labels transfer as pending verification", () => {
    expect(new URL(buildTransferWhatsAppUrl(order)).searchParams.get("text"))
      .toContain("Transferencia pendiente de verificación");
  });

  it("includes an approved provider reference for Mercado Pago", () => {
    expect(new URL(buildApprovedMercadoPagoWhatsAppUrl({ ...order, paymentReference: "mp-789" })).searchParams.get("text"))
      .toContain("Mercado Pago acreditado por webhook (ref. mp-789)");
  });
});
