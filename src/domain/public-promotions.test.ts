import { describe, expect, it } from "vitest";
import { selectPromotion } from "./promotions";
import { parsePublicPromotions, toPromotionRule, toPublicPromotion } from "./public-promotions";
import type { PromotionRule } from "./types";

const rule: PromotionRule = {
  id: "combo",
  slug: "combo",
  name: "Combo",
  description: "¡Todo a $1!",
  badgeText: "$1",
  priority: 3,
  active: true,
  startsAt: new Date("2026-10-01T03:00:00Z"),
  endsAt: new Date("2027-04-01T02:59:00Z"),
  mechanic: { type: "fixed_price", fixedPriceCents: 900000n },
  channels: ["pickup"],
  items: [
    { productId: "db-burger", quantity: 1 },
    { productId: "db-hidden", quantity: 1 }
  ],
  schedule: [{ dayOfWeek: 5, startsAt: "22:00:00", endsAt: "02:00:00" }]
};

const slugs = new Map([["db-burger", "smash-bunker-doble"]]);

describe("public promotions", () => {
  it("publishes only what the engine needs: no admin text, money as a string, products by slug", () => {
    const published = toPublicPromotion(rule, slugs);
    expect(published).toEqual({
      id: "combo",
      slug: "combo",
      name: "Combo",
      priority: 3,
      startsAt: "2026-10-01T03:00:00.000Z",
      endsAt: "2027-04-01T02:59:00.000Z",
      mechanic: { type: "fixed_price", fixedPriceCents: "900000" },
      channels: ["pickup"],
      items: [
        { productSlug: "smash-bunker-doble", quantity: 1 },
        { productSlug: null, quantity: 1 }
      ],
      schedule: [{ dayOfWeek: 5, startsAt: "22:00:00", endsAt: "02:00:00" }]
    });
    expect(JSON.stringify(published)).not.toMatch(/Todo a|\$1|description|badge/);
  });

  it("round-trips through JSON into an equivalent engine rule with the storefront's ids", () => {
    const [parsed] = parsePublicPromotions(JSON.parse(JSON.stringify({ promotions: [toPublicPromotion(rule, slugs)] })))!;
    const restored = toPromotionRule(parsed!, new Map([["smash-bunker-doble", "smash-doble"]]));
    expect(restored).toMatchObject({
      active: true,
      description: "",
      badgeText: null,
      mechanic: { type: "fixed_price", fixedPriceCents: 900000n },
      startsAt: rule.startsAt,
      endsAt: rule.endsAt,
      channels: ["pickup"],
      schedule: rule.schedule
    });
    expect(restored.items[0]).toEqual({ productId: "smash-doble", quantity: 1 });
  });

  it("keeps an item whose product is not public as one that matches nothing, never as a whole-order rule", () => {
    const percent: PromotionRule = { ...rule, mechanic: { type: "percent_off", percentOff: 50 }, schedule: [], channels: ["pickup"], items: [{ productId: "db-hidden", quantity: 1 }] };
    const restored = toPromotionRule(toPublicPromotion(percent, slugs), new Map([["smash-bunker-doble", "smash-doble"]]));
    expect(restored.items).toHaveLength(1);
    const line = { productId: "smash-doble", quantity: 1, unitPriceCents: 780000n, basePriceCents: 780000n };
    expect(
      selectPromotion([restored], [line], { now: new Date("2026-10-10T12:00:00Z"), timezone: "America/Argentina/Tucuman", fulfilment: "pickup", deliveryCents: 0n })
    ).toBeNull();
  });

  it("rejects anything that is not a valid body, errors included", () => {
    expect(parsePublicPromotions({ error: "unavailable" })).toBeNull();
    expect(parsePublicPromotions(null)).toBeNull();
    const valid = toPublicPromotion(rule, slugs);
    expect(parsePublicPromotions({ promotions: [{ ...valid, mechanic: { type: "fixed_price", fixedPriceCents: "-1" } }] })).toBeNull();
    expect(parsePublicPromotions({ promotions: [{ ...valid, mechanic: { type: "percent_off", percentOff: 150 } }] })).toBeNull();
    expect(parsePublicPromotions({ promotions: [{ ...valid, channels: ["drone"] }] })).toBeNull();
    expect(parsePublicPromotions({ promotions: [{ ...valid, startsAt: "martes" }] })).toBeNull();
    expect(parsePublicPromotions({ promotions: [valid] })).toHaveLength(1);
  });

  it("publishes the banner photo and its badge only for promotions with a photo (issue #54)", () => {
    const withPhoto = { ...rule, imageUrl: "https://cdn.test/catalog/s1/promotions/combo.webp" };
    const published = toPublicPromotion(withPhoto, slugs);
    expect(published).toMatchObject({ imageUrl: withPhoto.imageUrl, badgeText: "$1" });
    const [parsed] = parsePublicPromotions(JSON.parse(JSON.stringify({ promotions: [published] })))!;
    expect(toPromotionRule(parsed!, new Map())).toMatchObject({ imageUrl: withPhoto.imageUrl, badgeText: "$1" });
    expect(toPublicPromotion(rule, slugs)).not.toHaveProperty("imageUrl");
  });
});
