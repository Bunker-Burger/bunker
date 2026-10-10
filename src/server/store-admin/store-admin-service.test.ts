import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryAdminAccess, type InMemorySession } from "@/server/catalog/in-memory-admin-access";
import { InMemoryStoreAdminRepository } from "./in-memory-store-admin-repository";
import {
  addShift,
  deletePromotion,
  deleteShift,
  movePromotion,
  savePaymentMethod,
  savePromotion,
  saveStoreContact,
  setPromotionActive,
  setStoreStatus,
  type StoreAdminDependencies
} from "./store-admin-service";

const STORE = "0199b2c8-40b0-7000-8000-000000000001";
const OTHER = "0199b2c8-40b0-7000-8000-000000000999";
const OWNER = "11111111-1111-4111-8111-111111111111";
const SMASH = "0199b2c8-40b0-7000-8000-000000000201";
const PAPAS = "0199b2c8-40b0-7000-8000-000000000206";
const FOREIGN_PRODUCT = "0199b2c8-40b0-7000-8000-000000000299";
const TZ = "America/Argentina/Tucuman";

let repository: InMemoryStoreAdminRepository;
let mercadoPagoConfigured: boolean;
let log: { error: ReturnType<typeof vi.fn<(message: string) => void>> };

function deps(session: InMemorySession = { userId: OWNER }): StoreAdminDependencies {
  return {
    repository,
    access: createInMemoryAdminAccess(session, [{ userId: OWNER, storeId: STORE, storeSlug: "bunker-burger", role: "owner", active: true }]),
    storeSlug: "bunker-burger",
    mercadoPagoConfigured: () => mercadoPagoConfigured,
    log
  };
}

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) for (const item of value) data.append(key, item);
    else data.set(key, value);
  }
  return data;
}

const promotionForm = (overrides: Record<string, string | string[]> = {}) =>
  form({
    name: "Martes de smash",
    type: "percent_off",
    percentOff: "15",
    channel: ["delivery", "pickup"],
    startsAt: "2026-10-01T00:00",
    endsAt: "2026-12-31T23:59",
    active: "on",
    itemProduct: [SMASH],
    itemQuantity: ["1"],
    scheduleDay: ["2"],
    scheduleStart: ["19:00"],
    scheduleEnd: ["23:30"],
    ...overrides
  });

beforeEach(() => {
  log = { error: vi.fn<(message: string) => void>() };
  mercadoPagoConfigured = true;
  repository = new InMemoryStoreAdminRepository();
  repository.stores = [
    { id: STORE, timezone: TZ, statusOverride: "closed", deliveryFeeCents: null, whatsappE164: "+5491100000000" },
    { id: OTHER, timezone: TZ, statusOverride: "closed", deliveryFeeCents: null, whatsappE164: "+5491100000999" }
  ];
  repository.productIds = [
    { id: SMASH, storeId: STORE },
    { id: PAPAS, storeId: STORE },
    { id: FOREIGN_PRODUCT, storeId: OTHER }
  ];
});

describe("authorization", () => {
  it.each([
    ["no session", null],
    ["an expired session", { userId: OWNER, expired: true }],
    ["a user without membership", { userId: "22222222-2222-4222-8222-222222222222" }]
  ])("refuses every write with %s and touches nothing", async (_case, session) => {
    const d = deps(session);
    const outcomes = await Promise.all([
      setStoreStatus(d, form({ statusOverride: "paused" })),
      saveStoreContact(d, form({ deliveryFee: "1200", whatsapp: "+5493815551234" })),
      addShift(d, form({ dayOfWeek: "1", opensAt: "19:00", closesAt: "23:00" })),
      deleteShift(d, form({ shiftId: "0b000000-0000-4000-8000-000000000001" })),
      savePaymentMethod(d, form({ method: "cash", displayName: "Efectivo", enabled: "on" })),
      savePromotion(d, promotionForm()),
      setPromotionActive(d, form({ promotionId: "0b000000-0000-4000-8000-000000000001", active: "false" })),
      movePromotion(d, form({ promotionId: "0b000000-0000-4000-8000-000000000001", direction: "up" })),
      deletePromotion(d, form({ promotionId: "0b000000-0000-4000-8000-000000000001" }))
    ]);
    for (const outcome of outcomes) expect(outcome).toEqual({ ok: false, message: "Tu sesión no tiene permisos de administración. Volvé a iniciar sesión." });
    expect(repository.writes).toEqual([]);
  });
});

