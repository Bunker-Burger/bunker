import type { Catalog, Product } from "@/domain/types";
import type { Result } from "@/lib/result";
import type { CatalogError } from "./errors";

export interface SerializedPublicOption {
  id: string;
  name: string;
  priceDeltaCents: string;
  available: boolean;
}

export interface SerializedPublicOptionGroup {
  id: string;
  name: string;
  selectionMode: "single" | "multiple";
  required: boolean;
  minSelections: number;
  maxSelections: number;
  defaultOptionIds: string[];
  options: SerializedPublicOption[];
  applicableTypes: string[];
}

export interface SerializedPublicProduct {
  id: string;
  name: string;
  slug: string;
  categoryId: string;
  type: string;
  description: string;
  priceCents: string;
  imageUrl: string | null;
  imageAlt?: string | null | undefined;
  published: boolean;
  featured: boolean;
  inStock: boolean;
  containsAlcohol?: boolean | undefined;
  optionGroups: SerializedPublicOptionGroup[];
}

export function serializePublicProducts(products: readonly Product[]): SerializedPublicProduct[] {
  return products.map((product) => ({
    id: product.id,
    name: product.name,
    slug: product.slug,
    categoryId: product.categoryId,
    type: product.type,
    description: product.description,
    priceCents: product.priceCents.toString(),
    imageUrl: product.imageUrl,
    ...(product.imageAlt !== undefined ? { imageAlt: product.imageAlt } : {}),
    published: product.published,
    featured: product.featured,
    inStock: product.inStock,
    ...(product.containsAlcohol !== undefined ? { containsAlcohol: product.containsAlcohol } : {}),
    optionGroups: product.optionGroups.map((group) => ({
      id: group.id,
      name: group.name,
      selectionMode: group.selectionMode,
      required: group.required,
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      defaultOptionIds: [...group.defaultOptionIds],
      applicableTypes: [...group.applicableTypes],
      options: group.options.map((option) => ({
        id: option.id,
        name: option.name,
        priceDeltaCents: option.priceDeltaCents.toString(),
        available: option.available
      }))
    }))
  }));
}

/**
 * HTTP response for GET /api/store/products.
 * Never cached (Cache-Control: no-store), returning the fresh customer-facing products with options.
 */
export function publicProductsResponse(catalogResult: Result<Catalog, CatalogError>): Response {
  const headers = { "Cache-Control": "no-store" };
  if (!catalogResult.ok) {
    const status = catalogResult.error.code === "not_found" ? 404 : 503;
    return Response.json({ error: catalogResult.error.code }, { status, headers });
  }
  return Response.json(
    { products: serializePublicProducts(catalogResult.value.products) },
    { headers }
  );
}
