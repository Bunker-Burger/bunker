import { describe, expect, it } from "vitest";
import {
  assertAcceptingOrders,
  deliveryChargeCents,
  evaluateStoreStatus,
  isValidTimeZone,
  parsePublicStoreStatus,
  StoreNotAcceptingOrdersError,
  toPublicStoreStatus,
  wallClockSeconds,
  zonedInstant,
  type BusinessHoursWindow,
  type StoreOperatingSettings
} from "./store-status";

const TUCUMAN = "America/Argentina/Tucuman";

// Same shape as supabase/seed.sql: closed Mondays, Fri/Sat cross midnight.
const weeklyHours: BusinessHoursWindow[] = [
  { dayOfWeek: 0, opensAt: "19:30", closesAt: "00:00" },
  { dayOfWeek: 2, opensAt: "19:30", closesAt: "00:00" },
  { dayOfWeek: 3, opensAt: "19:30", closesAt: "00:00" },
  { dayOfWeek: 4, opensAt: "19:30", closesAt: "00:00" },
  { dayOfWeek: 5, opensAt: "19:30", closesAt: "01:30" },
  { dayOfWeek: 6, opensAt: "19:30", closesAt: "01:30" }
];

function settings(overrides: Partial<StoreOperatingSettings> = {}): StoreOperatingSettings {
  return { timezone: TUCUMAN, statusOverride: "auto", deliveryFeeCents: 120000n, businessHours: weeklyHours, ...overrides };
}

const at = (iso: string) => new Date(iso);
const status = (now: string, overrides: Partial<StoreOperatingSettings> = {}) => evaluateStoreStatus(settings(overrides), at(now));

describe("evaluateStoreStatus — weekly hours in America/Argentina/Tucuman (UTC-3)", () => {
  it("is closed before opening and reports the next opening", () => {
    // Wednesday 2026-10-07 09:00 local.
    expect(status("2026-10-07T12:00:00Z")).toEqual({
      state: "closed",
      acceptingOrders: false,
      reason: "schedule",
      closesAt: null,
      nextOpeningAt: at("2026-10-07T22:30:00Z"),
      deliveryFeeCents: 120000n,
      timezone: TUCUMAN
    });
  });

  it("opens exactly at the opening time, not a millisecond before", () => {
    expect(status("2026-10-07T22:29:59.999Z")).toMatchObject({ acceptingOrders: false, nextOpeningAt: at("2026-10-07T22:30:00Z") });
    expect(status("2026-10-07T22:30:00Z")).toMatchObject({
      state: "open",
      acceptingOrders: true,
      reason: "schedule",
      closesAt: at("2026-10-08T03:00:00Z")
    });
  });

  it("treats 00:00 as closing at midnight, and skips the closed Monday", () => {
    // Sunday 2026-10-11 23:59:59 local → open; Monday 00:00 → closed until Tuesday 19:30.
    expect(status("2026-10-12T02:59:59Z")).toMatchObject({ state: "open", closesAt: at("2026-10-12T03:00:00Z") });
    expect(status("2026-10-12T03:00:00Z")).toMatchObject({
      state: "closed",
      nextOpeningAt: at("2026-10-13T22:30:00Z")
    });
  });

  it("keeps a shift open after midnight and closes it at the next-day boundary", () => {
    // Friday 19:30 → Saturday 01:30. Saturday 00:45 local belongs to Friday's shift.
    expect(status("2026-10-10T03:45:00Z")).toMatchObject({ state: "open", closesAt: at("2026-10-10T04:30:00Z") });
    expect(status("2026-10-10T04:29:59Z")).toMatchObject({ acceptingOrders: true });
    expect(status("2026-10-10T04:30:00Z")).toMatchObject({
      state: "closed",
      nextOpeningAt: at("2026-10-10T22:30:00Z")
    });
  });

  it("wraps the week: Saturday's shift runs into Sunday", () => {
    // Sunday 2026-10-11 01:00 local is inside Saturday's 19:30–01:30 shift.
    expect(status("2026-10-11T04:00:00Z")).toMatchObject({ state: "open", closesAt: at("2026-10-11T04:30:00Z") });
  });

  it("merges back-to-back shifts across midnight into one opening", () => {
    const hours = [
      { dayOfWeek: 1, opensAt: "20:00", closesAt: "00:00" },
      { dayOfWeek: 2, opensAt: "00:00", closesAt: "02:00" }
    ];
    // Monday 2026-10-12 23:00 local.
    expect(status("2026-10-13T02:00:00Z", { businessHours: hours })).toMatchObject({
      state: "open",
      closesAt: at("2026-10-13T05:00:00Z")
    });
  });

  it("crosses year and leap-day boundaries", () => {
    const hours = [
      { dayOfWeek: 4, opensAt: "21:00", closesAt: "03:00" }, // Thursday 2026-12-31 → Friday 2027-01-01
      { dayOfWeek: 1, opensAt: "22:00", closesAt: "01:00" } // Monday 2028-02-28 → Tuesday 2028-02-29
    ];
    expect(status("2027-01-01T04:00:00Z", { businessHours: hours })).toMatchObject({
      state: "open",
      closesAt: at("2027-01-01T06:00:00Z")
    });
    expect(status("2028-02-29T03:30:00Z", { businessHours: hours })).toMatchObject({
      state: "open",
      closesAt: at("2028-02-29T04:00:00Z")
    });
    expect(status("2028-02-29T04:00:00Z", { businessHours: hours })).toMatchObject({
      state: "closed",
      nextOpeningAt: at("2028-03-03T00:00:00Z")
    });
  });

  it("stays closed without a next opening when no hours are configured", () => {
    expect(status("2026-10-07T23:00:00Z", { businessHours: [] })).toMatchObject({
      state: "closed",
      acceptingOrders: false,
      reason: "schedule",
      nextOpeningAt: null
    });
  });
});