describe("store status and contact", () => {
  it.each([["auto"], ["open"]])("refuses %s without a delivery fee", async (statusOverride) => {
    expect(await setStoreStatus(deps(), form({ statusOverride }))).toMatchObject({
      ok: false,
      fieldErrors: { statusOverride: "Configurá la tarifa de delivery antes de habilitar pedidos." }
    });
    expect(repository.writes).toEqual([]);
  });

  it("enables orders once the fee is set, and pauses without one", async () => {
    expect(await setStoreStatus(deps(), form({ statusOverride: "paused" }))).toMatchObject({ ok: true, message: "Pedidos en pausa." });
    expect(await saveStoreContact(deps(), form({ deliveryFee: "1200", whatsapp: "+54 9 381 555-1234" }))).toMatchObject({ ok: true });
    expect(repository.stores[0]).toMatchObject({ deliveryFeeCents: 120000n, whatsappE164: "+5493815551234" });
    expect(await setStoreStatus(deps(), form({ statusOverride: "auto" }))).toMatchObject({ ok: true, message: "El local sigue los horarios." });
    expect(repository.stores[0]?.statusOverride).toBe("auto");
  });

  it("does not remove the fee while the store takes orders", async () => {
    repository.stores[0] = { ...repository.stores[0]!, statusOverride: "open", deliveryFeeCents: 100000n };
    expect(await saveStoreContact(deps(), form({ deliveryFee: "", whatsapp: "+5493815551234" }))).toMatchObject({ ok: false, fieldErrors: { deliveryFee: expect.stringContaining("pausá o cerrá") } });
    expect(repository.stores[0]?.deliveryFeeCents).toBe(100000n);
  });

  it("maps the database's own fee check to the same explanation", async () => {
    repository.stores[0] = { ...repository.stores[0]!, deliveryFeeCents: 100000n };
    repository.failing.set("setStatusOverride", { code: "rejected", message: "23514" });
    expect(await setStoreStatus(deps(), form({ statusOverride: "open" }))).toEqual({ ok: false, message: "Configurá la tarifa de delivery antes de habilitar pedidos." });
  });

  it.each([
    [{ deliveryFee: "12,50", whatsapp: "+5493815551234" }, "deliveryFee"],
    [{ deliveryFee: "1200", whatsapp: "3815551234" }, "whatsapp"],
    [{ deliveryFee: "1200", whatsapp: "+0123" }, "whatsapp"]
  ])("rejects %j", async (fields, field) => {
    expect(await saveStoreContact(deps(), form(fields))).toMatchObject({ ok: false, fieldErrors: { [field]: expect.any(String) } });
  });

  it("rejects an unknown status", async () => {
    expect(await setStoreStatus(deps(), form({ statusOverride: "always" }))).toMatchObject({ ok: false, fieldErrors: { statusOverride: "Elegí un estado." } });
  });
});

