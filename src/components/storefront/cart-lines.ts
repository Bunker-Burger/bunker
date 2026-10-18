import { calculateConfiguredUnitPrice } from "@/domain/catalog";
import { type PromotionLine } from "@/domain/promotions";
import type { CartLine, Product, SelectedOptions } from "@/domain/types";

export function makeCartLine(product: Product, selectedOptions: SelectedOptions, quantity: number, notes: string, comboId?: string): CartLine {
  return {
    ...(comboId ? { comboId } : {}),
    id: product.id,
    productId: product.id,
    productSlug: product.slug,
    productName: product.name,
    unitPriceCents: calculateConfiguredUnitPrice(product, selectedOptions),
    quantity,
    notes,
    selectedOptions
  };
}

/** Cart lines as the promotion engine reads them; base prices come from the catalog, not the cart. */
export function toPromotionLines(cart: CartLine[], catalogProducts: readonly Product[]): PromotionLine[] {
  return cart.map((line) => {
    const basePriceCents = catalogProducts.find((product) => product.id === line.productId)?.priceCents ?? line.unitPriceCents;
    return {
      productId: line.productId,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      basePriceCents: basePriceCents > line.unitPriceCents ? line.unitPriceCents : basePriceCents,
      ...(line.comboId ? { comboId: line.comboId } : {})
    };
  });
}
