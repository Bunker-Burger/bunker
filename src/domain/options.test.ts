import { describe, expect, it } from "vitest";
import {
  calculateConfiguredUnitPrice,
  clearOptionGroup,
  getApplicableOptionGroups,
  getDefaultSelection,
  isGroupApplicableToProduct,
  isPublishable,
  MAX_SAME_EXTRA,
  toggleOption,
  validateOptionSelection,
  validateProductPublication
} from "./options";
import type { OptionGroup, Product, SelectedOptions } from "./types";
import { products } from "@/data/catalog";

const sampleBurgerGroup: OptionGroup = {
  id: "patty",
  name: "Medallón",
  selectionMode: "single",
  required: true,
  minSelections: 1,
  maxSelections: 1,
  defaultOptionIds: ["double"],
  applicableTypes: ["burger"],
  options: [
    { id: "double", name: "Doble smash", priceDeltaCents: 0n, available: true },
    { id: "triple", name: "Triple smash", priceDeltaCents: 160000n, available: true },
    { id: "quad", name: "Cuádruple", priceDeltaCents: 320000n, available: false }
  ]
};

const sampleExtrasGroup: OptionGroup = {
  id: "extras",
  name: "Extras",
  selectionMode: "multiple",
  required: false,
  minSelections: 0,
  maxSelections: 3,
  defaultOptionIds: [],
  applicableTypes: ["burger", "sandwich"],
  options: [
    { id: "bacon", name: "Extra bacon", priceDeltaCents: 90000n, available: true },
    { id: "cheddar", name: "Extra cheddar", priceDeltaCents: 80000n, available: true },
    { id: "egg", name: "Huevo", priceDeltaCents: 60000n, available: true },
    { id: "truffle", name: "Trufa especial", priceDeltaCents: 150000n, available: false }
  ]
};

const burgerProduct: Product = {
  id: "bunker-burger-1",
  slug: "smash-doble",
  categoryId: "burgers",
  type: "burger",
  name: "Smash Búnker Doble",
  description: "Doble carne, doble queso cheddar.",
  priceCents: 780000n,
  imageUrl: "/burger.jpg",
  published: true,
  featured: true,
  inStock: true,
  optionGroups: [sampleBurgerGroup, sampleExtrasGroup]
};

const sandwichProduct: Product = {
  id: "sandwich-1",
  slug: "crispy-chicken",
  categoryId: "sandwiches",
  type: "sandwich",
  name: "Crispy Chicken",
  description: "Pollo crocante.",
  priceCents: 680000n,
  imageUrl: "/sandwich.jpg",
  published: true,
  featured: false,
  inStock: true,
  optionGroups: [
    {
      id: "bread",
      name: "Tipo de pan",
      selectionMode: "single",
      required: true,
      minSelections: 1,
      maxSelections: 1,
      defaultOptionIds: ["brioche"],
      applicableTypes: ["sandwich"],
      options: [
        { id: "brioche", name: "Pan brioche", priceDeltaCents: 0n, available: true },
        { id: "potato", name: "Pan de papa", priceDeltaCents: 0n, available: true }
      ]
    }
  ]
};

const friesProduct: Product = {
  id: "fries-1",
  slug: "papas-bunker",
  categoryId: "fries",
  type: "fries",
  name: "Papas Búnker",
  description: "Papas rústicas.",
  priceCents: 350000n,
  imageUrl: "/fries.jpg",
  published: true,
  featured: false,
  inStock: true,
  optionGroups: [
    {
      id: "portion",
      name: "Tamaño",
      selectionMode: "single",
      required: true,
      minSelections: 1,
      maxSelections: 1,
      defaultOptionIds: ["regular"],
      applicableTypes: ["fries"],
      options: [
        { id: "regular", name: "Regular", priceDeltaCents: 0n, available: true },
        { id: "large", name: "Grande", priceDeltaCents: 120000n, available: true }
      ]
    }
  ]
};

