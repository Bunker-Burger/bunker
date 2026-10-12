import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryAdminAccess, type InMemorySession } from "@/server/catalog/in-memory-admin-access";
import { fakeClient, op } from "@/server/admin/fake-supabase-client";
import { InMemoryStoreAdminRepository, type MemoryPromotion } from "./in-memory-store-admin-repository";
import { createSupabaseStoreAdminRepository } from "./supabase-store-admin-repository";
import {
  addShift,
  deletePromotion,
  deleteShift,
  movePromotion,
  reorderPromotions,
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
    expect(await setStoreStatus(deps(), form({ statusOverride: "open" }))).toEqual({ ok: false, message: "Configurá la tarifa de delivery antes de habilitar pedidos.", mayHaveWritten: true });
  });

  it("saves where pickup orders are collected, and clears it when emptied (issue #54)", async () => {
    const maps = "https://maps.app.goo.gl/bunker";
    expect(
      await saveStoreContact(deps(), form({ deliveryFee: "1200", whatsapp: "+5493815551234", pickupAddress: "  San Lorenzo 877,   Aguilares ", pickupMapsUrl: maps }))
    ).toMatchObject({ ok: true });
    expect(repository.stores[0]).toMatchObject({ pickupAddress: "San Lorenzo 877, Aguilares", pickupMapsUrl: maps });
    expect(await saveStoreContact(deps(), form({ deliveryFee: "1200", whatsapp: "+5493815551234", pickupAddress: "", pickupMapsUrl: "" }))).toMatchObject({ ok: true });
    expect(repository.stores[0]).toMatchObject({ pickupAddress: null, pickupMapsUrl: null });
  });

  it.each([
    [{ deliveryFee: "12,50", whatsapp: "+5493815551234" }, "deliveryFee"],
    [{ deliveryFee: "1200", whatsapp: "3815551234" }, "whatsapp"],
    [{ deliveryFee: "1200", whatsapp: "+0123" }, "whatsapp"],
    [{ deliveryFee: "1200", whatsapp: "+5493815551234", pickupMapsUrl: "http://maps.google.com/x" }, "pickupMapsUrl"],
    [{ deliveryFee: "1200", whatsapp: "+5493815551234", pickupMapsUrl: "javascript:alert(1)" }, "pickupMapsUrl"],
    [{ deliveryFee: "1200", whatsapp: "+5493815551234", pickupAddress: "x".repeat(201) }, "pickupAddress"]
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
  // What a crafted request could try to publish through the publicly readable row.
  const BANK_TEXT = [
    ["an alias without separators", "Alias bunkerburger"],
    ["an alias in a sentence", "Mi alias bancoburger"],
    ["a labelled alias", "Alias: bunker.burger"],
    ["a CBU", "CBU 2850590940090418135201"],
    ["a CVU", "CVU: 0000003100010000000001"],
    ["an account number", "Cuenta 4001234-5 123-4"]
  ];

  it.each(BANK_TEXT)("never stores %s sent as the name or the instructions of a transfer", async (_case, text) => {
    const outcome = await savePaymentMethod(deps(), form({ method: "bank_transfer", displayName: text, instructions: text, enabled: "on", sortOrder: "20" }));
    expect(outcome).toEqual({ ok: true, value: undefined, message: "Transferencia: habilitado." });
    expect(repository.paymentMethods).toEqual([{ storeId: STORE, method: "bank_transfer", enabled: true, sortOrder: 20 }]);
    expect(JSON.stringify(repository.paymentMethods)).not.toContain(text);
  });

  it.each([
    ["cash", "Efectivo"],
    ["bank_transfer", "Transferencia"],
    ["mercado_pago", "Mercado Pago"]
  ])("writes %s with its fixed name and no instructions, whatever the request says", async (method, name) => {
    const fake = fakeClient(() => ({ data: [{ id: "x" }] }));
    const outcome = await savePaymentMethod(
      { ...deps(), repository: createSupabaseStoreAdminRepository(fake.client) },
      form({ method, displayName: "Alias bunkerburger", instructions: "Mi alias bancoburger", enabled: "on", sortOrder: "10" })
    );
    expect(outcome).toMatchObject({ ok: true });
    expect(op(fake.calls[0], "upsert")[0]?.[1]).toEqual({ store_id: STORE, method, display_name: name, public_instructions: "", is_enabled: true, sort_order: 10 });
  });

  it("warns that Mercado Pago is not offered until the server is configured, without revealing why", async () => {
    mercadoPagoConfigured = false;
    const outcome = await savePaymentMethod(deps(), form({ method: "mercado_pago", enabled: "on" }));
    expect(outcome).toEqual({ ok: true, value: undefined, message: "Guardado. Mercado Pago no se ofrece a los clientes hasta completar su configuración en el servidor." });
  });

  it.each([[{ method: "crypto" }, "method"], [{ method: "cash", sortOrder: "-1" }, "sortOrder"], [{ method: "cash", sortOrder: "1001" }, "sortOrder"]])("rejects %j without writing", async (fields, field) => {
    expect(await savePaymentMethod(deps(), form(fields))).toMatchObject({ ok: false, fieldErrors: { [field]: expect.any(String) } });
    expect(repository.writes).toEqual([]);
  });
});

