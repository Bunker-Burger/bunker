import { describe, expect, it } from "vitest";

import { products } from "@/data/catalog";
import { evaluateStoreStatus, type StoreOperatingSettings } from "@/domain/store-status";
import type { Catalog, PaymentMethodSetting, PromotionRule } from "@/domain/types";
import { ok } from "@/lib/result";
import { catalogError } from "@/server/catalog/errors";
import { prepareWhatsAppCheckout, whatsAppCheckoutResponse, type WhatsAppCheckoutDependencies } from "./whatsapp-checkout";

const NOW = new Date("2026-10-08T20:00:00Z");
const TIMEZONE = "America/Argentina/Tucuman";

const paymentMethods: PaymentMethodSetting[] = [
  { method: "cash", displayName: "Efectivo", instructions: "", enabled: true, sortOrder: 10 },
  { method: "bank_transfer", displayName: "Transferencia", instructions: "", enabled: true, sortOrder: 20 },
  { method: "mercado_pago", displayName: "Mercado Pago", instructions: "", enabled: false, sortOrder: 30 }
];

function catalog(overrides: Partial<Catalog> = {}): Catalog {
  return {
    store: {
      id: "store-1",
      slug: "bunker-burger",
      name: "Búnker Burger",
      whatsappE164: "+5493865207458",
      timezone: TIMEZONE,
      currency: "ARS",
      statusOverride: "open",
      isPublic: true,
      deliveryFeeCents: 120_000n,
      businessHours: [],
      paymentMethods
    },
    categories: [],
    products,
    promotions: [],
    ...overrides
  };
}

function dependencies(
  options: { catalog?: Catalog; status?: Partial<StoreOperatingSettings>; failing?: "catalog" | "status" } = {}
): WhatsAppCheckoutDependencies {
  const settings: StoreOperatingSettings = { timezone: TIMEZONE, statusOverride: "open", deliveryFeeCents: 120_000n, businessHours: [], ...options.status };
  return {
    async loadCatalog() {
      return options.failing === "catalog" ? catalogError("unavailable", "down") : ok(options.catalog ?? catalog());
    },
    async loadStoreStatus() {
      return options.failing === "status" ? catalogError("unavailable", "down") : ok(evaluateStoreStatus(settings, NOW));
    },
    now: () => NOW
  };
}

const request = {
  items: [
    { productId: "smash-doble", quantity: 2, optionSelections: { patty: ["triple"], extras: ["bacon"] }, notes: "sin cebolla" },
    { productId: "gaseosa", quantity: 1, optionSelections: { ice: ["no-ice"] }, notes: "" }
  ],
  fulfilment: "delivery",
  paymentMethod: "cash_exact"
};

function messageOf(url: string) {
  return new URL(url).searchParams.get("text") ?? "";
}

