import type { Category, Product } from "@/domain/types";
import { formatArs } from "@/lib/money";
import type { AdminOptionGroup } from "@/server/catalog-admin";
import { tabForType } from "./form-state";
import type { ProductFormCategory, ProductFormOptionGroup, ProductFormValues } from "./product-form";

/* Plain, serializable props for the client editor (no bigint, no domain classes). */

export function formCategories(categories: Category[]): ProductFormCategory[] {
  return categories.flatMap((category) => {
    const tab = tabForType(category.type);
    return tab ? [{ id: category.id, name: category.name, type: category.type, tabLabel: tab.label }] : [];
  });
}

export function formOptionGroups(groups: AdminOptionGroup[]): ProductFormOptionGroup[] {
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    selectionMode: group.selectionMode,
    required: group.required,
    minSelections: group.minSelections,
    maxSelections: group.maxSelections,
    applicableTypes: [...group.applicableTypes],
    options: group.options.map((option) => ({
      id: option.id,
      name: option.name,
      priceDelta: option.priceDeltaCents > 0n ? formatArs(option.priceDeltaCents) : null,
      available: option.available
    }))
  }));
}

/** 780000 cents → "7800"; 780050 → "7800.5". */
export function pesos(cents: bigint) {
  const whole = cents / 100n;
  const fraction = cents % 100n;
  return fraction === 0n ? whole.toString() : `${whole}.${fraction.toString().padStart(2, "0").replace(/0$/, "")}`;
}

export function formValues(product: Product): ProductFormValues {
  return {
    id: product.id,
    categoryId: product.categoryId,
    name: product.name,
    slug: product.slug,
    description: product.description,
    price: pesos(product.priceCents),
    inStock: product.inStock,
    featured: product.featured,
    published: product.published,
    optionGroups: product.optionGroups.map((group) => ({ groupId: group.id, defaultOptionIds: [...group.defaultOptionIds] }))
  };
}
