import { describe, expect, it } from "vitest";
import {
  explainPromotion,
  isPromotionInEffect,
  promotionalPrice,
  promotionDiscount,
  selectPromotion,
  type PromotionContext,
  type PromotionLine
} from "./promotions";
import type { PromotionRule } from "./types";

const TUCUMAN = "America/Argentina/Tucuman";
// Tuesday 2026-10-06 21:00 in Tucumán (UTC-3).
const TUESDAY_NIGHT = new Date("2026-10-07T00:00:00Z");

function rule(overrides: Partial<PromotionRule> & Pick<PromotionRule, "id" | "priority" | "mechanic">): PromotionRule {
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

const burger = (quantity = 1, unitPriceCents = 780000n): PromotionLine => ({
  productId: "burger",
  quantity,
  unitPriceCents,
  basePriceCents: 780000n
});
const fries = (quantity = 1): PromotionLine => ({ productId: "fries", quantity, unitPriceCents: 350000n, basePriceCents: 350000n });

function context(overrides: Partial<PromotionContext> = {}): PromotionContext {
  return { now: TUESDAY_NIGHT, timezone: TUCUMAN, fulfilment: "pickup", deliveryCents: 0n, ...overrides };
}

const tuesdaySmash = rule({
  id: "martes",
  priority: 10,
  mechanic: { type: "percent_off", percentOff: 15 },
  items: [{ productId: "burger", quantity: 1 }],
  schedule: [{ dayOfWeek: 2, startsAt: "18:00:00", endsAt: "23:59:00" }]
});

describe("calendar, weekly windows and pause", () => {
  const ranged = rule({
    id: "ranged",
    priority: 1,
    mechanic: { type: "percent_off", percentOff: 10 },
    startsAt: new Date("2026-10-01T03:00:00Z"),
    endsAt: new Date("2026-11-01T03:00:00Z")
  });

  it("is in effect from startsAt (inclusive) until endsAt (exclusive)", () => {
    expect(isPromotionInEffect(ranged, new Date("2026-10-01T02:59:59.999Z"), TUCUMAN)).toBe(false);
    expect(isPromotionInEffect(ranged, new Date("2026-10-01T03:00:00Z"), TUCUMAN)).toBe(true);
    expect(isPromotionInEffect(ranged, new Date("2026-11-01T02:59:59.999Z"), TUCUMAN)).toBe(true);
    expect(isPromotionInEffect(ranged, new Date("2026-11-01T03:00:00Z"), TUCUMAN)).toBe(false);
  });

  it("follows weekly windows in the store time zone, not UTC", () => {
    // Tuesday 17:59:59 / 18:00 / 23:58 / 23:59 local, then Wednesday 20:00 local.
    expect(isPromotionInEffect(tuesdaySmash, new Date("2026-10-06T20:59:59Z"), TUCUMAN)).toBe(false);
    expect(isPromotionInEffect(tuesdaySmash, new Date("2026-10-06T21:00:00Z"), TUCUMAN)).toBe(true);
    expect(isPromotionInEffect(tuesdaySmash, new Date("2026-10-07T02:58:00Z"), TUCUMAN)).toBe(true);
    expect(isPromotionInEffect(tuesdaySmash, new Date("2026-10-07T02:59:00Z"), TUCUMAN)).toBe(false);
    expect(isPromotionInEffect(tuesdaySmash, new Date("2026-10-07T23:00:00Z"), TUCUMAN)).toBe(false);
    // 22:00 Tuesday in Tucumán is already Wednesday in UTC: still the Tuesday window.
    expect(isPromotionInEffect(tuesdaySmash, new Date("2026-10-07T01:00:00Z"), TUCUMAN)).toBe(true);
  });

  it("supports windows that cross midnight", () => {
    const lateFriday = rule({
      id: "late",
      priority: 1,
      mechanic: { type: "free_delivery" },
      schedule: [{ dayOfWeek: 5, startsAt: "22:00:00", endsAt: "02:00:00" }]
    });
    // Saturday 2026-10-10 01:00 local → inside; 02:00 → outside; Friday 21:59 → outside.
    expect(isPromotionInEffect(lateFriday, new Date("2026-10-10T04:00:00Z"), TUCUMAN)).toBe(true);
    expect(isPromotionInEffect(lateFriday, new Date("2026-10-10T05:00:00Z"), TUCUMAN)).toBe(false);
    expect(isPromotionInEffect(lateFriday, new Date("2026-10-10T00:59:00Z"), TUCUMAN)).toBe(false);
  });

  it("treats a window whose start equals its end as empty, never as 24 hours", () => {
    const sameTime = rule({
      id: "same-time",
      priority: 1,
      mechanic: { type: "percent_off", percentOff: 20 },
      schedule: [{ dayOfWeek: 2, startsAt: "18:00:00", endsAt: "18:00:00" }]
    });
    // Tuesday 18:00 and 21:00, Wednesday 12:00 and 17:59 local: never in effect.
    for (const instant of ["2026-10-06T21:00:00Z", "2026-10-07T00:00:00Z", "2026-10-07T15:00:00Z", "2026-10-07T20:59:00Z"]) {
      expect(isPromotionInEffect(sameTime, new Date(instant), TUCUMAN)).toBe(false);
    }
    expect(selectPromotion([sameTime], [burger()], context())).toBeNull();
    // A genuine Tuesday 22:00–02:00 window still crosses into Wednesday.
    const lateTuesday = { ...sameTime, schedule: [{ dayOfWeek: 2, startsAt: "22:00:00", endsAt: "02:00:00" }] };
    expect(isPromotionInEffect(lateTuesday, new Date("2026-10-07T01:00:00Z"), TUCUMAN)).toBe(true);
    expect(isPromotionInEffect(lateTuesday, new Date("2026-10-07T04:59:00Z"), TUCUMAN)).toBe(true);
    expect(isPromotionInEffect(lateTuesday, new Date("2026-10-07T05:00:00Z"), TUCUMAN)).toBe(false);
    expect(isPromotionInEffect(lateTuesday, new Date("2026-10-07T00:59:00Z"), TUCUMAN)).toBe(false);
  });

  it("never applies a paused promotion, even when it would be the best one", () => {
    const paused = rule({ id: "paused", priority: 99, active: false, mechanic: { type: "percent_off", percentOff: 50 } });
    expect(isPromotionInEffect(paused, TUESDAY_NIGHT, TUCUMAN)).toBe(false);
    expect(selectPromotion([paused, tuesdaySmash], [burger()], context())?.promotionId).toBe("martes");
    expect(selectPromotion([paused], [burger()], context())).toBeNull();
  });
});

describe("single promotion: priority and stable tie-break", () => {
  const tenPercent = rule({ id: "ten", priority: 5, mechanic: { type: "percent_off", percentOff: 10 } });
  const freeDelivery = rule({ id: "envio", priority: 20, mechanic: { type: "free_delivery" } });

  it("applies only the highest-priority eligible promotion; discounts never stack", () => {
    const applied = selectPromotion([tenPercent, tuesdaySmash], [burger(2)], context());
    expect(applied).toMatchObject({ promotionId: "martes", productDiscountCents: 234000n, deliveryDiscountCents: 0n });

    const delivery = selectPromotion([tenPercent, tuesdaySmash, freeDelivery], [burger(2)], context({ fulfilment: "delivery", deliveryCents: 120000n }));
    expect(delivery).toMatchObject({ promotionId: "envio", productDiscountCents: 0n, deliveryDiscountCents: 120000n });
  });

  it("skips a higher-priority rule that gives this order nothing", () => {
    // Free delivery is top priority but the order is pickup; the burger promotion applies.
    expect(selectPromotion([freeDelivery, tuesdaySmash], [burger()], context())?.promotionId).toBe("martes");
    // The burger promotion does not cover fries; the order-wide 10% applies.
    expect(selectPromotion([tuesdaySmash, tenPercent], [fries()], context())?.promotionId).toBe("ten");
  });

  it("breaks priority ties by id, whatever the input order", () => {
    const a = rule({ id: "a-rule", priority: 7, mechanic: { type: "percent_off", percentOff: 5 } });
    const b = rule({ id: "b-rule", priority: 7, mechanic: { type: "percent_off", percentOff: 40 } });
    expect(selectPromotion([a, b], [burger()], context())?.promotionId).toBe("a-rule");
    expect(selectPromotion([b, a], [burger()], context())?.promotionId).toBe("a-rule");
  });

  it("respects the channels a rule applies to", () => {
    const deliveryOnly = rule({ id: "solo-delivery", priority: 50, channels: ["delivery"], mechanic: { type: "percent_off", percentOff: 20 } });
    expect(selectPromotion([deliveryOnly], [burger()], context({ fulfilment: "pickup" }))).toBeNull();
    expect(selectPromotion([deliveryOnly], [burger()], context({ fulfilment: "delivery", deliveryCents: 120000n }))?.promotionId).toBe(
      "solo-delivery"
    );
  });
});

describe("mechanics", () => {
  it("percent_off: exact basis points, rounded down, on what is paid for the listed products", () => {
    const twelveAndAHalf = rule({
      id: "p",
      priority: 1,
      mechanic: { type: "percent_off", percentOff: 12.5 },
      items: [{ productId: "burger", quantity: 1 }]
    });
    // 2 × 781.233 (options included) = 1.562.466 → 12,5% = 195.308,25 → 195.308.
    expect(promotionDiscount(twelveAndAHalf, [burger(2, 781233n), fries()], context()).productDiscountCents).toBe(195308n);
  });

  it("fixed_price: each complete combo costs the fixed price; option surcharges are still charged", () => {
    const combo = rule({
      id: "combo",
      priority: 1,
      mechanic: { type: "fixed_price", fixedPriceCents: 950000n },
      items: [
        { productId: "burger", quantity: 1 },
        { productId: "fries", quantity: 1 }
      ]
    });
    // The lines were added from the combo (their `comboId` is the rule's id).
    const from = (line: PromotionLine): PromotionLine => ({ ...line, comboId: "combo" });
    // One complete set (burger base 780.000 + fries 350.000 = 1.130.000) → 180.000 off; the
    // extra burger and the burger's 90.000 of options are not discounted.
    expect(promotionDiscount(combo, [from(burger(2, 870000n)), from(fries())], context()).productDiscountCents).toBe(180000n);
    expect(promotionDiscount(combo, [from(burger(3)), from(fries(3))], context()).productDiscountCents).toBe(540000n);
    expect(promotionDiscount(combo, [from(burger(3))], context()).productDiscountCents).toBe(0n);
  });

  it("fixed_price: the same products ordered on their own, or from another combo, are not the combo", () => {
    const combo = rule({
      id: "combo",
      priority: 1,
      mechanic: { type: "fixed_price", fixedPriceCents: 950000n },
      items: [
        { productId: "burger", quantity: 1 },
        { productId: "fries", quantity: 1 }
      ]
    });
    expect(promotionDiscount(combo, [burger(), fries()], context()).productDiscountCents).toBe(0n);
    expect(promotionDiscount(combo, [{ ...burger(), comboId: "otro" }, { ...fries(), comboId: "otro" }], context()).productDiscountCents).toBe(0n);
    // Half from the combo and half loose: no complete set.
    expect(promotionDiscount(combo, [{ ...burger(), comboId: "combo" }, fries()], context()).productDiscountCents).toBe(0n);
  });

  it("fixed_price that is not cheaper than the regular price is not a promotion", () => {
    const expensive = rule({ id: "caro", priority: 1, mechanic: { type: "fixed_price", fixedPriceCents: 900000n }, items: [{ productId: "burger", quantity: 1 }] });
    expect(selectPromotion([expensive], [burger()], context())).toBeNull();
  });

  it("buy_x_get_y: the cheapest eligible units are free, at base price", () => {
    const twoForOne = rule({ id: "2x1", priority: 1, mechanic: { type: "buy_x_get_y", buyQuantity: 1, getQuantity: 1 } });
    const lines = [burger(2, 870000n), fries(1)];
    // Units at base price: 350.000, 780.000, 780.000 → one complete pair → 350.000 free.
    expect(promotionDiscount(twoForOne, lines, context()).productDiscountCents).toBe(350000n);
    expect(promotionDiscount(twoForOne, [burger(4)], context()).productDiscountCents).toBe(1560000n);
  });

  it("free_delivery waives the fee once, and only for delivery", () => {
    const free = rule({ id: "envio", priority: 1, mechanic: { type: "free_delivery" } });
    expect(promotionDiscount(free, [burger(5)], context({ fulfilment: "delivery", deliveryCents: 120000n }))).toEqual({
      productDiscountCents: 0n,
      deliveryDiscountCents: 120000n
    });
    expect(promotionDiscount(free, [burger(5)], context({ fulfilment: "pickup" }))).toEqual({ productDiscountCents: 0n, deliveryDiscountCents: 0n });
  });

  it("never discounts more than the order is worth", () => {
    const everything = rule({ id: "all", priority: 1, mechanic: { type: "percent_off", percentOff: 100 } });
    expect(promotionDiscount(everything, [burger(2)], context()).productDiscountCents).toBe(1560000n);
  });

  it("has no quotas or per-unit caps: the same promotion covers every eligible unit", () => {
    expect(promotionDiscount(tuesdaySmash, [burger(20)], context()).productDiscountCents).toBe(2340000n);
  });

  it("gives nothing to an empty order", () => {
    expect(selectPromotion([tuesdaySmash], [], context())).toBeNull();
  });
});

describe("input manipulation", () => {
  it.each([
    ["zero quantity", { ...burger(), quantity: 0 }],
    ["fractional quantity", { ...burger(), quantity: 1.5 }],
    ["negative unit price", { ...burger(), unitPriceCents: -1n }],
    ["base above the paid unit price", { ...burger(), unitPriceCents: 1n }]
  ])("rejects lines with %s instead of pricing them", (_case, line) => {
    expect(() => selectPromotion([tuesdaySmash], [line], context())).toThrow(RangeError);
  });

  it("explains the promotion from its mechanic, never from admin free text", () => {
    const sneaky = rule({
      id: "sneaky",
      priority: 1,
      name: "Promo",
      description: "¡Todo a $1!",
      badgeText: "$1",
      mechanic: { type: "percent_off", percentOff: 15 },
      items: [{ productId: "burger", quantity: 1 }]
    });
    const applied = selectPromotion([sneaky], [burger()], context());
    expect(applied?.explanation).toBe("15% de descuento en productos seleccionados");
    expect(applied?.explanation).not.toContain("$1");
    expect(explainPromotion({ mechanic: { type: "fixed_price", fixedPriceCents: 950000n }, items: [] })).toMatch(/^Combo a \$\s?9\.500$/);
    expect(explainPromotion({ mechanic: { type: "buy_x_get_y", buyQuantity: 2, getQuantity: 1 }, items: [] })).toBe("Llevá 3, pagá 2 en todo el pedido");
    expect(explainPromotion({ mechanic: { type: "free_delivery" }, items: [] })).toBe("Envío gratis");
  });
});

describe("promotionalPrice (struck-through price)", () => {
  const product = { id: "burger", priceCents: 780000n };

  it("derives the promotional price from the real price while the promotion is in effect", () => {
    expect(promotionalPrice(product, [tuesdaySmash], context())).toEqual({
      priceCents: 663000n,
      compareAtPriceCents: 780000n,
      promotionName: "martes",
      explanation: "15% de descuento en productos seleccionados"
    });
  });

  it("shows nothing outside the window, for paused rules or products the rule does not cover", () => {
    expect(promotionalPrice(product, [tuesdaySmash], context({ now: new Date("2026-10-07T23:00:00Z") }))).toBeNull();
    expect(promotionalPrice(product, [{ ...tuesdaySmash, active: false }], context())).toBeNull();
    expect(promotionalPrice({ id: "fries", priceCents: 350000n }, [tuesdaySmash], context())).toBeNull();
  });

  it("follows the selected fulfilment, exactly like the quote", () => {
    const deliveryOnly = rule({ id: "delivery-only", priority: 20, mechanic: { type: "percent_off", percentOff: 20 }, channels: ["delivery"] });
    const pickup = context({ fulfilment: "pickup" });
    const delivery = context({ fulfilment: "delivery", deliveryCents: 120000n });

    expect(promotionalPrice(product, [deliveryOnly], pickup)).toBeNull();
    expect(selectPromotion([deliveryOnly], [burger()], pickup)).toBeNull();

    expect(promotionalPrice(product, [deliveryOnly], delivery)?.priceCents).toBe(624000n);
    expect(selectPromotion([deliveryOnly], [burger()], delivery)?.productDiscountCents).toBe(156000n);

    // With both rules, pickup falls back to the one its channel allows.
    expect(promotionalPrice(product, [deliveryOnly, tuesdaySmash], pickup)?.promotionName).toBe("martes");
    expect(promotionalPrice(product, [deliveryOnly, tuesdaySmash], delivery)?.promotionName).toBe("delivery-only");
  });

  it("strikes nothing when the promotion that would win is free delivery", () => {
    const freeDelivery = rule({ id: "envio", priority: 30, mechanic: { type: "free_delivery" } });
    const delivery = context({ fulfilment: "delivery", deliveryCents: 120000n });
    expect(selectPromotion([freeDelivery, tuesdaySmash], [burger()], delivery)?.promotionId).toBe("envio");
    expect(promotionalPrice(product, [freeDelivery, tuesdaySmash], delivery)).toBeNull();
    // Pickup never gets free delivery, so the product promotion applies and is shown.
    expect(promotionalPrice(product, [freeDelivery, tuesdaySmash], context())?.promotionName).toBe("martes");
  });
});
