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

describe("promotion columns", () => {
  it.each([
    ["percent_off", { type: "percent_off", percentOff: 15 } as const, { promotion_type: "percent_off", percent_off: 15, fixed_price_cents: null, buy_quantity: null, get_quantity: null }],
    ["fixed_price", { type: "fixed_price", fixedPriceCents: 900000n } as const, { promotion_type: "fixed_price", fixed_price_cents: 900000, percent_off: null, buy_quantity: null, get_quantity: null }],
    ["buy_x_get_y", { type: "buy_x_get_y", buyQuantity: 2, getQuantity: 1 } as const, { promotion_type: "buy_x_get_y", buy_quantity: 2, get_quantity: 1, percent_off: null, fixed_price_cents: null }],
    ["free_delivery", { type: "free_delivery" } as const, { promotion_type: "free_delivery", percent_off: null, fixed_price_cents: null, buy_quantity: null, get_quantity: null }]
  ])("writes only the parameters of %s (the mechanic check needs the rest null)", async (_type, mechanic, columns) => {
    const { repository, calls } = repo(() => ({ data: { id: PROMO } }));
    await repository.createPromotion(STORE, { ...fields(mechanic), priority: 3 });
    expect(op(calls[0], "insert")[0]?.[1]).toEqual({
      store_id: STORE,
      priority: 3,
      name: "Promo",
      slug: "promo",
      description: "",
      badge_text: null,
      is_active: false,
      starts_at: "2026-10-01T03:00:00.000Z",
      ends_at: "2026-11-01T03:00:00.000Z",
      applies_to_delivery: true,
      applies_to_pickup: false,
      ...columns
    });
  });
});

describe("replacing a promotion's products and windows", () => {
  const items = [{ productId: "p1", quantity: 2 }];

  function itemsClient(answers: { before: unknown[]; deleted: unknown[]; inserted?: unknown[]; after?: unknown[] }) {
    let selects = 0;
    return repo((call) => {
      if (first(call) === "delete") return { data: answers.deleted };
      if (first(call) === "insert") return { data: answers.inserted ?? [{ product_id: "p1", quantity: 2 }] };
      selects += 1;
      return { data: selects === 1 ? answers.before : (answers.after ?? [{ product_id: "p1", quantity: 2 }]) };
    });
  }

  it("replaces the products inside the store and reads them back", async () => {
    const old = [{ product_id: "p0", quantity: 1 }];
    const { repository, calls } = itemsClient({ before: old, deleted: old });
    expect(await repository.replacePromotionItems(STORE, PROMO, items)).toEqual({ ok: true, value: undefined });
    expect(calls.map(first)).toEqual(["select", "delete", "insert", "select"]);
    expect(op(calls[1], "eq")).toEqual([["eq", "store_id", STORE], ["eq", "promotion_id", PROMO]]);
    expect(op(calls[2], "insert")[0]?.[1]).toEqual([{ store_id: STORE, promotion_id: PROMO, product_id: "p1", quantity: 2 }]);
  });

  it("fails when the delete leaves old products behind (filtered by RLS)", async () => {
    const { repository, calls } = itemsClient({ before: [{ product_id: "p0", quantity: 1 }], deleted: [] });
    expect(await repository.replacePromotionItems(STORE, PROMO, items)).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(calls.map(first)).toEqual(["select", "delete"]);
  });

  it("fails when fewer products are stored or read back than requested", async () => {
    expect(await itemsClient({ before: [], deleted: [], inserted: [] }).repository.replacePromotionItems(STORE, PROMO, items)).toMatchObject({ ok: false, error: { code: "unauthorized" } });
    expect(await itemsClient({ before: [], deleted: [], after: [{ product_id: "p1", quantity: 3 }] }).repository.replacePromotionItems(STORE, PROMO, items)).toMatchObject({ ok: false, error: { code: "unavailable" } });
  });

  it("checks the promotion belongs to the store before touching its windows (they have no store_id)", async () => {
    const { repository, calls } = repo(() => ({ data: [] }));
    expect(await repository.replacePromotionSchedule(STORE, PROMO, [{ dayOfWeek: 2, startsAt: "19:00", endsAt: "23:00" }])).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.table).toBe("promotion_rules");
    expect(op(calls[0], "eq")).toEqual([["eq", "store_id", STORE], ["eq", "id", PROMO]]);
  });

  it("compares windows ignoring the seconds PostgreSQL adds", async () => {
    let call = 0;
    const { repository } = repo((current) => {
      call += 1;
      if (current.table === "promotion_rules") return { data: [{ id: PROMO, priority: 1, is_active: false, name: "Promo" }] };
      if (first(current) === "delete") return { data: [] };
      if (first(current) === "insert") return { data: [{ day_of_week: 2, starts_at: "19:00:00", ends_at: "23:00:00" }] };
      return { data: call === 2 ? [] : [{ day_of_week: 2, starts_at: "19:00:00", ends_at: "23:00:00" }] };
    });
    expect(await repository.replacePromotionSchedule(STORE, PROMO, [{ dayOfWeek: 2, startsAt: "19:00", endsAt: "23:00" }])).toEqual({ ok: true, value: undefined });
  });
});
