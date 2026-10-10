import { describe, expect, it } from "vitest";
import { parseImageDetails, parsePriceCents, parseProductForm, slugify } from "./input";

describe("slugify", () => {
  it.each([
    ["Sándwich de Cerdo!", "sandwich-de-cerdo"],
    ["  Papas   Búnker  ", "papas-bunker"],
    ["Ñandú & Co.", "nandu-co"],
    ["---", ""]
  ])("%j → %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });
});

describe("parsePriceCents", () => {
  it.each([
    ["7800", 780000n],
    ["7800.5", 780050n],
    ["7800.05", 780005n],
    ["0", 0n],
    ["9999999.99", 999999999n]
  ])("%j pesos → %s cents", (input, cents) => {
    expect(parsePriceCents(input)).toBe(cents);
  });

  it.each([["7.800,50"], ["-1"], ["1e3"], ["7800.123"], ["10000000"], [""], ["abc"]])("rejects %j", (input) => {
    expect(parsePriceCents(input)).toBeNull();
  });
});

describe("parseProductForm", () => {
  const G1 = "0199b2c8-40b0-7000-8000-000000000301";
  const O1 = "0199b2c8-40b0-7000-8000-000000000401";

  function product(extra: Array<[string, string]> = []) {
    const data = new FormData();
    data.set("categoryId", "0199B2C8-40B0-7000-8000-000000000101");
    data.set("name", "  Smash  ");
    data.set("price", "7800");
    for (const [key, value] of extra) data.append(key, value);
    return data;
  }

  it("normalizes ids, derives the slug and reads unchecked boxes as false", () => {
    const parsed = parseProductForm(product([["optionGroup", G1], [`default:${G1}`, O1], [`default:${G1}`, ""]]));
    expect(parsed).toEqual({
      ok: true,
      value: {
        fields: { categoryId: "0199b2c8-40b0-7000-8000-000000000101", name: "Smash", slug: "smash", description: "", priceCents: 780000n, inStock: false, featured: false },
        published: false,
        optionGroups: [{ groupId: G1, defaultOptionIds: [O1] }]
      }
    });
  });

  it("rejects repeated groups, malformed ids and bad slugs", () => {
    expect(parseProductForm(product([["optionGroup", G1], ["optionGroup", G1]]))).toMatchObject({ ok: false, error: { optionGroups: "Un grupo de opciones está repetido." } });
    expect(parseProductForm(product([["optionGroup", "not-a-uuid"]]))).toMatchObject({ ok: false, error: { optionGroups: expect.any(String) } });
    expect(parseProductForm(product([["slug", "Con Espacios"]]))).toMatchObject({ ok: false, error: { slug: expect.any(String) } });
  });
});

describe("parseImageDetails", () => {
  it("falls back to the product name for an empty alt text and centres by default", () => {
    expect(parseImageDetails(new FormData(), "Smash")).toEqual({ ok: true, value: { altText: "Smash", focalX: 50, focalY: 50 } });
  });
});