describe("business hours", () => {
  beforeEach(() => {
    repository.shifts = [{ id: "0c000000-0000-4000-8000-000000000001", storeId: STORE, dayOfWeek: 5, opensAt: "19:30", closesAt: "01:30" }];
  });

  it("adds a shift that does not overlap", async () => {
    expect(await addShift(deps(), form({ dayOfWeek: "6", opensAt: "01:30", closesAt: "04:00" }))).toMatchObject({ ok: true, message: "Turno del sábado agregado." });
    expect(repository.writes).toEqual(["addShift:6@01:30-04:00"]);
  });

  it("refuses a shift overlapping one that crosses midnight", async () => {
    expect(await addShift(deps(), form({ dayOfWeek: "6", opensAt: "00:30", closesAt: "03:00" }))).toMatchObject({
      ok: false,
      fieldErrors: { opensAt: "Se superpone con el turno del viernes de 19:30 a 01:30." }
    });
    expect(repository.writes).toEqual([]);
  });

  it.each([
    [{ dayOfWeek: "7", opensAt: "19:00", closesAt: "23:00" }, "dayOfWeek"],
    [{ dayOfWeek: "1", opensAt: "25:00", closesAt: "23:00" }, "opensAt"],
    [{ dayOfWeek: "1", opensAt: "19:00", closesAt: "19:00" }, "closesAt"]
  ])("rejects %j", async (fields, field) => {
    expect(await addShift(deps(), form(fields))).toMatchObject({ ok: false, fieldErrors: { [field]: expect.any(String) } });
  });

  it("deletes a shift of the store only", async () => {
    repository.shifts.push({ id: "0c000000-0000-4000-8000-000000000002", storeId: OTHER, dayOfWeek: 1, opensAt: "10:00", closesAt: "12:00" });
    expect(await deleteShift(deps(), form({ shiftId: "0c000000-0000-4000-8000-000000000002" }))).toMatchObject({ ok: false, message: "Ese elemento ya no existe. Recargá la página." });
    expect(await deleteShift(deps(), form({ shiftId: "0c000000-0000-4000-8000-000000000001" }))).toMatchObject({ ok: true });
    expect(repository.shifts.map((shift) => shift.storeId)).toEqual([OTHER]);
  });
});

describe("payment methods", () => {
  it("saves a method with its public instructions", async () => {
    expect(await savePaymentMethod(deps(), form({ method: "bank_transfer", displayName: "Transferencia", instructions: "Alias: bunker.burger", enabled: "on", sortOrder: "20" }))).toMatchObject({
      ok: true,
      message: "Transferencia: habilitado."
    });
    expect(repository.paymentMethods).toEqual([{ storeId: STORE, method: "bank_transfer", displayName: "Transferencia", instructions: "Alias: bunker.burger", enabled: true, sortOrder: 20 }]);
  });

  it("warns that Mercado Pago is not offered until the server is configured, without revealing why", async () => {
    mercadoPagoConfigured = false;
    const outcome = await savePaymentMethod(deps(), form({ method: "mercado_pago", displayName: "Mercado Pago", enabled: "on" }));
    expect(outcome).toEqual({ ok: true, value: undefined, message: "Guardado. Mercado Pago no se ofrece a los clientes hasta completar su configuración en el servidor." });
  });

  it.each([[{ method: "crypto", displayName: "X" }, "method"], [{ method: "cash", displayName: "" }, "displayName"], [{ method: "cash", displayName: "Efectivo", sortOrder: "-1" }, "sortOrder"]])(
    "rejects %j",
    async (fields, field) => {
      expect(await savePaymentMethod(deps(), form(fields))).toMatchObject({ ok: false, fieldErrors: { [field]: expect.any(String) } });
    }
  );
});

