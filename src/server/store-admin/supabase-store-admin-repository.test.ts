import { describe, expect, it } from "vitest";
import { fakeClient, op, type Call } from "@/server/admin/fake-supabase-client";
import type { PromotionFields } from "./ports";
import { createSupabaseStoreAdminRepository } from "./supabase-store-admin-repository";

const STORE = "0199b2c8-40b0-7000-8000-000000000001";
const PROMO = "0d000000-0000-4000-8000-000000000001";
const repo = (reply: Parameters<typeof fakeClient>[0]) => {
  const fake = fakeClient(reply);
  return { ...fake, repository: createSupabaseStoreAdminRepository(fake.client) };
};
const first = (call: Call | undefined) => call?.ops[0]?.[0];

const fields = (mechanic: PromotionFields["mechanic"]): PromotionFields => ({
  name: "Promo",
  slug: "promo",
  description: "",
  badgeText: null,
  mechanic,
  channels: ["delivery"],
  startsAt: new Date("2026-10-01T03:00:00Z"),
  endsAt: new Date("2026-11-01T03:00:00Z"),
  active: false
});

describe("store settings", () => {
  it("reads the fee exactly from text and scopes every write to the store row", async () => {
    const read = repo(() => ({ data: [{ id: STORE, timezone: "America/Argentina/Tucuman", status_override: "auto", delivery_fee_cents: "9007199254740993", whatsapp_e164: "+5491100000000" }] }));
    expect(await read.repository.getStore(STORE)).toMatchObject({ ok: true, value: { deliveryFeeCents: 9007199254740993n, statusOverride: "auto" } });

    const { repository, calls } = repo(() => ({ data: [{ id: STORE }] }));
    await repository.setStatusOverride(STORE, "paused");
    await repository.setContact(STORE, { deliveryFeeCents: 120000n, whatsappE164: "+5493815551234" });
    await repository.setContact(STORE, { deliveryFeeCents: null, whatsappE164: "+5493815551234" });
    expect(calls.map((call) => op(call, "update")[0]?.[1])).toEqual([
      { status_override: "paused" },
      { delivery_fee_cents: 120000, whatsapp_e164: "+5493815551234" },
      { delivery_fee_cents: null, whatsapp_e164: "+5493815551234" }
    ]);
    for (const call of calls) {
      expect(op(call, "eq")).toEqual([["eq", "id", STORE]]);
      expect(op(call, "select")).toEqual([["select", "id"]]);
    }
  });

  it("reports a write RLS filtered out (zero rows) as not_found and the fee check as rejected", async () => {
    expect(await repo(() => ({ data: [] })).repository.setStatusOverride(STORE, "open")).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await repo(() => ({ error: { code: "23514", message: "stores_delivery_fee_required_to_accept_orders" }, status: 400 })).repository.setStatusOverride(STORE, "open")).toMatchObject({
      ok: false,
      error: { code: "rejected" }
    });
  });

  it("upserts a payment method by store and method", async () => {
    const { repository, calls } = repo(() => ({ data: [{ id: "x" }] }));
    await repository.savePaymentMethod(STORE, { method: "cash", displayName: "Efectivo", instructions: "", enabled: true, sortOrder: 10 });
    expect(op(calls[0], "upsert")[0]).toEqual([
      "upsert",
      { store_id: STORE, method: "cash", display_name: "Efectivo", public_instructions: "", is_enabled: true, sort_order: 10 },
      { onConflict: "store_id,method" }
    ]);
  });

  it("deletes shifts only inside the store", async () => {
    const { repository, calls } = repo(() => ({ data: [{ id: "x" }] }));
    await repository.deleteShift(STORE, "0c000000-0000-4000-8000-000000000001");
    expect(op(calls[0], "eq")).toEqual([["eq", "store_id", STORE], ["eq", "id", "0c000000-0000-4000-8000-000000000001"]]);
  });
});

