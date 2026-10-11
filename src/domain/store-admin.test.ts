import { describe, expect, it } from "vitest";
import { findOverlappingShift, instantFromLocalInput, localInputFromInstant } from "./store-admin";

const TZ = "America/Argentina/Tucuman";
const shift = (dayOfWeek: number, opensAt: string, closesAt: string) => ({ dayOfWeek, opensAt, closesAt });

describe("findOverlappingShift", () => {
  const friday = shift(5, "19:30", "01:30");

  it.each([
    ["the same hours", shift(5, "19:30", "01:30")],
    ["a shift inside another", shift(5, "20:00", "21:00")],
    ["the part after midnight", shift(6, "01:00", "03:00")],
    ["a shift that starts before and ends inside", shift(5, "18:00", "20:00")]
  ])("detects %s", (_case, candidate) => {
    expect(findOverlappingShift([friday], candidate)).toBe(friday);
  });

  it("wraps the week: Saturday until 02:00 overlaps Sunday from 01:00", () => {
    const saturday = shift(6, "20:00", "02:00");
    expect(findOverlappingShift([saturday], shift(0, "01:00", "04:00"))).toBe(saturday);
    expect(findOverlappingShift([shift(0, "01:00", "04:00")], saturday)).toEqual(shift(0, "01:00", "04:00"));
  });

  it.each([
    ["shifts that only touch", shift(6, "01:30", "03:00")],
    ["another day", shift(4, "19:30", "23:00")],
    ["the same day before the shift", shift(5, "12:00", "15:00")]
  ])("accepts %s", (_case, candidate) => {
    expect(findOverlappingShift([friday], candidate)).toBeNull();
  });
});

describe("local datetime inputs", () => {
  it("reads a local time in the store zone (UTC−3) and writes it back", () => {
    const instant = instantFromLocalInput("2026-10-10T19:30", TZ);
    expect(instant?.toISOString()).toBe("2026-10-10T22:30:00.000Z");
    expect(localInputFromInstant(instant!, TZ)).toBe("2026-10-10T19:30");
  });

  it.each([["2026-02-30T10:00"], ["2026-13-01T10:00"], ["2026-10-10T24:00"], ["2026-10-10 19:30"], [""], ["mañana"]])(
    "rejects %j",
    (value) => {
      expect(instantFromLocalInput(value, TZ)).toBeNull();
    }
  );
});
