import { describe, expect, it } from "vitest";
import {
  addCartLine,
  cartLineIdentity,
  changeCartLineQuantity,
  clearCart,
  editCartLine,
  normalizeNotes,
  normalizeOptions,
  parsePersistedCart,
  removeCartLine,
  revalidateCart,
  serializeCart,
  updateCartLineNotes,
  updateCartLineQuantity
} from "./cart";
import type { CartLine, Product } from "./types";

const line: CartLine = {
  id: "temporary",
  productId: "classic",
  productSlug: "bunker-clasica",
  productName: "Búnker Clásica",
  unitPriceCents: 980000n,
  quantity: 1,
  notes: " sin cebolla ",
  selectedOptions: { extras: ["bacon", "cheddar"], patty: ["double"] }
};

const sampleProduct: Product = {
  id: "classic",
  name: "Búnker Clásica",
  slug: "bunker-clasica",
  categoryId: "burgers",
  type: "burger",
  description: "Hamburguesa clásica con queso",
  priceCents: 980000n,
  imageUrl: null,
  published: true,
  featured: true,
  inStock: true,
  optionGroups: [
    {
      id: "patty",
      name: "Medallones",
      selectionMode: "single",
      required: true,
      minSelections: 1,
      maxSelections: 1,
      defaultOptionIds: ["double"],
      applicableTypes: ["burger"],
      options: [
        { id: "single", name: "Simple", priceDeltaCents: 0n, available: true },
        { id: "double", name: "Doble", priceDeltaCents: 0n, available: true }
      ]
    },
    {
      id: "extras",
      name: "Extras",
      selectionMode: "multiple",
      required: false,
      minSelections: 0,
      maxSelections: 3,
      defaultOptionIds: [],
      applicableTypes: ["burger"],
      options: [
        { id: "bacon", name: "Bacon", priceDeltaCents: 80000n, available: true },
        { id: "cheddar", name: "Cheddar", priceDeltaCents: 50000n, available: true }
      ]
    }
  ]
};

describe("cart - Normalización e Identidad", () => {
  it("normaliza notas recortando extremos y colapsando espacios internos", () => {
    expect(normalizeNotes("   ")).toBe("");
    expect(normalizeNotes("  sin   cebolla  ")).toBe("sin cebolla");
  });

  it("normaliza opciones descartando arrays vacíos y ordenando claves e ids", () => {
    const optsWithEmpty = { extras: [], patty: ["double"] };
    const optsWithoutEmpty = { patty: ["double"] };
    expect(normalizeOptions(optsWithEmpty)).toEqual(normalizeOptions(optsWithoutEmpty));
  });

  it("normaliza orden de opciones y notas para generar identidad determinística", () => {
    const reordered = {
      ...line,
      notes: "sin cebolla",
      selectedOptions: { patty: ["double"], extras: ["cheddar", "bacon"] }
    };
    expect(cartLineIdentity(line)).toBe(cartLineIdentity(reordered));
  });
});

