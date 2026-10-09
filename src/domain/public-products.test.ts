import { describe, expect, it } from "vitest";
import { parsePublicCatalog, parsePublicProducts } from "./public-products";

const VALID_SAMPLE_PAYLOAD = {
  products: [
    {
      id: "prod-001",
      name: "Hamburguesa Búnker",
      slug: "hamburguesa-bunker",
      categoryId: "cat-burgers",
      type: "burger",
      description: "Doble carne con queso",
      priceCents: "780000",
      imageUrl: null,
      published: true,
      featured: true,
      inStock: true,
      containsAlcohol: false,
      optionGroups: [
        {
          id: "grp-patty",
          name: "Medallón",
          selectionMode: "single",
          required: true,
          minSelections: 1,
          maxSelections: 1,
          defaultOptionIds: ["opt-patty-1"],
          applicableTypes: ["burger"],
          options: [
            {
              id: "opt-patty-1",
              name: "Carne vacuna",
              priceDeltaCents: "0",
              available: true
            }
          ]
        }
      ]
    }
  ]
};

describe("parsePublicProducts strict DTO validation (P1 A)", () => {
  it("deserializa exitosamente un payload completo y válido", () => {
    const result = parsePublicProducts(VALID_SAMPLE_PAYLOAD);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(1);

    const product = result![0]!;
    expect(product.id).toBe("prod-001");
    expect(product.name).toBe("Hamburguesa Búnker");
    expect(product.priceCents).toBe(780000n);
    expect(product.published).toBe(true);
    expect(product.inStock).toBe(true);
    expect(product.optionGroups).toHaveLength(1);

    const group = product.optionGroups[0]!;
    expect(group.id).toBe("grp-patty");
    expect(group.required).toBe(true);
    expect(group.selectionMode).toBe("single");
    expect(group.options[0]?.priceDeltaCents).toBe(0n);
    expect(group.options[0]?.available).toBe(true);
  });

  it("rechaza payload parcial que carece de booleans requeridos (published, inStock, optionGroups)", () => {
    // Escenario crítico P1 A: payload parcial que antes defaulteaba published/inStock a false
    const partialPayload = {
      products: [
        {
          id: "ID_REAL",
          name: "Hamburguesa",
          slug: "hamburguesa",
          priceCents: "780000"
        }
      ]
    };

    const result = parsePublicProducts(partialPayload);
    expect(result).toBeNull();
  });

  it("rechaza payload donde published o inStock no son estrictamente booleanos", () => {
    const invalidPublished = JSON.parse(JSON.stringify(VALID_SAMPLE_PAYLOAD));
    delete invalidPublished.products[0].published;
    expect(parsePublicProducts(invalidPublished)).toBeNull();

    const stringPublished = JSON.parse(JSON.stringify(VALID_SAMPLE_PAYLOAD));
    stringPublished.products[0].published = "true";
    expect(parsePublicProducts(stringPublished)).toBeNull();

    const missingInStock = JSON.parse(JSON.stringify(VALID_SAMPLE_PAYLOAD));
    delete missingInStock.products[0].inStock;
    expect(parsePublicProducts(missingInStock)).toBeNull();
  });

  it("rechaza payload con optionGroups ausente, nulo o no array", () => {
    const nullGroups = JSON.parse(JSON.stringify(VALID_SAMPLE_PAYLOAD));
    nullGroups.products[0].optionGroups = null;
    expect(parsePublicProducts(nullGroups)).toBeNull();

    const missingGroups = JSON.parse(JSON.stringify(VALID_SAMPLE_PAYLOAD));
    delete missingGroups.products[0].optionGroups;
    expect(parsePublicProducts(missingGroups)).toBeNull();
  });

  it("rechaza grupo de opciones con campos malformados o faltantes", () => {
    // selectionMode inválido
    const invalidMode = JSON.parse(JSON.stringify(VALID_SAMPLE_PAYLOAD));
    invalidMode.products[0].optionGroups[0].selectionMode = "invalid_mode";
    expect(parsePublicProducts(invalidMode)).toBeNull();

    // required ausente
    const missingRequired = JSON.parse(JSON.stringify(VALID_SAMPLE_PAYLOAD));
    delete missingRequired.products[0].optionGroups[0].required;
    expect(parsePublicProducts(missingRequired)).toBeNull();

    // min/max inválidos (maxSelections menor a minSelections)
    const invalidCardinality = JSON.parse(JSON.stringify(VALID_SAMPLE_PAYLOAD));
    invalidCardinality.products[0].optionGroups[0].minSelections = 2;
    invalidCardinality.products[0].optionGroups[0].maxSelections = 1;
    expect(parsePublicProducts(invalidCardinality)).toBeNull();

    // applicableTypes con tipo desconocido
    const invalidType = JSON.parse(JSON.stringify(VALID_SAMPLE_PAYLOAD));
    invalidType.products[0].optionGroups[0].applicableTypes = ["unknown_kind"];
    expect(parsePublicProducts(invalidType)).toBeNull();
  });

  it("rechaza opciones con precio o disponibilidad no conformes", () => {
    // available no booleano
    const missingAvailable = JSON.parse(JSON.stringify(VALID_SAMPLE_PAYLOAD));
    delete missingAvailable.products[0].optionGroups[0].options[0].available;
    expect(parsePublicProducts(missingAvailable)).toBeNull();

    // priceDeltaCents no numérico
    const nonDigitDelta = JSON.parse(JSON.stringify(VALID_SAMPLE_PAYLOAD));
    nonDigitDelta.products[0].optionGroups[0].options[0].priceDeltaCents = "free";
    expect(parsePublicProducts(nonDigitDelta)).toBeNull();
  });

  it("rechaza payloads de raíz no válidos (null, undefined, string, array directo)", () => {
    expect(parsePublicProducts(null)).toBeNull();
    expect(parsePublicProducts(undefined)).toBeNull();
    expect(parsePublicProducts("not-json")).toBeNull();
    expect(parsePublicProducts([])).toBeNull();
    expect(parsePublicProducts({})).toBeNull();
    expect(parsePublicProducts({ products: "not-an-array" })).toBeNull();
  });
});

