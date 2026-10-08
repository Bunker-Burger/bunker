import { describe, expect, it } from "vitest";
import type { StoreOperatingSettings } from "@/domain/store-status";
import { ok } from "@/lib/result";
import { catalogError } from "./errors";
import { loadStoreStatus, storeStatusResponse, type StoreOperatingRepository } from "./store-status";

const settings: StoreOperatingSettings = {
  timezone: "America/Argentina/Tucuman",
  statusOverride: "auto",
  deliveryFeeCents: 120000n,
  businessHours: [{ dayOfWeek: 3, opensAt: "19:30", closesAt: "00:00" }]
};

/** One public store, "bunker-burger", with the given persisted settings. */
function repository(overrides: Partial<StoreOperatingSettings> = {}): StoreOperatingRepository {
  return {
    async getOperatingSettings(slug) {
      return slug === "bunker-burger" ? ok({ ...settings, ...overrides }) : catalogError("not_found", `stores: no public store "${slug}"`);
    }
  };
}

describe("loadStoreStatus", () => {
  it("evaluates the persisted hours at the given instant", async () => {
    // Wednesday 2026-10-07 20:00 in Tucumán.
    const open = await loadStoreStatus(repository(), "bunker-burger", new Date("2026-10-07T23:00:00Z"));
    expect(open).toMatchObject({ ok: true, value: { state: "open", acceptingOrders: true, closesAt: new Date("2026-10-08T03:00:00Z") } });

    const closed = await loadStoreStatus(repository(), "bunker-burger", new Date("2026-10-08T03:00:00Z"));
    expect(closed).toMatchObject({ ok: true, value: { state: "closed", nextOpeningAt: new Date("2026-10-14T22:30:00Z") } });
  });

  it("honours the persisted override and fee", async () => {
    const paused = await loadStoreStatus(repository({ statusOverride: "paused" }), "bunker-burger", new Date("2026-10-07T23:00:00Z"));
    expect(paused).toMatchObject({ ok: true, value: { state: "paused", acceptingOrders: false } });

    const noFee = await loadStoreStatus(repository({ deliveryFeeCents: null }), "bunker-burger", new Date("2026-10-07T23:00:00Z"));
    expect(noFee).toMatchObject({ ok: true, value: { acceptingOrders: false, reason: "delivery_fee_missing" } });
  });

  it("propagates read failures", async () => {
    expect(await loadStoreStatus(repository(), "otra")).toMatchObject({ ok: false, error: { code: "not_found" } });
  });
});

describe("storeStatusResponse", () => {
  it("returns the minimal public status, uncached, with money as a string", async () => {
    const status = await loadStoreStatus(repository(), "bunker-burger", new Date("2026-10-07T12:00:00Z"));
    const response = storeStatusResponse(status);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      state: "closed",
      acceptingOrders: false,
      reason: "schedule",
      closesAt: null,
      nextOpeningAt: "2026-10-07T22:30:00.000Z",
      deliveryFeeCents: "120000",
      timezone: "America/Argentina/Tucuman"
    });
  });

  it.each([
    ["not_found", 404],
    ["unavailable", 503],
    ["misconfigured", 503],
    ["invalid_data", 503]
  ] as const)("fails closed on %s with HTTP %i and only the error code", async (code, httpStatus) => {
    const response = storeStatusResponse(catalogError(code, "internal detail that must not leak"));
    expect(response.status).toBe(httpStatus);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ acceptingOrders: false, error: code });
  });
});