describe("cart - Parseo Resiliente y Casos de Corrupción (TC-CORR)", () => {
  it("TC-CORR-01: retorna array vacío ante valores nulos, vacíos o espacios", () => {
    expect(parsePersistedCart(null)).toEqual([]);
    expect(parsePersistedCart("")).toEqual([]);
    expect(parsePersistedCart("   ")).toEqual([]);
  });

  it("TC-CORR-02: se recupera de forma segura ante JSON malformado", () => {
    expect(parsePersistedCart("not-json")).toEqual([]);
    expect(parsePersistedCart("{bad")).toEqual([]);
    expect(parsePersistedCart("{version: 1, lines: []")).toEqual([]);
    expect(parsePersistedCart("undefined")).toEqual([]);
    expect(parsePersistedCart('{"version":1,"lines":[]} extra')).toEqual([]);
  });

  const rawSerializedLine = {
    ...line,
    unitPriceCents: "980000"
  };

  it("TC-CORR-03: rechaza estructuras JSON sin versión", () => {
    expect(parsePersistedCart(JSON.stringify({ lines: [rawSerializedLine] }))).toEqual([]);
    expect(parsePersistedCart(JSON.stringify({ version: null, lines: [] }))).toEqual([]);
  });

  it("TC-CORR-04: rechaza versiones incompatibles (v0, v2, v99, string)", () => {
    expect(parsePersistedCart(JSON.stringify({ version: 0, lines: [rawSerializedLine] }))).toEqual([]);
    expect(parsePersistedCart(JSON.stringify({ version: 2, lines: [rawSerializedLine] }))).toEqual([]);
    expect(parsePersistedCart(JSON.stringify({ version: 99, lines: [] }))).toEqual([]);
    expect(parsePersistedCart(JSON.stringify({ version: "1", lines: [] }))).toEqual([]);
  });

  it("TC-CORR-05 & TC-CORR-06: descarta payloads donde lines no es array o contiene elementos primitivos", () => {
    expect(parsePersistedCart(JSON.stringify({ version: 1, lines: null }))).toEqual([]);
    expect(parsePersistedCart(JSON.stringify({ version: 1, lines: "invalido" }))).toEqual([]);
    expect(parsePersistedCart(JSON.stringify({ version: 1, lines: [null, 123, "texto", false] }))).toEqual([]);
  });

  it("TC-CORR-07: sanea cantidades anómalas (negativas, flotantes, NaN)", () => {
    const raw = JSON.stringify({
      version: 1,
      lines: [
        { ...line, quantity: -5, unitPriceCents: "980000" },
        { ...line, id: "line-2", quantity: 3.7, unitPriceCents: "980000" }
      ]
    });
    const parsed = parsePersistedCart(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]?.quantity).toBe(1);
    expect(parsed[1]?.quantity).toBe(3);
  });

  it("TC-CORR-08: descarta selectivamente líneas con unitPriceCents no numérico sin romper las válidas", () => {
    const mixed = JSON.stringify({
      version: 1,
      lines: [
        { ...line, id: "bad-price", unitPriceCents: "invalido" },
        { ...line, id: "good-price", unitPriceCents: "980000" }
      ]
    });
    const parsed = parsePersistedCart(mixed);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe("good-price");
  });

  it("TC-CORR-09: descarta líneas con selectedOptions corrupto (array o no objeto)", () => {
    const badOptions = JSON.stringify({
      version: 1,
      lines: [
        { ...line, selectedOptions: ["patty", "double"], unitPriceCents: "980000" }
      ]
    });
    expect(parsePersistedCart(badOptions)).toEqual([]);
  });

  it("TC-CORR-10: es inmune a polución de prototipos (__proto__)", () => {
    const payload = JSON.stringify({
      version: 1,
      lines: [
        {
          ...line,
          unitPriceCents: "980000",
          selectedOptions: {
            __proto__: ["evil"],
            patty: ["double"]
          }
        }
      ]
    });
    const parsed = parsePersistedCart(payload);
    expect(parsed).toHaveLength(1);
    expect(({} as Record<string, unknown>).evil).toBeUndefined();
  });
});

describe("cart - Persistencia y Round-trip (TC-PERS)", () => {
  it("TC-PERS-01: serializa y recupera líneas preservando precisión BigInt", () => {
    const serialized = serializeCart([line]);
    expect(serialized).toContain('"unitPriceCents":"980000"');
    const restored = parsePersistedCart(serialized);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.unitPriceCents).toBe(980000n);
    expect(typeof restored[0]?.unitPriceCents).toBe("bigint");
    expect(restored[0]?.notes).toBe("sin cebolla");
  });
});

describe("cart - Agregar y Combinar Líneas", () => {
  it("agrega líneas distintas y fusiona equivalentes sumando cantidades", () => {
    const first = addCartLine([], line);
    expect(first).toHaveLength(1);

    const second = addCartLine(first, { ...line, id: "another", quantity: 2 });
    expect(second).toHaveLength(1);
    expect(second[0]?.quantity).toBe(3);
    expect(second[0]?.unitPriceCents).toBe(980000n);
  });
});

