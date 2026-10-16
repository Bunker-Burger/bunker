import { describe, expect, it } from "vitest";

import { evaluateStoreStatus, StoreNotAcceptingOrdersError, type StoreOperatingSettings } from "@/domain/store-status";
import type { PromotionRule } from "@/domain/types";
import { parseUntrustedCheckout } from "./schema";
import type { AuthoritativeProduct, PaymentQuotesPort, PricingRepository } from "../payments/ports";
import { createAuthoritativeQuote } from "./quote";

const burgerFixture: AuthoritativeProduct = {
  id: "burger-1",
  name: "Smash Doble",
  type: "burger",
  priceCents: 780000n,
  available: true,
  optionGroups: [
    {
      id: "size",
      name: "Tamaño",
      selectionMode: "single",
      required: true,
      minSelections: 1,
      maxSelections: 1,
      applicableTypes: ["burger"],
      options: [
        { id: "double", name: "Doble", priceDeltaCents: 0n, available: true },
        { id: "triple", name: "Triple", priceDeltaCents: 160000n, available: true },
        { id: "quad", name: "Cuádruple", priceDeltaCents: 320000n, available: false }
      ]
    },
    {
      id: "extras",
      name: "Extras",
      selectionMode: "multiple",
      required: false,
      minSelections: 0,
      maxSelections: 3,
      applicableTypes: ["burger"],
      options: [
        { id: "bacon", name: "Bacon", priceDeltaCents: 90000n, available: true },
        { id: "cheddar", name: "Cheddar", priceDeltaCents: 80000n, available: true },
        { id: "egg", name: "Huevo", priceDeltaCents: 60000n, available: true }
      ]
    }
  ]
};

const drinkWithErrantBurgerGroup: AuthoritativeProduct = {
  id: "drink-1",
  name: "Gaseosa",
  type: "beverage",
  priceCents: 140000n,
  available: true,
  optionGroups: [
    {
      id: "size",
      name: "Tamaño",
      selectionMode: "single",
      required: true,
      minSelections: 1,
      maxSelections: 1,
      applicableTypes: ["burger"], // Exclusive to burger!
      options: [{ id: "double", name: "Doble", priceDeltaCents: 0n, available: true }]
    }
  ]
};

const STATUS_NOW = new Date("2026-10-06T12:00:00Z");

/** Store status as the server computes it; the only source of the delivery fee (BB-08). */
function storeStatusFor(overrides: Partial<StoreOperatingSettings> = {}) {
  const settings: StoreOperatingSettings = {
    timezone: "America/Argentina/Tucuman",
    statusOverride: "open",
    deliveryFeeCents: 120000n,
    businessHours: [],
    ...overrides
  };
  return async () => evaluateStoreStatus(settings, STATUS_NOW);
}

/** Persisted promotion rule, as the repository returns it. */
function promotionRule(overrides: Partial<PromotionRule> & Pick<PromotionRule, "id" | "priority" | "mechanic">): PromotionRule {
  return {
    slug: overrides.id,
    name: overrides.id,
    description: "",
    badgeText: null,
    active: true,
    startsAt: new Date("2026-01-01T00:00:00Z"),
    endsAt: new Date("2027-01-01T00:00:00Z"),
    channels: ["delivery", "pickup"],
    items: [],
    schedule: [],
    ...overrides
  };
}

/** Default rule: each unit of the product at 50.000 below its base price (a one-item combo). */
const unitCombo = (product: AuthoritativeProduct) =>
  promotionRule({
    id: `combo-${product.id}`,
    priority: 1,
    mechanic: { type: "fixed_price", fixedPriceCents: product.priceCents - 50000n },
    items: [{ productId: product.id, quantity: 1 }]
  });

function createTestContext(
  product: AuthoritativeProduct = burgerFixture,
  status: Partial<StoreOperatingSettings> = {},
  promotions: readonly PromotionRule[] = [unitCombo(product)]
) {
  const repository: PricingRepository = {
    async findProduct(id) {
      if (id === product.id) return product;
      return null;
    },
    async listPromotions() {
      return promotions;
    }
  };
  const saved = new Map();
  const quotes: PaymentQuotesPort = {
    async save(quote) {
      saved.set(quote.id, quote);
    },
    async findById(id) {
      return saved.get(id) ?? null;
    }
  };
  return { repository, quotes, saved, storeStatus: storeStatusFor(status) };
}