describe("prepareWhatsAppCheckout", () => {
  it("recomputes the total on the server and builds the owner's wa.me link from it", async () => {
    const result = await prepareWhatsAppCheckout(request, dependencies());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 2 × (780.000 + 160.000 + 90.000) + 140.000 = 2.200.000; delivery 120.000 once.
    expect(result.value.pricing).toMatchObject({ subtotalCents: 2_200_000n, deliveryCents: 120_000n, totalCents: 2_320_000n });
    const url = new URL(result.value.url);
    expect(url.hostname).toBe("wa.me");
    expect(url.pathname).toBe("/5493865207458");
    const message = messageOf(result.value.url);
    expect(message).toContain("• 2x Smash Búnker Doble — $20.600");
    expect(message).toContain("   Opciones: Triple (3× 100g), Extra bacon ahumado");
    expect(message).toContain("   Nota: sin cebolla");
    expect(message).toContain("• 1x Gaseosa Lata 354ml — $1.400");
    expect(message).toContain("Modalidad: Delivery");
    expect(message).toContain("Total: $23.200");
    expect(message).toContain("Pago: Efectivo. Tengo el importe exacto: $23.200.");
  });

  it("uses the store's current number and transfer copy", async () => {
    const result = await prepareWhatsAppCheckout(
      { ...request, fulfilment: "pickup", paymentMethod: "transfer" },
      dependencies({ catalog: catalog({ store: { ...catalog().store, whatsappE164: "+5493815550000" } }) })
    );
    expect(result.ok && new URL(result.value.url).pathname).toBe("/5493815550000");
    expect(result.ok && messageOf(result.value.url)).toContain("Pago: Transferencia de $22.000. ¿Me pasás el alias o CBU?");
  });

  it("applies one persisted promotion and states it in the message", async () => {
    const promotion: PromotionRule = {
      id: "promo-1",
      slug: "promo-1",
      name: "Jueves Búnker",
      description: "",
      badgeText: null,
      priority: 1,
      active: true,
      startsAt: new Date("2026-01-01T00:00:00Z"),
      endsAt: new Date("2027-01-01T00:00:00Z"),
      mechanic: { type: "percent_off", percentOff: 10 },
      channels: ["delivery", "pickup"],
      items: [],
      schedule: []
    };
    const result = await prepareWhatsAppCheckout(request, dependencies({ catalog: catalog({ promotions: [promotion] }) }));
    expect(result.ok && result.value.pricing).toMatchObject({ discountCents: 220_000n, totalCents: 2_100_000n });
    expect(result.ok && messageOf(result.value.url)).toContain("Promoción: Jueves Búnker (10% de descuento en todo el pedido): -$2.200\nTotal: $21.000");
  });

  it.each([
    ["paused", { statusOverride: "paused" as const }],
    ["closed", { statusOverride: "closed" as const }],
    ["closed by schedule", { statusOverride: "auto" as const }],
    ["without a delivery fee", { deliveryFeeCents: null }]
  ])("gives no link while the store is %s", async (_case, status) => {
    expect(await prepareWhatsAppCheckout(request, dependencies({ status }))).toMatchObject({ ok: false, error: { code: "store_closed" } });
  });

  it.each([
    ["an unknown product", { productId: "ghost" }],
    ["a sold-out product", { productId: "pulled-pork", optionSelections: { bread: ["brioche"] } }],
    ["an unknown option", { optionSelections: { patty: ["quintuple"] } }],
    ["a missing required option", { optionSelections: { patty: [] } }]
  ])("refuses a cart with %s", async (_case, item) => {
    const result = await prepareWhatsAppCheckout({ ...request, items: [{ ...request.items[0], ...item }] }, dependencies());
    expect(result).toMatchObject({ ok: false, error: { code: "invalid_cart" } });
  });

  it.each([
    ["a price", { items: [{ ...request.items[0], unitPriceCents: "1" }] }],
    ["a total", { totalCents: "1" }],
    ["a promotion", { promotionId: "promo-1" }],
    ["customer data", { customer: { name: "Ana", phone: "+54 9 381 555 0000" } }],
    ["Mercado Pago", { paymentMethod: "mercado_pago", customer: { name: "Ana", phone: "+54 9 381 555 0000" } }],
    ["an empty cart", { items: [] }],
    ["a non-object body", null]
  ])("rejects a request carrying %s", async (_case, extra) => {
    const body = extra === null ? null : { ...request, ...extra };
    expect(await prepareWhatsAppCheckout(body, dependencies())).toMatchObject({ ok: false, error: { code: "invalid_request" } });
  });

  it("refuses a payment method the store has disabled", async () => {
    const disabledTransfer = paymentMethods.map((method) => (method.method === "bank_transfer" ? { ...method, enabled: false } : method));
    const result = await prepareWhatsAppCheckout(
      { ...request, paymentMethod: "transfer" },
      dependencies({ catalog: catalog({ store: { ...catalog().store, paymentMethods: disabledTransfer } }) })
    );
    expect(result).toMatchObject({ ok: false, error: { code: "payment_method_unavailable" } });
  });

  it.each(["catalog", "status"] as const)("fails closed when the %s cannot be read", async (failing) => {
    expect(await prepareWhatsAppCheckout(request, dependencies({ failing }))).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });
});

describe("whatsAppCheckoutResponse", () => {
  it("returns amounts as cent strings and is never cached", async () => {
    const response = whatsAppCheckoutResponse(await prepareWhatsAppCheckout(request, dependencies()));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      subtotalCents: "2200000",
      discountCents: "0",
      deliveryCents: "120000",
      totalCents: "2320000",
      promotion: null,
      url: expect.stringMatching(/^https:\/\/wa\.me\/5493865207458\?text=/)
    });
  });

  it.each([
    ["store_closed", 409, { status: { statusOverride: "closed" as const } }],
    ["unavailable", 503, { failing: "catalog" as const }]
  ])("answers %s with %i and no link", async (code, status, options) => {
    const response = whatsAppCheckoutResponse(await prepareWhatsAppCheckout(request, dependencies(options)));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
  });
});