describe("evaluateStoreStatus — daylight saving transitions", () => {
  it("shortens a shift that spans Tucumán's 2007-12-30 spring-forward (00:00 → 01:00)", () => {
    // Saturday 2007-12-29 20:00 (UTC-3) → Sunday 02:00 (UTC-2): five real hours, not six.
    const hours = [{ dayOfWeek: 6, opensAt: "20:00", closesAt: "02:00" }];
    expect(status("2007-12-30T03:30:00Z", { businessHours: hours })).toMatchObject({
      state: "open",
      closesAt: at("2007-12-30T04:00:00Z")
    });
    expect(status("2007-12-30T04:00:00Z", { businessHours: hours })).toMatchObject({ state: "closed" });
  });

  it("lengthens a shift that spans Tucumán's 2008-03-16 fall-back (00:00 → 23:00)", () => {
    // Saturday 2008-03-15 19:30 (UTC-2) → Sunday 00:00 (UTC-3); 23:30 happens twice and both are open.
    const hours = [{ dayOfWeek: 6, opensAt: "19:30", closesAt: "00:00" }];
    expect(status("2008-03-15T21:29:59Z", { businessHours: hours })).toMatchObject({ state: "closed" });
    expect(status("2008-03-15T21:45:00Z", { businessHours: hours })).toMatchObject({ state: "open" });
    expect(status("2008-03-16T01:30:00Z", { businessHours: hours })).toMatchObject({ state: "open" });
    expect(status("2008-03-16T02:30:00Z", { businessHours: hours })).toMatchObject({
      state: "open",
      closesAt: at("2008-03-16T03:00:00Z")
    });
  });

  it("follows America/New_York across spring-forward and fall-back", () => {
    const tz = { timezone: "America/New_York" };
    // Saturday 2026-03-07 22:00 EST → Sunday 03:00 EDT.
    const spring = { ...tz, businessHours: [{ dayOfWeek: 6, opensAt: "22:00", closesAt: "03:00" }] };
    expect(status("2026-03-08T06:59:00Z", spring)).toMatchObject({ state: "open", closesAt: at("2026-03-08T07:00:00Z") });
    // Saturday 2026-10-31 22:00 EDT → Sunday 02:00 EST.
    const fall = { ...tz, businessHours: [{ dayOfWeek: 6, opensAt: "22:00", closesAt: "02:00" }] };
    expect(status("2026-11-01T06:30:00Z", fall)).toMatchObject({ state: "open", closesAt: at("2026-11-01T07:00:00Z") });
  });

  it("opens a shift scheduled inside a skipped hour once the clock jumps", () => {
    // 00:30 does not exist on 2007-12-30 in Tucumán; it opens at 01:30 (UTC-2).
    const hours = [{ dayOfWeek: 0, opensAt: "00:30", closesAt: "04:00" }];
    expect(status("2007-12-30T02:00:00Z", { businessHours: hours })).toMatchObject({
      state: "closed",
      nextOpeningAt: at("2007-12-30T03:30:00Z")
    });
  });
});