describe("createAuthoritativeQuote", () => {
  it("caso válido y precio derivado desde datos autoritativos", async () => {
    const { repository, quotes, saved, storeStatus } = createTestContext();

    const quote = await createAuthoritativeQuote(
      {
        items: [
          {
            productId: "burger-1",
            quantity: 2,
            optionSelections: { size: ["triple"], extras: ["bacon", "cheddar"] },
            notes: "Sin sal",
            comboId: "combo-burger-1"
          }
        ],
        fulfilment: "delivery",
        paymentMethod: "cash_exact"
      },
      { repository, quotes, storeStatus, createId: () => "quote-1", now: () => new Date("2026-10-06T12:00:00Z") }
    );

    // Unit price = 780000 (base) + 160000 (triple) + 90000 (bacon) + 80000 (cheddar) = 1110000
    // Subtotal = 1110000 * 2 = 2220000
    expect(quote.lines[0]?.unitPriceCents).toBe(1_110_000n);
    expect(quote.subtotalCents).toBe(2_220_000n);
    expect(quote.discountCents).toBe(100_000n);
    expect(quote.deliveryCents).toBe(120_000n);
    expect(quote.totalCents).toBe(2_240_000n);
    expect(saved.get("quote-1")).toEqual(quote);
    expect(quote.lines[0]?.selectedOptions).toEqual([
      { groupId: "size", optionId: "triple", optionName: "Triple" },
      { groupId: "extras", optionId: "bacon", optionName: "Bacon" },
      { groupId: "extras", optionId: "cheddar", optionName: "Cheddar" }
    ]);
  });

  it("servidor cubre: grupo desconocido", async () => {
    const { repository, quotes, storeStatus } = createTestContext();

    await expect(
      createAuthoritativeQuote(
        {
          items: [
            {
              productId: "burger-1",
              quantity: 1,
              optionSelections: { size: ["double"], ghost_group: ["opt1"] },
              notes: ""
            }
          ],
          fulfilment: "pickup",
          paymentMethod: "transfer"
        },
        { repository, quotes, storeStatus, createId: () => "q", now: () => new Date() }
      )
    ).rejects.toThrow(/grupo de opciones 'ghost_group' no existe/i);
  });

  it("servidor cubre: opción desconocida", async () => {
    const { repository, quotes, storeStatus } = createTestContext();

    await expect(
      createAuthoritativeQuote(
        {
          items: [
            {
              productId: "burger-1",
              quantity: 1,
              optionSelections: { size: ["fake-id"] },
              notes: ""
            }
          ],
          fulfilment: "pickup",
          paymentMethod: "transfer"
        },
        { repository, quotes, storeStatus, createId: () => "q", now: () => new Date() }
      )
    ).rejects.toThrow(/opción 'fake-id' no existe/i);
  });

  it("servidor cubre: opción no disponible", async () => {
    const { repository, quotes, storeStatus } = createTestContext();

    await expect(
      createAuthoritativeQuote(
        {
          items: [
            {
              productId: "burger-1",
              quantity: 1,
              optionSelections: { size: ["quad"] }, // quad has available: false
              notes: ""
            }
          ],
          fulfilment: "pickup",
          paymentMethod: "transfer"
        },
        { repository, quotes, storeStatus, createId: () => "q", now: () => new Date() }
      )
    ).rejects.toThrow(/no está disponible/i);
  });

  it("servidor cubre: duplicados", async () => {
    const { repository, quotes, storeStatus } = createTestContext();

    await expect(
      createAuthoritativeQuote(
        {
          items: [
            {
              productId: "burger-1",
              quantity: 1,
              optionSelections: { size: ["double"], extras: ["bacon", "bacon"] },
              notes: ""
            }
          ],
          fulfilment: "pickup",
          paymentMethod: "transfer"
        },
        { repository, quotes, storeStatus, createId: () => "q", now: () => new Date() }
      )
    ).rejects.toThrow(/contiene opciones duplicadas/i);
  });

  it("servidor cubre: min/max - por debajo del mínimo", async () => {
    const { repository, quotes, storeStatus } = createTestContext();

    await expect(
      createAuthoritativeQuote(
        {
          items: [
            {
              productId: "burger-1",
              quantity: 1,
              optionSelections: { size: [] },
              notes: ""
            }
          ],
          fulfilment: "pickup",
          paymentMethod: "transfer"
        },
        { repository, quotes, storeStatus, createId: () => "q", now: () => new Date() }
      )
    ).rejects.toThrow(/mínimo de 1|requerida/i);
  });

  it("servidor cubre: min/max - supera el máximo", async () => {
    const customBurger: AuthoritativeProduct = {
      ...burgerFixture,
      optionGroups: [
        burgerFixture.optionGroups[0]!,
        {
          ...burgerFixture.optionGroups[1]!,
          options: [
            ...burgerFixture.optionGroups[1]!.options,
            { id: "extra4", name: "Extra 4", priceDeltaCents: 1000n, available: true }
          ]
        }
      ]
    };
    const { repository, quotes, storeStatus } = createTestContext(customBurger);

    await expect(
      createAuthoritativeQuote(
        {
          items: [
            {
              productId: "burger-1",
              quantity: 1,
              optionSelections: { size: ["double"], extras: ["bacon", "cheddar", "egg", "extra4"] },
              notes: ""
            }
          ],
          fulfilment: "pickup",
          paymentMethod: "transfer"
        },
        { repository, quotes, storeStatus, createId: () => "q", now: () => new Date() }
      )
    ).rejects.toThrow(/máximo de 3 opción/i);
  });

  it("servidor cubre: selectionMode: single con más de una opción", async () => {
    const { repository, quotes, storeStatus } = createTestContext();

    await expect(
      createAuthoritativeQuote(
        {
          items: [
            {
              productId: "burger-1",
              quantity: 1,
              optionSelections: { size: ["double", "triple"] },
              notes: ""
            }
          ],
          fulfilment: "pickup",
          paymentMethod: "transfer"
        },
        { repository, quotes, storeStatus, createId: () => "q", now: () => new Date() }
      )
    ).rejects.toThrow(/selección única|máximo de 1/i);
  });

  it("servidor cubre: inaplicabilidad por producto/tipo", async () => {
    const { repository, quotes, storeStatus } = createTestContext(drinkWithErrantBurgerGroup);

    await expect(
      createAuthoritativeQuote(
        {
          items: [
            {
              productId: "drink-1",
              quantity: 1,
              optionSelections: { size: ["double"] },
              notes: ""
            }
          ],
          fulfilment: "pickup",
          paymentMethod: "transfer"
        },
        { repository, quotes, storeStatus, createId: () => "q", now: () => new Date() }
      )
    ).rejects.toThrow(/no es aplicable a productos de tipo 'beverage'/i);
  });

  it("servidor rechaza selección vacía cuando required: true aunque minSelections: 0 por override (effectiveMin = 1)", async () => {
    const productWithRequiredOverride: AuthoritativeProduct = {
      id: "burger-req-override",
      name: "Smash Override",
      type: "burger",
      priceCents: 780000n,
      available: true,
      optionGroups: [
        {
          id: "cooking",
          name: "Cocción",
          selectionMode: "single",
          required: true,
          minSelections: 0, // Override permitido por la DB
          maxSelections: 1,
          applicableTypes: ["burger"],
          options: [{ id: "medium", name: "A punto", priceDeltaCents: 0n, available: true }]
        }
      ]
    };
    const { repository, quotes, storeStatus } = createTestContext(productWithRequiredOverride);

    await expect(
      createAuthoritativeQuote(
        {
          items: [
            {
              productId: "burger-req-override",
              quantity: 1,
              optionSelections: { cooking: [] },
              notes: ""
            }
          ],
          fulfilment: "pickup",
          paymentMethod: "transfer"
        },
        { repository, quotes, storeStatus, createId: () => "q", now: () => new Date() }
      )
    ).rejects.toThrow(/Debe seleccionar una opción requerida/i);
  });

  it("servidor acepta selección vacía cuando required: false y minSelections: 0", async () => {
    const productWithOptionalGroup: AuthoritativeProduct = {
      id: "burger-opt",
      name: "Smash Opcional",
      type: "burger",
      priceCents: 780000n,
      available: true,
      optionGroups: [
        {
          id: "sauce",
          name: "Salsa",
          selectionMode: "multiple",
          required: false,
          minSelections: 0,
          maxSelections: 1,
          applicableTypes: ["burger"],
          options: [{ id: "bbq", name: "Barbacoa", priceDeltaCents: 0n, available: true }]
        }
      ]
    };
    const { repository, quotes, storeStatus } = createTestContext(productWithOptionalGroup);

    const quote = await createAuthoritativeQuote(
      {
        items: [
          {
            productId: "burger-opt",
            quantity: 1,
            optionSelections: { sauce: [] },
            notes: "",
            comboId: "combo-burger-opt"
          }
        ],
        fulfilment: "pickup",
        paymentMethod: "transfer"
      },
      { repository, quotes, storeStatus, createId: () => "q", now: () => new Date() }
    );

    // One unit under the default one-item combo: 50.000 off the base price.
    expect(quote.totalCents).toBe(780000n - 50000n);
  });

  it("el combo solo se aplica a lo pedido desde el combo: los mismos productos sueltos pagan el precio normal", async () => {
    const { repository, quotes, storeStatus } = createTestContext();
    const checkout = (comboId?: string) => ({
      items: [{ productId: "burger-1", quantity: 1, optionSelections: { size: ["double"] }, notes: "", ...(comboId ? { comboId } : {}) }],
      fulfilment: "pickup" as const,
      paymentMethod: "transfer" as const
    });
    const dependencies = { repository, quotes, storeStatus, createId: () => "q", now: () => new Date("2026-10-06T12:00:00Z") };

    const loose = await createAuthoritativeQuote(checkout(), dependencies);
    const fromCombo = await createAuthoritativeQuote(checkout("combo-burger-1"), dependencies);
    const fromOther = await createAuthoritativeQuote(checkout("otro-combo"), dependencies);

    expect(loose.discountCents).toBe(0n);
    expect(fromOther.discountCents).toBe(0n);
    expect(fromCombo.discountCents).toBe(50000n);
    expect(fromCombo.lines[0]?.comboId).toBe("combo-burger-1");
  });
});