describe("promotions", () => {
  const stored = (overrides: Partial<MemoryPromotion> = {}): MemoryPromotion => ({
    id: "0d000000-0000-4000-8000-000000000001",
    storeId: STORE,
    priority: 4,
    name: "Vieja",
    slug: "vieja",
    description: "",
    badgeText: null,
    mechanic: { type: "percent_off", percentOff: 10 },
    channels: ["delivery"],
    startsAt: new Date("2026-10-01T03:00:00Z"),
    endsAt: new Date("2026-12-01T03:00:00Z"),
    active: true,
    items: [{ productId: PAPAS, quantity: 1 }],
    schedule: [{ dayOfWeek: 5, startsAt: "20:00", endsAt: "23:00" }],
    ...overrides
  });

  it("creates a promotion with its products and windows in one write, with the next priority", async () => {
    repository.promotions.push(stored({ active: false }));
    const outcome = await savePromotion(deps(), promotionForm());
    expect(outcome).toMatchObject({ ok: true, message: "“Martes de smash” guardada y activa.", value: { promotionId: expect.any(String) } });
    expect(repository.writes).toEqual(["savePromotion:create:active=true:priority=5"]);
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

  it("edits an active promotion without pausing it on the way", async () => {
    repository.promotions.push(stored());
    const outcome = await savePromotion(deps(), promotionForm({ promotionId: "0d000000-0000-4000-8000-000000000001", name: "Vieja renovada", slug: "vieja" }));
    expect(outcome).toMatchObject({ ok: true, value: { promotionId: "0d000000-0000-4000-8000-000000000001" } });
    expect(repository.writes).toEqual(["savePromotion:update:active=true"]);
    expect(repository.promotions[0]).toMatchObject({ name: "Vieja renovada", priority: 4, active: true, items: [{ productId: SMASH, quantity: 1 }] });
  });

  it.each([
    ["the connection fails", { code: "unavailable", message: "timeout" }, "No pudimos guardar los cambios. Intentá nuevamente."],
    ["the slug is taken", { code: "conflict", message: "23505" }, "Ya existe una promoción con ese slug."],
    ["the database rejects it", { code: "rejected", message: "23514" }, "La base de datos rechazó la promoción (o no quedan prioridades libres). No se guardó nada."]
  ] as const)("leaves an edited promotion exactly as it was when %s, and says a write was attempted", async (_case, failure, message) => {
    const before = stored();
    repository.promotions.push(structuredClone(before));
    repository.failing.set("savePromotion", failure);
    const outcome = await savePromotion(deps(), promotionForm({ promotionId: before.id, name: "Nunca guardada" }));
    expect(outcome).toEqual({ ok: false, message, mayHaveWritten: true });
    expect(repository.promotions).toEqual([before]);
  });

  it("reports a promotion that is not in the store", async () => {
    expect(await savePromotion(deps(), promotionForm({ promotionId: "0d000000-0000-4000-8000-000000000009" }))).toEqual({
      ok: false,
      message: "Ese elemento ya no existe. Recargá la página.",
      mayHaveWritten: true
    });
    expect(repository.promotions).toEqual([]);
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
    const outcome = await savePromotion(deps(), promotionForm(overrides));
    expect(outcome).toMatchObject({ ok: false, fieldErrors: { [field]: expect.any(String) } });
    expect(outcome).not.toHaveProperty("mayHaveWritten");
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

    it("moves a promotion up by swapping priorities in one write", async () => {
      expect(await movePromotion(deps(), form({ promotionId: "0d000000-0000-4000-8000-000000000003", direction: "up" }))).toEqual({
        ok: true,
        message: "Orden de promociones actualizado.",
        value: undefined
      });
      expect(repository.writes).toEqual(["movePromotion:P3=20,P2=10"]);
      expect(repository.promotions.map((p) => [p.name, p.priority])).toEqual([["P1", 30], ["P2", 10], ["P3", 20]]);
    });

    it("puts the promotions in the dragged order, one neighbour swap at a time (issue #54)", async () => {
      const id = (n: number) => `0d000000-0000-4000-8000-00000000000${n}`;
      expect(await reorderPromotions(deps(), form({ promotionId: [id(3), id(1), id(2)] }))).toMatchObject({ ok: true, message: "Orden de promociones guardado." });
      const byPriority = [...repository.promotions].sort((a, b) => b.priority - a.priority).map((p) => p.name);
      expect(byPriority).toEqual(["P3", "P1", "P2"]);
      expect(repository.writes).toHaveLength(2);
    });

    it("refuses an order that does not list exactly the store's promotions", async () => {
      const id = (n: number) => `0d000000-0000-4000-8000-00000000000${n}`;
      expect(await reorderPromotions(deps(), form({ promotionId: [id(1), id(2)] }))).toMatchObject({ ok: false, fieldErrors: { promotionId: expect.stringContaining("Recargá") } });
      expect(repository.writes).toEqual([]);
    });

    it.each([
      ["top", "0d000000-0000-4000-8000-000000000001", "up"],
      ["bottom", "0d000000-0000-4000-8000-000000000003", "down"]
    ])("does nothing at the %s", async (_end, promotionId, direction) => {
      expect(await movePromotion(deps(), form({ promotionId, direction }))).toMatchObject({ ok: true, message: "La promoción ya está en ese extremo." });
      expect(repository.writes).toEqual([]);
      expect(repository.promotions.map((p) => p.priority)).toEqual([30, 20, 10]);
    });

    it.each([
      ["the swap fails", { code: "unavailable", message: "timeout" }, "No pudimos guardar los cambios. Intentá nuevamente."],
      ["no priority is free", { code: "rejected", message: "BB013" }, "No hay más prioridades disponibles: eliminá promociones viejas."]
    ] as const)("keeps every priority when %s", async (_case, failure, message) => {
      repository.failing.set("movePromotion", failure);
      expect(await movePromotion(deps(), form({ promotionId: "0d000000-0000-4000-8000-000000000003", direction: "up" }))).toEqual({ ok: false, message, mayHaveWritten: true });
      expect(repository.promotions.map((p) => [p.name, p.priority])).toEqual([["P1", 30], ["P2", 20], ["P3", 10]]);
    });

    it("refuses an unknown direction without writing", async () => {
      const outcome = await movePromotion(deps(), form({ promotionId: "0d000000-0000-4000-8000-000000000003", direction: "sideways" }));
      expect(outcome).toMatchObject({ ok: false, fieldErrors: { direction: expect.any(String) } });
      expect(outcome).not.toHaveProperty("mayHaveWritten");
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
