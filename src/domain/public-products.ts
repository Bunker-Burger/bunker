import type { OptionSelectionMode, Product, ProductType } from "./types";

interface RawOptionJson {
  id?: unknown;
  name?: unknown;
  priceDeltaCents?: unknown;
  available?: unknown;
}

interface RawOptionGroupJson {
  id?: unknown;
  name?: unknown;
  selectionMode?: unknown;
  required?: unknown;
  minSelections?: unknown;
  maxSelections?: unknown;
  defaultOptionIds?: unknown;
  applicableTypes?: unknown;
  options?: unknown;
}

interface RawProductJson {
  id?: unknown;
  name?: unknown;
  slug?: unknown;
  categoryId?: unknown;
  type?: unknown;
  description?: unknown;
  priceCents?: unknown;
  imageUrl?: unknown;
  imageAlt?: unknown;
  published?: unknown;
  featured?: unknown;
  inStock?: unknown;
  containsAlcohol?: unknown;
  optionGroups?: unknown;
}

/**
 * Parses and deserializes the JSON payload received from GET /api/store/products into strongly-typed Products.
 * Converts price string fields (priceCents, priceDeltaCents) back into BigInt.
 */
export function parsePublicProducts(payload: unknown): Product[] | null {
  if (!payload || typeof payload !== "object" || !("products" in payload)) return null;
  const list = (payload as { products: unknown }).products;
  if (!Array.isArray(list)) return null;

  try {
    return list.map((rawItem: unknown): Product => {
      const raw = rawItem as RawProductJson;
      if (
        !raw ||
        typeof raw !== "object" ||
        typeof raw.id !== "string" ||
        typeof raw.name !== "string" ||
        typeof raw.slug !== "string" ||
        typeof raw.priceCents !== "string" ||
        !/^\d+$/.test(raw.priceCents)
      ) {
        throw new Error("Invalid product row structure");
      }

      return {
        id: String(raw.id),
        name: String(raw.name),
        slug: String(raw.slug),
        categoryId: String(raw.categoryId ?? ""),
        type: (raw.type ?? "other") as ProductType,
        description: String(raw.description ?? ""),
        priceCents: BigInt(raw.priceCents),
        imageUrl: raw.imageUrl ? String(raw.imageUrl) : null,
        ...(raw.imageAlt ? { imageAlt: String(raw.imageAlt) } : {}),
        published: Boolean(raw.published),
        featured: Boolean(raw.featured),
        inStock: Boolean(raw.inStock),
        ...(raw.containsAlcohol !== undefined ? { containsAlcohol: Boolean(raw.containsAlcohol) } : {}),
        optionGroups: Array.isArray(raw.optionGroups)
          ? (raw.optionGroups as RawOptionGroupJson[]).map((g) => ({
              id: String(g.id),
              name: String(g.name),
              selectionMode: (g.selectionMode ?? "single") as OptionSelectionMode,
              required: Boolean(g.required),
              minSelections: Number(g.minSelections ?? 0),
              maxSelections: Number(g.maxSelections ?? 1),
              defaultOptionIds: Array.isArray(g.defaultOptionIds) ? g.defaultOptionIds.map(String) : [],
              applicableTypes: Array.isArray(g.applicableTypes) ? (g.applicableTypes as ProductType[]) : [],
              options: Array.isArray(g.options)
                ? (g.options as RawOptionJson[]).map((o) => {
                    if (typeof o.priceDeltaCents !== "string" || !/^\d+$/.test(o.priceDeltaCents)) {
                      throw new Error("Invalid option priceDeltaCents");
                    }
                    return {
                      id: String(o.id),
                      name: String(o.name),
                      priceDeltaCents: BigInt(o.priceDeltaCents),
                      available: Boolean(o.available)
                    };
                  })
                : []
            }))
          : []
      };
    });
  } catch {
    return null;
  }
}
