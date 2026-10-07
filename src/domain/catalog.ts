import type { Product, SelectedOptions } from "./types";

export function getDefaultSelection(product: Product): SelectedOptions {
  return Object.fromEntries(
    product.optionGroups.map((group) => [group.id, [...group.defaultOptionIds].sort()])
  );
}

export function isPublishable(product: Product): boolean {
  if (product.type === "beverage" && product.containsAlcohol) return false;
  if (product.priceCents < 0n || !product.name.trim() || !product.slug.trim()) return false;

  return product.optionGroups.every((group) => {
    const availableIds = new Set(group.options.filter((option) => option.available).map((option) => option.id));
    const defaultsAreAvailable = group.defaultOptionIds.every((id) => availableIds.has(id));
    const count = group.defaultOptionIds.length;
    const minimum = group.required ? Math.max(1, group.minSelections) : group.minSelections;
    return defaultsAreAvailable && count >= minimum && count <= group.maxSelections;
  });
}

export function calculateConfiguredUnitPrice(product: Product, selected: SelectedOptions): bigint {
  return product.optionGroups.reduce((total, group) => {
    const selectedIds = new Set(selected[group.id] ?? []);
    return total + group.options.reduce(
      (groupTotal, option) => groupTotal + (selectedIds.has(option.id) ? option.priceDeltaCents : 0n),
      0n
    );
  }, product.priceCents);
}