describe("createAuthoritativeQuote — store status (BB-08)", () => {
  const order = (fulfilment: "delivery" | "pickup") => ({
    items: [
      { productId: "burger-1", quantity: 2, optionSelections: { size: ["triple"] }, notes: "" },
      { productId: "burger-1", quantity: 1, optionSelections: { size: ["double"], extras: ["bacon"] }, notes: "sin cebolla" }
    ],
    fulfilment,
    paymentMethod: "cash_exact" as const
  });

  it("applies the store's fixed delivery fee exactly once, whatever the number of lines and units", async () => {
    const { repository, quotes, storeStatus } = createTestContext();
    const dependencies = { repository, quotes, storeStatus, createId: () => "q", now: () => STATUS_NOW };

    const delivery = await createAuthoritativeQuote(order("delivery"), dependencies);
    const pickup = await createAuthoritativeQuote(order("pickup"), dependencies);

    expect(delivery.deliveryCents).toBe(120_000n);
    expect(pickup.deliveryCents).toBe(0n);
    expect(delivery.totalCents - pickup.totalCents).toBe(120_000n);
  });

  it("takes the fee from the store status, not from any other source", async () => {
    const { repository, quotes, storeStatus } = createTestContext(burgerFixture, { deliveryFeeCents: 150000n });
    const quote = await createAuthoritativeQuote(order("delivery"), { repository, quotes, storeStatus, createId: () => "q", now: () => STATUS_NOW });
    expect(quote.deliveryCents).toBe(150_000n);
  });

  it.each([
    ["closed by schedule", { statusOverride: "auto" as const }],
    ["paused", { statusOverride: "paused" as const }],
    ["manually closed", { statusOverride: "closed" as const }],
    ["missing a delivery fee", { deliveryFeeCents: null }]
  ])("refuses to quote, and saves nothing, while the store is %s", async (_case, status) => {
    const { repository, quotes, saved, storeStatus } = createTestContext(burgerFixture, status);
    let productLookups = 0;
    const counting: PricingRepository = {
      ...repository,
      async findProduct(id) {
        productLookups += 1;
        return repository.findProduct(id);
      }
    };

    await expect(
      createAuthoritativeQuote(order("pickup"), { repository: counting, quotes, storeStatus, createId: () => "q", now: () => STATUS_NOW })
    ).rejects.toBeInstanceOf(StoreNotAcceptingOrdersError);
    expect(saved.size).toBe(0);
    expect(productLookups).toBe(0);
  });
});

