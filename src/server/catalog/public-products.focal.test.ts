import { describe, expect, it } from "vitest";
import { parsePublicProducts } from "@/domain/public-products";
import type { Product } from "@/domain/types";
import { serializePublicProducts } from "./public-products";

const product: Product = {
  id: "p1",
  slug: "smash",
  name: "Smash",
  type: "burger",
  categoryId: "c1",
  description: "Doble.",
  priceCents: 780000n,
  imageUrl: "https://x.supabase.co/storage/v1/object/public/catalog/s/a.webp",
  imageAlt: "Smash doble",
  imageFocalPoint: { x: 25, y: 75 },
  sortOrder: 10,
  published: true,
  featured: false,
  inStock: true,
  optionGroups: []
};

describe("focal point through GET /api/store/products (BB-12)", () => {
  it("reaches the storefront unchanged", () => {
    const [parsed] = parsePublicProducts(JSON.parse(JSON.stringify({ products: serializePublicProducts([product]) }))) ?? [];
    expect(parsed).toMatchObject({ imageUrl: product.imageUrl, imageAlt: "Smash doble", imageFocalPoint: { x: 25, y: 75 } });
  });

  it("is omitted for a product without a photo", () => {
    const withoutPhoto: Product = { ...product, imageUrl: null };
    delete withoutPhoto.imageFocalPoint;
    const [serialized] = serializePublicProducts([withoutPhoto]);
    expect(serialized).not.toHaveProperty("imageFocalPoint");
  });
});