describe("parsePublicCatalog: productos y categorías de una misma lectura", () => {
  const category = { id: "cat-burgers", slug: "hamburguesas", name: "Hamburguesas", type: "burger", sortOrder: 10, visible: true };

  it("acepta productos y categorías válidos", () => {
    const parsed = parsePublicCatalog({ ...VALID_SAMPLE_PAYLOAD, categories: [category] });
    expect(parsed?.products).toHaveLength(1);
    expect(parsed?.categories).toEqual([category]);
  });

  it("acepta una carta vacía verificada: listas vacías no son un error", () => {
    expect(parsePublicCatalog({ products: [], categories: [] })).toEqual({ products: [], categories: [] });
  });

  it("rechaza el payload si faltan las categorías o no son una lista", () => {
    expect(parsePublicCatalog({ products: [] })).toBeNull();
    expect(parsePublicCatalog({ products: [], categories: null })).toBeNull();
    expect(parsePublicCatalog({ products: [], categories: {} })).toBeNull();
    expect(parsePublicCatalog({ categories: [] })).toBeNull();
  });

  it.each([
    ["sin id", { ...category, id: "" }],
    ["sin slug", { ...category, slug: undefined }],
    ["nombre vacío", { ...category, name: "  " }],
    ["tipo desconocido", { ...category, type: "pizza" }],
    ["sortOrder no entero", { ...category, sortOrder: 1.5 }],
    ["sortOrder como texto", { ...category, sortOrder: "10" }],
    ["visible no booleano", { ...category, visible: "true" }]
  ])("rechaza todo el snapshot ante una categoría inválida (%s)", (_case, broken) => {
    expect(parsePublicCatalog({ ...VALID_SAMPLE_PAYLOAD, categories: [category, broken] })).toBeNull();
  });

  it("rechaza categorías con id repetido", () => {
    expect(parsePublicCatalog({ products: [], categories: [category, { ...category, name: "Otra" }] })).toBeNull();
  });

  it("un producto inválido invalida el snapshot aunque las categorías sean válidas", () => {
    const broken = { products: [{ ...VALID_SAMPLE_PAYLOAD.products[0], published: "yes" }], categories: [category] };
    expect(parsePublicCatalog(broken)).toBeNull();
  });
});