describe("createAuthoritativeQuote — promotions (BB-09)", () => {
  // Tuesday 2026-10-06 21:00 in Tucumán (UTC-3).
  const TUESDAY_NIGHT = new Date("2026-10-07T00:00:00Z");
  const order = (fulfilment: "delivery" | "pickup", quantity = 2) => ({
    items: [{ productId: "burger-1", quantity, optionSelections: { size: ["triple"] }, notes: "" }],
    fulfilment,
    paymentMethod: "cash_exact" as const
  });
  const tuesdaySmash = promotionRule({
    id: "martes",
    name: "Martes de Smash",
    priority: 10,
    mechanic: { type: "percent_off", percentOff: 15 },
    items: [{ productId: "burger-1", quantity: 1 }],
    schedule: [{ dayOfWeek: 2, startsAt: "18:00:00", endsAt: "23:59:00" }]
  });
  const tenPercent = promotionRule({ id: "diez", priority: 5, mechanic: { type: "percent_off", percentOff: 10 } });
  const freeDelivery = promotionRule({ id: "envio", priority: 20, mechanic: { type: "free_delivery" }, active: false });

  async function quoteAt(now: Date, promotions: readonly PromotionRule[], fulfilment: "delivery" | "pickup" = "pickup") {
    const { repository, quotes, saved, storeStatus } = createTestContext(burgerFixture, {}, promotions);
    const quote = await createAuthoritativeQuote(order(fulfilment), { repository, quotes, storeStatus, createId: () => "q", now: () => now });
    return { quote, saved };
  }

  it("applies one persisted promotion, computed on the server, and stores it in the quote snapshot", async () => {
    const { quote, saved } = await quoteAt(TUESDAY_NIGHT, [tenPercent, tuesdaySmash, freeDelivery]);

    // 2 × (780.000 + 160.000) = 1.880.000; 15% = 282.000. The 10% does not stack; the paused
    // free-delivery rule is ignored.
    expect(quote).toMatchObject({ subtotalCents: 1_880_000n, discountCents: 282_000n, deliveryCents: 0n, totalCents: 1_598_000n });
    expect(quote.promotion).toMatchObject({
      promotionId: "martes",
      name: "Martes de Smash",
      explanation: "15% de descuento en productos seleccionados",
      productDiscountCents: 282_000n,
      deliveryDiscountCents: 0n
    });
    expect(saved.get("q")).toEqual(quote);
  });

  it("evaluates the weekly window in the store time zone at quote time", async () => {
    // Wednesday 2026-10-07 20:00 local: the Tuesday promotion is over; the 10% applies.
    const { quote } = await quoteAt(new Date("2026-10-07T23:00:00Z"), [tenPercent, tuesdaySmash]);
    expect(quote.promotion?.promotionId).toBe("diez");
    expect(quote.discountCents).toBe(188_000n);
  });

  it("follows a pause persisted between two quotes", async () => {
    const promotions = [tuesdaySmash];
    expect((await quoteAt(TUESDAY_NIGHT, promotions)).quote.promotion?.promotionId).toBe("martes");
    const paused = [{ ...tuesdaySmash, active: false }];
    expect((await quoteAt(TUESDAY_NIGHT, paused)).quote).toMatchObject({ promotion: null, discountCents: 0n, totalCents: 1_880_000n });
  });

  it("waives the delivery fee once with free delivery, which then replaces any other promotion", async () => {
    const { quote } = await quoteAt(TUESDAY_NIGHT, [tuesdaySmash, { ...freeDelivery, active: true }], "delivery");
    expect(quote).toMatchObject({ deliveryCents: 120_000n, discountCents: 120_000n, totalCents: 1_880_000n });
    expect(quote.promotion?.promotionId).toBe("envio");
  });

  it.each([
    ["a promotion id", { promotionId: "martes" }],
    ["a discount", { discountCents: "999999" }],
    ["a total", { totalCents: "1" }]
  ])("rejects a checkout that carries %s from the browser", (_case, extra) => {
    expect(() => parseUntrustedCheckout({ ...order("pickup"), ...extra })).toThrow();
  });

  it("rejects line prices sent by the browser", () => {
    const tampered = { ...order("pickup"), items: [{ ...order("pickup").items[0], unitPriceCents: "1" }] };
    expect(() => parseUntrustedCheckout(tampered)).toThrow();
  });
});
