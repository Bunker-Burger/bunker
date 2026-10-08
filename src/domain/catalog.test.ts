import { describe, expect, it } from "vitest";
import { getDefaultSelection, isPublishable } from "./catalog";
import type { Product } from "./types";

const product: Product = {
  id: "classic",
  slug: "bunker-clasica",
  categoryId: "burgers",
  type: "burger",
  name: "Búnker Clásica",
  description: "Doble smash, cheddar y salsa Búnker.",
  priceCents: 980000n,
  imageUrl: "/placeholder.jpg",
  published: true,
  featured: true,
  inStock: true,
  optionGroups: [
    {
      id: "patty",
      name: "Medallón",
      selectionMode: "single",
      required: true,
      minSelections: 1,
      maxSelections: 1,
      defaultOptionIds: ["double"],
      applicableTypes: ["burger"],
      options: [
        { id: "double", name: "Doble", priceDeltaCents: 0n, available: true },
        { id: "triple", name: "Triple", priceDeltaCents: 220000n, available: true }
      ]
    }
  ]
};

describe("catalog defaults", () => {
  it("builds the direct-add selection from required defaults", () => {
    expect(getDefaultSelection(product)).toEqual({ patty: ["double"] });
  });

  it("blocks publication when a required group lacks a valid default", () => {
    const invalid = structuredClone(product);
    invalid.optionGroups[0]!.defaultOptionIds = [];
    expect(isPublishable(invalid)).toBe(false);
  });

  it("blocks alcoholic beverages", () => {
    expect(isPublishable({ ...product, type: "beverage", containsAlcohol: true })).toBe(false);
  });
});