describe("cart - Edición, Modificación y Vaciado", () => {
  it("TC-EDIT-01: editar notas preserva cantidad, opciones y precio", () => {
    const lines = [line];
    const updated = updateCartLineNotes(lines, line.id, "sin mayonesa");
    expect(updated).toHaveLength(1);
    expect(updated[0]?.notes).toBe("sin mayonesa");
    expect(updated[0]?.quantity).toBe(1);
    expect(updated[0]?.unitPriceCents).toBe(980000n);
    expect(updated[0]?.selectedOptions).toEqual(line.selectedOptions);
  });

  it("TC-EDIT-02: modificar cantidad preserva notas y opciones intactas", () => {
    const incremented = changeCartLineQuantity([line], line.id, 2);
    expect(incremented[0]?.quantity).toBe(3);
    expect(incremented[0]?.notes).toBe(line.notes);
    expect(incremented[0]?.selectedOptions).toEqual(line.selectedOptions);

    const decremented = changeCartLineQuantity(incremented, line.id, -1);
    expect(decremented[0]?.quantity).toBe(2);
    expect(decremented[0]?.notes).toBe(line.notes);
  });

  it("decrementa cantidad a cero o menos elimina la línea", () => {
    const single = [{ ...line, quantity: 1 }];
    const removed = changeCartLineQuantity(single, line.id, -1);
    expect(removed).toEqual([]);

    const setZero = updateCartLineQuantity(single, line.id, 0);
    expect(setZero).toEqual([]);
  });

  it("TC-EDIT-04: editar notas o opciones fusiona líneas si colisiona con otra idéntica", () => {
    const lineA: CartLine = { ...line, id: "line-a", notes: "sin cebolla", quantity: 1 };
    const lineB: CartLine = { ...line, id: "line-b", notes: "con cebolla", quantity: 2 };
    const lines = [lineA, lineB];

    // Al editar lineB para que también tenga notas "sin cebolla", deben fusionarse: 1 + 2 = 3
    const merged = updateCartLineNotes(lines, "line-b", "sin cebolla");
    expect(merged).toHaveLength(1);
    expect(merged[0]?.quantity).toBe(3);
    expect(merged[0]?.notes).toBe("sin cebolla");
  });

  it("editCartLine actualiza configuración in-place sin colisión", () => {
    const updated = editCartLine([line], line.id, {
      selectedOptions: { patty: ["single"] },
      unitPriceCents: 900000n,
      notes: "extra tostado",
      quantity: 4
    });
    expect(updated).toHaveLength(1);
    expect(updated[0]?.quantity).toBe(4);
    expect(updated[0]?.notes).toBe("extra tostado");
    expect(updated[0]?.unitPriceCents).toBe(900000n);
    expect(updated[0]?.selectedOptions).toEqual({ patty: ["single"] });
  });

  it("removeCartLine y clearCart eliminan líneas explícitamente", () => {
    expect(removeCartLine([line], line.id)).toEqual([]);
    expect(clearCart()).toEqual([]);
  });
});

