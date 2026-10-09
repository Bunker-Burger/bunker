import { describe, expect, it } from "vitest";
import type { CartLine } from "@/domain/types";
import {
  changeLineQuantity,
  clearCart,
  clearOptionGroup,
  editCartLine,
  removeCartLine,
  toggleOption,
  updateCartLineNotes
} from "./storefront-state";

const line: CartLine = {
  id: "line-1",
  productId: "classic",
  productSlug: "bunker-clasica",
  productName: "Búnker Clásica",
  unitPriceCents: 780000n,
  quantity: 2,
  notes: "",
  selectedOptions: {}
};

describe("cart editing", () => {
  it("removes a cart line when its quantity reaches zero", () => {
    expect(changeLineQuantity([line], line.id, -2)).toEqual([]);
  });

  it("changes only the requested cart line quantity", () => {
    const other = { ...line, id: "line-2", quantity: 1 };
    expect(changeLineQuantity([line, other], line.id, 1)).toEqual([
      { ...line, quantity: 3 },
      other
    ]);
  });

  it("updates notes without losing quantity or options (TC-EDIT-01)", () => {
    const updated = updateCartLineNotes([line], line.id, "sin mayonesa");
    expect(updated[0]?.notes).toBe("sin mayonesa");
    expect(updated[0]?.quantity).toBe(2);
    expect(updated[0]?.unitPriceCents).toBe(780000n);
  });

  it("updates line options and recalculates price via editCartLine", () => {
    const updated = editCartLine([line], line.id, {
      selectedOptions: { patty: ["triple"] },
      unitPriceCents: 940000n
    });
    expect(updated[0]?.unitPriceCents).toBe(940000n);
    expect(updated[0]?.quantity).toBe(2);
  });

  it("removes line and clears cart", () => {
    expect(removeCartLine([line], line.id)).toEqual([]);
    expect(clearCart()).toEqual([]);
  });
});

describe("product option selection", () => {
  it("replaces the previous option in a single-select group", () => {
    expect(toggleOption({ size: ["double"] }, "size", "triple", 1, true, "single", true)).toEqual({
      size: ["triple"]
    });
  });

  it("toggles options without exceeding a multi-select maximum", () => {
    expect(toggleOption({ extras: ["bacon", "cheddar"] }, "extras", "egg", 2, true, "multiple", false)).toEqual({
      extras: ["bacon", "cheddar"]
    });
    expect(toggleOption({ extras: ["bacon", "cheddar"] }, "extras", "bacon", 2, true, "multiple", false)).toEqual({
      extras: ["cheddar"]
    });
  });

  it("allows selecting, prevents selecting a second, and allows deselecting when mode is multiple with maxSelections 1", () => {
    const initial = toggleOption({}, "extras", "opt1", 1, true, "multiple", false);
    expect(initial).toEqual({ extras: ["opt1"] });

    const blocked = toggleOption(initial, "extras", "opt2", 1, true, "multiple", false);
    expect(blocked).toEqual({ extras: ["opt1"] });

    const deselected = toggleOption(initial, "extras", "opt1", 1, true, "multiple", false);
    expect(deselected).toEqual({ extras: [] });
  });

  it("allows selecting and deselecting in a single optional group (required: false)", () => {
    const initial = toggleOption({}, "dressing", "mayo", 1, true, "single", false);
    expect(initial).toEqual({ dressing: ["mayo"] });

    const deselected = toggleOption(initial, "dressing", "mayo", 1, true, "single", false);
    expect(deselected).toEqual({ dressing: [] });
  });

  it("prevents deselecting an already selected option in a single required group (required: true)", () => {
    const initial = { size: ["double"] };
    const retained = toggleOption(initial, "size", "double", 1, true, "single", true);
    expect(retained).toEqual({ size: ["double"] });
  });

  it("clears group selection using clearOptionGroup", () => {
    const current = { size: ["double"], extras: ["bacon"] };
    expect(clearOptionGroup(current, "size")).toEqual({ size: [], extras: ["bacon"] });
  });
});
