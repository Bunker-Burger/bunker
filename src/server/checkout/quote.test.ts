import { describe, expect, it } from "vitest";

import { evaluateStoreStatus, StoreNotAcceptingOrdersError, type StoreOperatingSettings } from "@/domain/store-status";
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

function createTestContext(product: AuthoritativeProduct = burgerFixture, status: Partial<StoreOperatingSettings> = {}) {
  const repository: PricingRepository = {
    async findProduct(id) {
      if (id === product.id) return product;
      return null;
    },
    async getApplicableDiscountCents() {
      return 100000n;
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
            notes: "Sin sal"
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
            notes: ""
          }
        ],
        fulfilment: "pickup",
        paymentMethod: "transfer"
      },
      { repository, quotes, storeStatus, createId: () => "q", now: () => new Date() }
    );

    expect(quote.totalCents).toBe(780000n - 100000n);
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