describe("evaluateStoreStatus — manual override and delivery fee", () => {
  const insideHours = "2026-10-07T23:00:00Z";
  const outsideHours = "2026-10-07T12:00:00Z";

  it("open accepts orders outside the hours, without a schedule-based closing time", () => {
    expect(status(outsideHours, { statusOverride: "open" })).toMatchObject({
      state: "open",
      acceptingOrders: true,
      reason: "manual_open",
      closesAt: null,
      nextOpeningAt: null
    });
  });

  it("paused and closed block orders even inside the hours", () => {
    expect(status(insideHours, { statusOverride: "paused" })).toMatchObject({
      state: "paused",
      acceptingOrders: false,
      reason: "manual_paused",
      nextOpeningAt: null
    });
    expect(status(insideHours, { statusOverride: "closed" })).toMatchObject({
      state: "closed",
      acceptingOrders: false,
      reason: "manual_closed"
    });
  });

  it("refuses orders without a configured delivery fee, even when forced open", () => {
    for (const statusOverride of ["auto", "open"] as const) {
      expect(status(insideHours, { statusOverride, deliveryFeeCents: null })).toMatchObject({
        state: "closed",
        acceptingOrders: false,
        reason: "delivery_fee_missing",
        deliveryFeeCents: null
      });
    }
  });
});

describe("delivery charge", () => {
  const open = evaluateStoreStatus(settings({ statusOverride: "open" }), at("2026-10-07T12:00:00Z"));

  it("charges the fixed fee once for delivery and nothing for pickup", () => {
    expect(deliveryChargeCents(open, "delivery")).toBe(120000n);
    expect(deliveryChargeCents(open, "pickup")).toBe(0n);
  });

  it("blocks pricing and sending while the store is not taking orders", () => {
    const closed = evaluateStoreStatus(settings(), at("2026-10-07T12:00:00Z"));
    expect(() => deliveryChargeCents(closed, "pickup")).toThrow(StoreNotAcceptingOrdersError);
    expect(() => assertAcceptingOrders(closed)).toThrow(/schedule/);
    expect(() => assertAcceptingOrders(open)).not.toThrow();
  });
});

describe("time helpers", () => {
  it("parses wall-clock times and rejects anything else", () => {
    expect(wallClockSeconds("00:00")).toBe(0);
    expect(wallClockSeconds("19:30:15")).toBe(70215);
    for (const bad of ["24:00", "7:30", "19:60", "", "19:30:60"]) expect(() => wallClockSeconds(bad)).toThrow(RangeError);
  });

  it("validates IANA time zones", () => {
    expect(isValidTimeZone(TUCUMAN)).toBe(true);
    expect(isValidTimeZone("America/Atlantis")).toBe(false);
  });

  it("resolves repeated local times to the earlier instant", () => {
    // 01:30 on 2026-11-01 happens twice in New York: 05:30Z (EDT) and 06:30Z (EST).
    expect(zonedInstant(Date.UTC(2026, 10, 1), 5400, "America/New_York")).toBe(Date.parse("2026-11-01T05:30:00Z"));
  });
});

describe("pickup place (issue #54)", () => {
  it("is published with the status only when the store set it", () => {
    const now = "2026-10-13T23:00:00Z";
    const withPlace = toPublicStoreStatus(status(now, { pickupAddress: "San Lorenzo 877, Aguilares", pickupMapsUrl: "https://maps.app.goo.gl/x" }));
    expect(withPlace).toMatchObject({ pickupAddress: "San Lorenzo 877, Aguilares", pickupMapsUrl: "https://maps.app.goo.gl/x" });
    expect(parsePublicStoreStatus(JSON.parse(JSON.stringify(withPlace)))).toMatchObject({ pickupAddress: "San Lorenzo 877, Aguilares" });
    expect(toPublicStoreStatus(status(now))).not.toHaveProperty("pickupAddress");
  });

  it("refuses a map link that is not https", () => {
    const published = { ...toPublicStoreStatus(status("2026-10-13T23:00:00Z")), pickupAddress: "Acá", pickupMapsUrl: "javascript:alert(1)" };
    expect(parsePublicStoreStatus(published)).toBeNull();
  });
});