describe("saving a promotion", () => {
  const promotion = (mechanic: PromotionFields["mechanic"], overrides: object) => ({
    name: "Promo",
    slug: "promo",
    description: "",
    badge_text: null,
    is_active: false,
    starts_at: "2026-10-01T03:00:00.000Z",
    ends_at: "2026-11-01T03:00:00.000Z",
    applies_to_delivery: true,
    applies_to_pickup: false,
    ...overrides
  });

  it.each([
    ["percent_off", { type: "percent_off", percentOff: 15 } as const, { promotion_type: "percent_off", percent_off: 15, fixed_price_cents: null, buy_quantity: null, get_quantity: null }],
    ["fixed_price", { type: "fixed_price", fixedPriceCents: 9007199254740993n } as const, { promotion_type: "fixed_price", fixed_price_cents: "9007199254740993", percent_off: null, buy_quantity: null, get_quantity: null }],
    ["buy_x_get_y", { type: "buy_x_get_y", buyQuantity: 2, getQuantity: 1 } as const, { promotion_type: "buy_x_get_y", buy_quantity: 2, get_quantity: 1, percent_off: null, fixed_price_cents: null }],
    ["free_delivery", { type: "free_delivery" } as const, { promotion_type: "free_delivery", percent_off: null, fixed_price_cents: null, buy_quantity: null, get_quantity: null }]
  ])("sends only the parameters of %s (the mechanic check needs the rest null) in one call", async (_type, mechanic, columns) => {
    const { repository, calls } = repo(() => ({ data: PROMO }));
    const draft = { fields: fields(mechanic), items: [{ productId: "p1", quantity: 2 }], schedule: [{ dayOfWeek: 5, startsAt: "19:00", endsAt: "23:30" }] };
    expect(await repository.savePromotion(STORE, PROMO, draft)).toEqual({ ok: true, value: { id: PROMO } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.table).toBe("rpc:admin_save_promotion");
    expect(first(calls[0])).toBe("rpc");
    expect(calls[0]?.ops[0]?.[1]).toEqual({
      target_store_id: STORE,
      target_promotion_id: PROMO,
      promotion: promotion(mechanic, columns),
      items: [{ product_id: "p1", quantity: 2 }],
      schedule: [{ day_of_week: 5, starts_at: "19:00", ends_at: "23:30" }]
    });
  });

  it("creates with a null id and returns the id the database assigned", async () => {
    const { repository, calls } = repo(() => ({ data: PROMO }));
    expect(await repository.savePromotion(STORE, null, { fields: fields({ type: "free_delivery" }), items: [], schedule: [] })).toEqual({ ok: true, value: { id: PROMO } });
    expect(calls[0]?.ops[0]?.[1]).toMatchObject({ target_store_id: STORE, target_promotion_id: null, items: [], schedule: [] });
  });

  it.each([
    ["23505", "conflict"],
    ["23503", "conflict"],
    ["23514", "rejected"],
    ["BB013", "rejected"],
    ["P0002", "not_found"],
    ["42501", "unauthorized"]
  ])("maps a %s from the transaction to %s", async (code, expected) => {
    const { repository } = repo(() => ({ error: { code, message: "x" }, status: 400 }));
    expect(await repository.savePromotion(STORE, PROMO, { fields: fields({ type: "free_delivery" }), items: [], schedule: [] })).toMatchObject({ ok: false, error: { code: expected } });
  });

  it("does not accept an answer without the id", async () => {
    expect(await repo(() => ({ data: null })).repository.savePromotion(STORE, null, { fields: fields({ type: "free_delivery" }), items: [], schedule: [] })).toMatchObject({
      ok: false,
      error: { code: "invalid_data" }
    });
  });
});

describe("moving a promotion", () => {
  it("swaps in one call and reports whether it moved", async () => {
    const moved = repo(() => ({ data: true }));
    expect(await moved.repository.movePromotion(STORE, PROMO, "up")).toEqual({ ok: true, value: { moved: true } });
    expect(moved.calls).toHaveLength(1);
    expect(moved.calls[0]?.table).toBe("rpc:admin_move_promotion");
    expect(moved.calls[0]?.ops[0]?.[1]).toEqual({ target_store_id: STORE, target_promotion_id: PROMO, direction: "up" });
    const edge = repo(() => ({ data: false }));
    expect(await edge.repository.movePromotion(STORE, PROMO, "down")).toEqual({ ok: true, value: { moved: false } });
    expect(edge.calls[0]?.ops[0]?.[1]).toEqual({ target_store_id: STORE, target_promotion_id: PROMO, direction: "down" });
  });

  it("reports a failed swap and does not accept an answer that is not a boolean", async () => {
    expect(await repo(() => ({ error: { code: "P0002", message: "x" }, status: 400 })).repository.movePromotion(STORE, PROMO, "up")).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(await repo(() => ({ error: { code: "BB013", message: "x" }, status: 400 })).repository.movePromotion(STORE, PROMO, "up")).toMatchObject({ ok: false, error: { code: "rejected" } });
    expect(await repo(() => new Error("network")).repository.movePromotion(STORE, PROMO, "up")).toMatchObject({ ok: false, error: { code: "unavailable" } });
    expect(await repo(() => ({ data: null })).repository.movePromotion(STORE, PROMO, "up")).toMatchObject({ ok: false, error: { code: "invalid_data" } });
  });
});