describe("promotions", () => {
  it("creates a promotion with the next priority: paused while its products and windows are stored, then active", async () => {
    repository.promotions.push({ id: "0d000000-0000-4000-8000-000000000001", storeId: STORE, priority: 4, name: "Vieja", slug: "vieja", description: "", badgeText: null, mechanic: { type: "free_delivery" }, channels: ["delivery"], startsAt: new Date(0), endsAt: new Date(1), active: false, items: [], schedule: [] });
    const outcome = await savePromotion(deps(), promotionForm());
    expect(outcome).toMatchObject({ ok: true, message: "“Martes de smash” guardada y activa.", value: { promotionId: expect.any(String) } });
    expect(repository.writes).toEqual([
      "createPromotion:active=false:priority=5",
      "replacePromotionItems:1:active=false",
      "replacePromotionSchedule:1:active=false",
      "setPromotionActive:true"
    ]);
    expect(repository.promotions.at(-1)).toMatchObject({
      slug: "martes-de-smash",
      mechanic: { type: "percent_off", percentOff: 15 },
      channels: ["delivery", "pickup"],
      startsAt: new Date("2026-10-01T03:00:00.000Z"),
      endsAt: new Date("2027-01-01T02:59:00.000Z"),
      items: [{ productId: SMASH, quantity: 1 }],
      schedule: [{ dayOfWeek: 2, startsAt: "19:00", endsAt: "23:30" }],
      active: true
    });
  });

  it("keeps it paused when storing its windows fails", async () => {
    repository.failing.set("replacePromotionSchedule", { code: "unavailable", message: "timeout" });
    const outcome = await savePromotion(deps(), promotionForm());
    expect(outcome).toMatchObject({ ok: false, message: expect.stringContaining("La promoción quedó pausada") });
    expect(repository.promotions[0]?.active).toBe(false);
  });

  it.each([
    ["a product of another store", { itemProduct: [FOREIGN_PRODUCT] }, "items"],
    ["a combo without products", { type: "fixed_price", fixedPrice: "9000", itemProduct: [], itemQuantity: [] }, "items"],
    ["free delivery for pickup only", { type: "free_delivery", channel: ["pickup"], itemProduct: [], itemQuantity: [] }, "channel"],
    ["an end before the start", { endsAt: "2026-09-30T00:00" }, "endsAt"],
    ["a percent above 100", { percentOff: "120" }, "percentOff"],
    ["a malformed window", { scheduleStart: ["19:00"], scheduleEnd: ["19:00"] }, "schedule"],
    ["no channel", { channel: [] }, "channel"],
    ["a repeated product", { itemProduct: [SMASH, SMASH], itemQuantity: ["1", "2"] }, "items"]
  ])("rejects %s without writing", async (_case, overrides, field) => {
    expect(await savePromotion(deps(), promotionForm(overrides))).toMatchObject({ ok: false, fieldErrors: { [field]: expect.any(String) } });
    expect(repository.writes).toEqual([]);
  });

  describe("with three promotions", () => {
    const promo = (n: number, priority: number) => ({
      id: `0d000000-0000-4000-8000-00000000000${n}`,
      storeId: STORE,
      priority,
      name: `P${n}`,
      slug: `p${n}`,
      description: "",
      badgeText: null,
      mechanic: { type: "free_delivery" as const },
      channels: ["delivery" as const],
      startsAt: new Date(0),
      endsAt: new Date(1),
      active: true,
      items: [],
      schedule: []
    });
    beforeEach(() => {
      repository.promotions = [promo(1, 30), promo(2, 20), promo(3, 10)];
    });

    it("moves a promotion up by swapping priorities through a free value", async () => {
      expect(await movePromotion(deps(), form({ promotionId: "0d000000-0000-4000-8000-000000000003", direction: "up" }))).toMatchObject({ ok: true });
      expect(repository.writes).toEqual(["setPromotionPriority:P3=31", "setPromotionPriority:P2=10", "setPromotionPriority:P3=20"]);
      expect(repository.promotions.map((p) => [p.name, p.priority])).toEqual([["P1", 30], ["P2", 10], ["P3", 20]]);
    });

    it("does nothing at the top", async () => {
      expect(await movePromotion(deps(), form({ promotionId: "0d000000-0000-4000-8000-000000000001", direction: "up" }))).toMatchObject({ ok: true, message: "La promoción ya está en ese extremo." });
      expect(repository.writes).toEqual([]);
    });

    it("pauses, resumes and deletes", async () => {
      expect(await setPromotionActive(deps(), form({ promotionId: "0d000000-0000-4000-8000-000000000002", active: "false" }))).toMatchObject({ ok: true, message: "Promoción pausada." });
      expect(await setPromotionActive(deps(), form({ promotionId: "0d000000-0000-4000-8000-000000000002", active: "true" }))).toMatchObject({ ok: true, message: "Promoción reanudada." });
      expect(await deletePromotion(deps(), form({ promotionId: "0d000000-0000-4000-8000-000000000002" }))).toMatchObject({ ok: true });
      expect(repository.promotions.map((p) => p.name)).toEqual(["P1", "P3"]);
    });
  });
});
