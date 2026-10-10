import type { Category, OptionGroup, OptionSelectionMode, Product, ProductOption, ProductType, PublicCatalogSnapshot } from "./types";

const VALID_PRODUCT_TYPES = new Set<ProductType>(["burger", "sandwich", "fries", "beverage", "other"]);
const VALID_SELECTION_MODES = new Set<OptionSelectionMode>(["single", "multiple"]);

function isNonEmptyString(val: unknown): val is string {
  return typeof val === "string" && val.trim().length > 0;
}

function isDigitString(val: unknown): val is string {
  return typeof val === "string" && /^\d+$/.test(val);
}

function isNonNegativeInteger(val: unknown): val is number {
  return typeof val === "number" && Number.isInteger(val) && val >= 0;
}

function parseOption(raw: unknown): ProductOption | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (!isNonEmptyString(o.id)) return null;
  if (!isNonEmptyString(o.name)) return null;
  if (!isDigitString(o.priceDeltaCents)) return null;
  if (typeof o.available !== "boolean") return null;

  return {
    id: o.id,
    name: o.name,
    priceDeltaCents: BigInt(o.priceDeltaCents),
    available: o.available
  };
}

function parseOptionGroup(raw: unknown): OptionGroup | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  if (!isNonEmptyString(g.id)) return null;
  if (!isNonEmptyString(g.name)) return null;
  if (typeof g.selectionMode !== "string" || !VALID_SELECTION_MODES.has(g.selectionMode as OptionSelectionMode)) {
    return null;
  }
  if (typeof g.required !== "boolean") return null;
  if (!isNonNegativeInteger(g.minSelections)) return null;
  if (!isNonNegativeInteger(g.maxSelections) || g.maxSelections < g.minSelections) return null;
  if (!Array.isArray(g.defaultOptionIds) || !g.defaultOptionIds.every((id) => typeof id === "string")) {
    return null;
  }
  if (
    !Array.isArray(g.applicableTypes) ||
    !g.applicableTypes.every((t) => typeof t === "string" && VALID_PRODUCT_TYPES.has(t as ProductType))
  ) {
    return null;
  }
  if (!Array.isArray(g.options)) return null;

  const parsedOptions: ProductOption[] = [];
  for (const rawOpt of g.options) {
    const opt = parseOption(rawOpt);
    if (!opt) return null;
    parsedOptions.push(opt);
  }

  return {
    id: g.id,
    name: g.name,
    selectionMode: g.selectionMode as OptionSelectionMode,
    required: g.required,
    minSelections: g.minSelections,
    maxSelections: g.maxSelections,
    defaultOptionIds: g.defaultOptionIds,
    applicableTypes: g.applicableTypes as ProductType[],
    options: parsedOptions
  };
}

const isPercent = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;

/** A malformed focal point only loses the crop hint (the photo stays centred), never the product. */
function parseFocalPoint(raw: unknown): { x: number; y: number } | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { x, y } = raw as Record<string, unknown>;
  return isPercent(x) && isPercent(y) ? { x, y } : undefined;
}

function parseProduct(raw: unknown): Product | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (!isNonEmptyString(p.id)) return null;
  if (!isNonEmptyString(p.name)) return null;
  if (!isNonEmptyString(p.slug)) return null;
  if (!isNonEmptyString(p.categoryId)) return null;
  if (typeof p.type !== "string" || !VALID_PRODUCT_TYPES.has(p.type as ProductType)) return null;
  if (typeof p.description !== "string") return null;
  if (!isDigitString(p.priceCents)) return null;
  if (p.imageUrl !== null && typeof p.imageUrl !== "string") return null;
  if (p.imageAlt !== undefined && typeof p.imageAlt !== "string") return null;
  if (typeof p.published !== "boolean") return null;
  if (typeof p.featured !== "boolean") return null;
  if (typeof p.inStock !== "boolean") return null;
  if (p.containsAlcohol !== undefined && typeof p.containsAlcohol !== "boolean") return null;
  if (!Array.isArray(p.optionGroups)) return null;

  const focalPoint = parseFocalPoint(p.imageFocalPoint);
  const parsedGroups: OptionGroup[] = [];
  for (const rawGroup of p.optionGroups) {
    const grp = parseOptionGroup(rawGroup);
    if (!grp) return null;
    parsedGroups.push(grp);
  }

  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    categoryId: p.categoryId,
    type: p.type as ProductType,
    description: p.description,
    priceCents: BigInt(p.priceCents),
    imageUrl: p.imageUrl,
    ...(p.imageAlt !== undefined ? { imageAlt: p.imageAlt } : {}),
    ...(focalPoint ? { imageFocalPoint: focalPoint } : {}),
    published: p.published,
    featured: p.featured,
    inStock: p.inStock,
    ...(p.containsAlcohol !== undefined ? { containsAlcohol: p.containsAlcohol } : {}),
    optionGroups: parsedGroups
  };
}

/**
 * Parses and deserializes the JSON payload received from GET /api/store/products into strongly-typed Products.
 * Rejects any incomplete, partial, or malformed server DTO by returning null.
 * Never invents default values (Boolean(undefined)/String(undefined)) for contractual server fields.
 */
export function parsePublicProducts(payload: unknown): Product[] | null {
  if (!payload || typeof payload !== "object" || !("products" in payload)) return null;
  const list = (payload as { products: unknown }).products;
  if (!Array.isArray(list)) return null;

  const products: Product[] = [];
  for (const rawItem of list) {
    const product = parseProduct(rawItem);
    if (!product) return null;
    products.push(product);
  }

  return products;
}

function isInteger(val: unknown): val is number {
  return typeof val === "number" && Number.isInteger(val);
}

function parseCategory(raw: unknown): Category | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (!isNonEmptyString(c.id)) return null;
  if (!isNonEmptyString(c.slug)) return null;
  if (!isNonEmptyString(c.name)) return null;
  if (typeof c.type !== "string" || !VALID_PRODUCT_TYPES.has(c.type as ProductType)) return null;
  if (!isInteger(c.sortOrder)) return null;
  if (typeof c.visible !== "boolean") return null;
  return { id: c.id, slug: c.slug, name: c.name, type: c.type as ProductType, sortOrder: c.sortOrder, visible: c.visible };
}

/**
 * Parses GET /api/store/products: products and categories of one server read. Both lists are
 * required; empty lists are a valid, verified empty menu. Anything malformed rejects the whole
 * snapshot (null), so a broken answer is never taken for an empty menu.
 */
export function parsePublicCatalog(payload: unknown): PublicCatalogSnapshot | null {
  if (!payload || typeof payload !== "object" || !("categories" in payload)) return null;
  const products = parsePublicProducts(payload);
  if (!products) return null;
  const list = (payload as { categories: unknown }).categories;
  if (!Array.isArray(list)) return null;

  const categories: Category[] = [];
  const ids = new Set<string>();
  for (const rawItem of list) {
    const category = parseCategory(rawItem);
    if (!category || ids.has(category.id)) return null;
    ids.add(category.id);
    categories.push(category);
  }
  return { products, categories };
}