describe("cart - Revalidación contra Catálogo (TC-REVAL)", () => {
  it("TC-REVAL-01: detecta producto agotado (inStock: false), lo retira y marca bloqueo", () => {
    const outOfStockProduct = { ...sampleProduct, inStock: false };
    const result = revalidateCart([line], [outOfStockProduct]);

    expect(result.validLines).toHaveLength(0);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe("out_of_stock");
    expect(result.hasBlockingIssues).toBe(true);
    expect(result.hasChanges).toBe(true);
  });

  it("detecta producto despublicado o eliminado, lo retira y marca bloqueo", () => {
    const unpublished = { ...sampleProduct, published: false };
    const result = revalidateCart([line], [unpublished]);

    expect(result.validLines).toHaveLength(0);
    expect(result.issues[0]?.code).toBe("product_removed");
    expect(result.hasBlockingIssues).toBe(true);
  });

  it("TC-REVAL-02: poda opción opcional agotada, recalcula precio unitario y emite aviso", () => {
    // Extras bacon queda agotado
    const baconDisabledProduct: Product = {
      ...sampleProduct,
      optionGroups: sampleProduct.optionGroups.map((group) =>
        group.id === "extras"
          ? {
              ...group,
              options: group.options.map((opt) =>
                opt.id === "bacon" ? { ...opt, available: false } : opt
              )
            }
          : group
      )
    };

    // Bacon costaba 80.000 centavos ($800) y cheddar 50.000 ($500), precio base 980.000 ($9.800)
    // Sin bacon, el nuevo precio es 980.000 + 50.000 = 1.030.000 ($10.300)
    const result = revalidateCart([line], [baconDisabledProduct]);

    expect(result.validLines).toHaveLength(1);
    expect(result.validLines[0]?.selectedOptions).toEqual({
      extras: ["cheddar"],
      patty: ["double"]
    });
    expect(result.validLines[0]?.unitPriceCents).toBe(1030000n);
    expect(result.issues.some((i) => i.code === "option_unavailable")).toBe(true);
    expect(result.hasBlockingIssues).toBe(false);
    expect(result.hasChanges).toBe(true);
  });

  it("detecta opción requerida agotada, no puede auto-repararse y retira la línea con bloqueo", () => {
    // Patty double queda agotado, pero patty es grupo requerido
    const pattyDisabledProduct: Product = {
      ...sampleProduct,
      optionGroups: sampleProduct.optionGroups.map((group) =>
        group.id === "patty"
          ? {
              ...group,
              options: group.options.map((opt) =>
                opt.id === "double" ? { ...opt, available: false } : opt
              )
            }
          : group
      )
    };

    const result = revalidateCart([line], [pattyDisabledProduct]);
    expect(result.validLines).toHaveLength(0);
    expect(result.issues.some((i) => i.code === "option_invalid")).toBe(true);
    expect(result.hasBlockingIssues).toBe(true);
  });

  it("TC-REVAL-03: detecta cambio de precio en catálogo y actualiza el precio unitario autoritativamente", () => {
    // Precio base sube de 980.000 a 1.050.000
    const priceChangedProduct: Product = {
      ...sampleProduct,
      priceCents: 1050000n
    };

    const result = revalidateCart([line], [priceChangedProduct]);

    expect(result.validLines).toHaveLength(1);
    // 1.050.000 + 80.000 (bacon) + 50.000 (cheddar) = 1.180.000
    expect(result.validLines[0]?.unitPriceCents).toBe(1180000n);
    expect(result.issues.some((i) => i.code === "price_changed")).toBe(true);
    expect(result.hasBlockingIssues).toBe(false);
    expect(result.hasChanges).toBe(true);
  });

  it("TC-REVAL-05: maneja carrito parcialmente inválido (línea válida + línea agotada)", () => {
    const validProduct = sampleProduct;
    const friesProduct: Product = {
      id: "fries-rustic",
      name: "Papas Rústicas",
      slug: "papas-rusticas",
      categoryId: "sides",
      type: "fries",
      description: "Papas rústicas",
      priceCents: 450000n,
      imageUrl: null,
      published: true,
      featured: false,
      inStock: false, // Agotadas
      optionGroups: []
    };

    const friesLine: CartLine = {
      id: "fries-line",
      productId: "fries-rustic",
      productSlug: "papas-rusticas",
      productName: "Papas Rústicas",
      unitPriceCents: 450000n,
      quantity: 1,
      notes: "",
      selectedOptions: {}
    };

    const result = revalidateCart([line, friesLine], [validProduct, friesProduct]);
    expect(result.validLines).toHaveLength(1);
    expect(result.validLines[0]?.productId).toBe("classic");
    expect(result.issues.some((i) => i.productId === "fries-rustic" && i.code === "out_of_stock")).toBe(true);
  });

  it("TC-REVAL-06: carrito con 0 líneas válidas reporta bloqueo de checkout", () => {
    const outOfStock = { ...sampleProduct, inStock: false };
    const result = revalidateCart([line], [outOfStock]);
    expect(result.validLines).toHaveLength(0);
    expect(result.hasBlockingIssues).toBe(true);
  });
});