const beverageProduct: Product = {
  id: "drink-1",
  slug: "gaseosa-lata",
  categoryId: "drinks",
  type: "beverage",
  name: "Gaseosa Lata",
  description: "Gaseosa 354ml.",
  priceCents: 140000n,
  imageUrl: "/drink.jpg",
  published: true,
  featured: false,
  inStock: true,
  containsAlcohol: false,
  optionGroups: [
    {
      id: "ice",
      name: "Hielo",
      selectionMode: "single",
      required: true,
      minSelections: 1,
      maxSelections: 1,
      defaultOptionIds: ["with-ice"],
      applicableTypes: ["beverage"],
      options: [
        { id: "with-ice", name: "Con hielo", priceDeltaCents: 0n, available: true },
        { id: "no-ice", name: "Sin hielo", priceDeltaCents: 0n, available: true }
      ]
    }
  ]
};

describe("BB-05: Motor de opciones y defaults", () => {
  describe("Criterio 1: Agregado directo válido para los cuatro tipos", () => {
    it("produce una configuración válida para hamburguesa", () => {
      const defaults = getDefaultSelection(burgerProduct);
      expect(defaults).toEqual({ patty: ["double"], extras: [] });

      const validation = validateOptionSelection(burgerProduct, defaults);
      expect(validation.ok).toBe(true);
      if (validation.ok) {
        expect(validation.value.unitPriceCents).toBe(780000n);
      }
    });

    it("produce una configuración válida para sándwich", () => {
      const defaults = getDefaultSelection(sandwichProduct);
      expect(defaults).toEqual({ bread: ["brioche"] });

      const validation = validateOptionSelection(sandwichProduct, defaults);
      expect(validation.ok).toBe(true);
      if (validation.ok) {
        expect(validation.value.unitPriceCents).toBe(680000n);
      }
    });

    it("produce una configuración válida para papas", () => {
      const defaults = getDefaultSelection(friesProduct);
      expect(defaults).toEqual({ portion: ["regular"] });

      const validation = validateOptionSelection(friesProduct, defaults);
      expect(validation.ok).toBe(true);
      if (validation.ok) {
        expect(validation.value.unitPriceCents).toBe(350000n);
      }
    });

    it("produce una configuración válida para bebida", () => {
      const defaults = getDefaultSelection(beverageProduct);
      expect(defaults).toEqual({ ice: ["with-ice"] });

      const validation = validateOptionSelection(beverageProduct, defaults);
      expect(validation.ok).toBe(true);
      if (validation.ok) {
        expect(validation.value.unitPriceCents).toBe(140000n);
      }
    });

    it("valida el agregado directo para todos los productos del catálogo semilla", () => {
      expect(products.length).toBeGreaterThan(0);
      for (const product of products) {
        const defaults = getDefaultSelection(product);
        const result = validateOptionSelection(product, defaults);
        expect(result.ok, `Fallo en producto ${product.name} (${product.slug})`).toBe(true);
      }
    });
  });

  describe("Criterio 2: Single-select, multi-select, opcionales, límites y opción deshabilitada", () => {
    it("single select: permite elegir una sola opción y calcula el precio con delta", () => {
      const selection: SelectedOptions = { patty: ["triple"], extras: [] };
      const result = validateOptionSelection(burgerProduct, selection);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.unitPriceCents).toBe(780000n + 160000n);
        expect(result.value.normalizedSelections).toEqual({ patty: ["triple"], extras: [] });
      }
    });

    it("single select: rechaza seleccionar múltiples opciones", () => {
      const selection: SelectedOptions = { patty: ["double", "triple"], extras: [] };
      const result = validateOptionSelection(burgerProduct, selection);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((err) => err.code === "SINGLE_SELECT_MULTIPLE_CHOICES" || err.code === "EXCEEDS_MAX_SELECTIONS")).toBe(true);
      }
    });

    it("multi select: permite seleccionar hasta el límite máximo", () => {
      const selection: SelectedOptions = {
        patty: ["double"],
        extras: ["bacon", "cheddar", "egg"]
      };
      const result = validateOptionSelection(burgerProduct, selection);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.unitPriceCents).toBe(780000n + 90000n + 80000n + 60000n);
      }
    });

    it("multi select: rechaza superar el límite máximo permitido", () => {
      const selection: SelectedOptions = {
        patty: ["double"],
        extras: ["bacon", "cheddar", "egg", "extra-invalido"]
      };
      const result = validateOptionSelection(burgerProduct, selection);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((err) => err.code === "EXCEEDS_MAX_SELECTIONS")).toBe(true);
      }
    });

    it("opcionales: permite no seleccionar nada en grupos no requeridos", () => {
      const selection: SelectedOptions = { patty: ["double"] };
      const result = validateOptionSelection(burgerProduct, selection);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.normalizedSelections.extras).toEqual([]);
      }
    });

    it("requeridos: rechaza dejar vacío un grupo obligatorio", () => {
      const selection: SelectedOptions = { patty: [], extras: [] };
      const result = validateOptionSelection(burgerProduct, selection);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((err) => err.code === "REQUIRED_GROUP_EMPTY" || err.code === "BELOW_MIN_SELECTIONS")).toBe(true);
      }
    });

    it("opción deshabilitada: rechaza la selección de una opción sin stock o no disponible", () => {
      const selection: SelectedOptions = { patty: ["quad"], extras: [] };
      const result = validateOptionSelection(burgerProduct, selection);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((err) => err.code === "OPTION_UNAVAILABLE")).toBe(true);
      }
    });

    it("opción deshabilitada: toggleOption no permite seleccionar una opción no disponible", () => {
      const current: SelectedOptions = { patty: ["double"] };
      const updated = toggleOption(current, "patty", "quad", 1, false, "single", true);

      expect(updated).toEqual({ patty: ["double"] });
    });

    it("respeta selectionMode multiple con maxSelections 1: permite seleccionar, impide seleccionar una segunda y permite deseleccionar", () => {
      // 1. Permite seleccionar una opción
      const step1 = toggleOption({}, "extras", "bacon", 1, true, "multiple", false);
      expect(step1).toEqual({ extras: ["bacon"] });

      // 2. Impide seleccionar una segunda opción mientras ya hay una elegida
      const step2 = toggleOption(step1, "extras", "cheddar", 1, true, "multiple", false);
      expect(step2).toEqual({ extras: ["bacon"] });

      // 3. Permite deseleccionar la opción actual
      const step3 = toggleOption(step1, "extras", "bacon", 1, true, "multiple", false);
      expect(step3).toEqual({ extras: [] });
    });

    it("single opcional (required: false): permite seleccionar y deseleccionar la opción al volver a tocarla", () => {
      // Inicialmente vacío
      const empty: SelectedOptions = {};
      // Seleccionar opción
      const selected = toggleOption(empty, "sauce", "mayo", 1, true, "single", false);
      expect(selected).toEqual({ sauce: ["mayo"] });
      // Toggling nuevamente la misma opción limpia la selección a vacío
      const cleared = toggleOption(selected, "sauce", "mayo", 1, true, "single", false);
      expect(cleared).toEqual({ sauce: [] });
    });

    it("single requerido (required: true): no permite limpiar la opción seleccionada al volver a tocarla", () => {
      const selected: SelectedOptions = { patty: ["double"] };
      const attemptedClear = toggleOption(selected, "patty", "double", 1, true, "single", true);
      expect(attemptedClear).toEqual({ patty: ["double"] });
    });

    it("clearOptionGroup: limpia explícitamente cualquier selección del grupo", () => {
      const current: SelectedOptions = { sauce: ["mayo"], extras: ["bacon"] };
      expect(clearOptionGroup(current, "sauce")).toEqual({ sauce: [], extras: ["bacon"] });
    });

    it("un extra repetido cuenta y se cobra cada vez (doble bacon)", () => {
      const selection: SelectedOptions = { patty: ["double"], extras: ["bacon", "egg", "bacon"] };
      const result = validateOptionSelection(burgerProduct, selection);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.normalizedSelections.extras).toEqual(["bacon", "bacon", "egg"]);
        expect(result.value.unitPriceCents).toBe(burgerProduct.priceCents + 2n * 90000n + 60000n);
        expect(result.value.selectedDetails.filter((detail) => detail.optionId === "bacon")).toHaveLength(2);
      }
      expect(calculateConfiguredUnitPrice(burgerProduct, selection)).toBe(burgerProduct.priceCents + 2n * 90000n + 60000n);
    });

    it("rechaza repetir una opción de selección única o un extra más allá del tope", () => {
      for (const selection of [
        { patty: ["double", "double"] },
        { patty: ["double"], extras: Array.from({ length: MAX_SAME_EXTRA + 1 }, () => "bacon") }
      ] satisfies SelectedOptions[]) {
        const result = validateOptionSelection(burgerProduct, selection);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.some((err) => err.code === "DUPLICATE_SELECTION")).toBe(true);
      }
    });

    it("rechaza grupos inexistentes en el producto", () => {
      const selection: SelectedOptions = { patty: ["double"], grupoFantasma: ["opt1"] };
      const result = validateOptionSelection(burgerProduct, selection);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((err) => err.code === "UNKNOWN_GROUP")).toBe(true);
      }
    });
  });

  describe("Criterio 3: Bloqueo de publicación por defaults inválidos, deshabilitados o restricciones de datos", () => {
    it("un precio base igual a cero impide publicar el producto", () => {
      const zeroPriceProduct: Product = { ...burgerProduct, priceCents: 0n };
      const result = validateProductPublication(zeroPriceProduct);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((err) => err.code === "ZERO_OR_NEGATIVE_PRICE")).toBe(true);
      }
      expect(isPublishable(zeroPriceProduct)).toBe(false);
    });

    it("una descripción vacía o de solo whitespace impide publicar el producto", () => {
      const emptyDescProduct: Product = { ...burgerProduct, description: "" };
      const whitespaceDescProduct: Product = { ...burgerProduct, description: "   \n\t  " };

      const res1 = validateProductPublication(emptyDescProduct);
      expect(res1.ok).toBe(false);
      if (!res1.ok) {
        expect(res1.error.some((err) => err.code === "MISSING_DESCRIPTION")).toBe(true);
      }
      expect(isPublishable(emptyDescProduct)).toBe(false);

      const res2 = validateProductPublication(whitespaceDescProduct);
      expect(res2.ok).toBe(false);
      if (!res2.ok) {
        expect(res2.error.some((err) => err.code === "MISSING_DESCRIPTION")).toBe(true);
      }
      expect(isPublishable(whitespaceDescProduct)).toBe(false);
    });

    it("un default deshabilitado impide publicar el producto", () => {
      const productWithDisabledDefault: Product = {
        ...burgerProduct,
        optionGroups: [
          {
            ...sampleBurgerGroup,
            defaultOptionIds: ["quad"] // quad has available: false
          }
        ]
      };

      const result = validateProductPublication(productWithDisabledDefault);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((err) => err.code === "UNAVAILABLE_DEFAULT_OPTION")).toBe(true);
      }
      expect(isPublishable(productWithDisabledDefault)).toBe(false);
    });

    it("un default borrado o inexistente en las opciones impide publicar el producto", () => {
      const productWithMissingDefault: Product = {
        ...burgerProduct,
        optionGroups: [
          {
            ...sampleBurgerGroup,
            defaultOptionIds: ["opcion-borrada-uuid"]
          }
        ]
      };

      const result = validateProductPublication(productWithMissingDefault);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((err) => err.code === "MISSING_DEFAULT_OPTION")).toBe(true);
      }
      expect(isPublishable(productWithMissingDefault)).toBe(false);
    });

    it("la ausencia de default en un grupo requerido impide publicar", () => {
      const productWithoutDefault: Product = {
        ...burgerProduct,
        optionGroups: [
          {
            ...sampleBurgerGroup,
            defaultOptionIds: []
          }
        ]
      };

      const result = validateProductPublication(productWithoutDefault);
      expect(result.ok).toBe(false);
      expect(isPublishable(productWithoutDefault)).toBe(false);
    });

    it("defaults con duplicados impiden publicar", () => {
      const productWithDuplicates: Product = {
        ...burgerProduct,
        optionGroups: [
          {
            ...sampleExtrasGroup,
            defaultOptionIds: ["bacon", "bacon"]
          }
        ]
      };

      const result = validateProductPublication(productWithDuplicates);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((err) => err.code === "DEFAULT_DUPLICATES")).toBe(true);
      }
      expect(isPublishable(productWithDuplicates)).toBe(false);
    });
  });

  describe("Criterio 4: Bebidas no muestran opciones exclusivas de hamburguesas", () => {
    it("isGroupApplicableToProduct excluye opciones de medallón/hamburguesa en bebidas", () => {
      expect(isGroupApplicableToProduct(sampleBurgerGroup, beverageProduct)).toBe(false);
      expect(isGroupApplicableToProduct(sampleBurgerGroup, burgerProduct)).toBe(true);
    });

    it("getApplicableOptionGroups filtra grupos de hamburguesas si fueron asignados a una bebida", () => {
      const drinkWithBurgerGroup: Product = {
        ...beverageProduct,
        optionGroups: [sampleBurgerGroup, beverageProduct.optionGroups[0]!]
      };

      const applicable = getApplicableOptionGroups(drinkWithBurgerGroup);
      expect(applicable).toHaveLength(1);
      expect(applicable[0]?.id).toBe("ice");
      expect(applicable.some((g) => g.id === "patty")).toBe(false);
    });

    it("validateProductPublication rechaza una bebida con grupos exclusivos de hamburguesas", () => {
      const drinkWithBurgerGroup: Product = {
        ...beverageProduct,
        optionGroups: [sampleBurgerGroup]
      };

      const result = validateProductPublication(drinkWithBurgerGroup);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((err) => err.code === "INAPPLICABLE_OPTION_GROUP")).toBe(true);
      }
      expect(isPublishable(drinkWithBurgerGroup)).toBe(false);
    });

    it("validateOptionSelection rechaza la selección de opciones de hamburguesa en una bebida", () => {
      const drinkWithBurgerGroup: Product = {
        ...beverageProduct,
        optionGroups: [sampleBurgerGroup, beverageProduct.optionGroups[0]!]
      };

      const result = validateOptionSelection(drinkWithBurgerGroup, {
        patty: ["double"],
        ice: ["with-ice"]
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.some((err) => err.code === "INAPPLICABLE_GROUP")).toBe(true);
      }
    });
  });

  describe("Precio unitario derivado y cálculo", () => {
    it("calcula el precio base si no hay opciones adicionales con cargo", () => {
      expect(calculateConfiguredUnitPrice(burgerProduct, { patty: ["double"], extras: [] })).toBe(780000n);
    });

    it("suma correctamente los deltas de precio de opciones múltiples y simples", () => {
      expect(
        calculateConfiguredUnitPrice(burgerProduct, {
          patty: ["triple"], // +160000
          extras: ["bacon", "cheddar"] // +90000 + 80000
        })
      ).toBe(780000n + 160000n + 90000n + 80000n);
    });

    it("no permite precios negativos", () => {
      const freeProduct: Product = { ...burgerProduct, priceCents: 0n };
      expect(calculateConfiguredUnitPrice(freeProduct, {})).toBe(0n);
    });
  });
});
