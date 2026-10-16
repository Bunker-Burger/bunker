import type { Category, Product, ProductType } from "@/domain/types";

/** A section of the public menu, in the order the store configured. */
export interface MenuCategory {
  id: string;
  name: string;
  type: ProductType;
}

export interface MenuSectionView {
  id: string;
  title: string;
  eyebrow: string;
  /** "Las más pedidas": large cards, as in the canonical Stitch menu. */
  featured: boolean;
  products: Product[];
}

/** "all" stacks every section; otherwise only the featured section or one category. */
export type MenuFilter = "all" | typeof FEATURED_SECTION_ID | string;

export const FEATURED_SECTION_ID = "destacadas";
const OTHER_SECTION_ID = "otros";

const eyebrows: Partial<Record<ProductType, string>> = {
  burger: "100% caseras",
  sandwich: "Para los que van por otra cosa",
  fries: "Para acompañar",
  beverage: "Bien frías"
};

/** Visible categories of the snapshot, by the store's `sortOrder` (ties keep the server's order). */
export function menuCategories(categories: readonly Category[]): MenuCategory[] {
  return categories
    .filter((category) => category.visible)
    .map((category, index) => ({ category, index }))
    .sort((a, b) => a.category.sortOrder - b.category.sortOrder || a.index - b.index)
    .map(({ category: { id, name, type } }) => ({ id, name, type }));
}

/** Lower case, without accents or extra spaces: "Sándwich" matches "sandwich". */
export function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es-AR")
    .replace(/\s+/g, " ")
    .trim();
}

function matches(product: Product, query: string) {
  if (!query) return true;
  return normalizeSearch(`${product.name} ${product.description}`).includes(query);
}

/**
 * The category a product is listed under: exactly its own. A product whose category is not in the
 * snapshot is never moved to another category that happens to share its type; it is listed under
 * "Más opciones" so it is neither misfiled nor silently dropped.
 */
function categoryOf(product: Product, categories: readonly MenuCategory[]) {
  return categories.find((category) => category.id === product.categoryId) ?? null;
}

/**
 * Sections to render, in the configured order, each keeping the catalog's product order.
 * In the full menu a featured product appears once, under "Las más pedidas"; filtering by its
 * category lists it there too. Unpublished products never appear; sold-out ones do (labelled).
 * Sections left empty by the filter or the search are dropped.
 */
export function buildMenuSections(
  products: readonly Product[],
  categories: readonly MenuCategory[],
  filter: MenuFilter,
  rawQuery: string
): MenuSectionView[] {
  const query = normalizeSearch(rawQuery);
  const visible = products.filter((product) => product.published && matches(product, query));
  const sections: MenuSectionView[] = [];

  if (filter === "all" || filter === FEATURED_SECTION_ID) {
    sections.push({
      id: FEATURED_SECTION_ID,
      title: "Las más pedidas",
      eyebrow: "Destacadas",
      featured: true,
      products: visible.filter((product) => product.featured)
    });
  }

  if (filter !== FEATURED_SECTION_ID) {
    const byCategory = new Map<string, Product[]>();
    for (const product of visible) {
      if (filter === "all" && product.featured) continue;
      const key = categoryOf(product, categories)?.id ?? OTHER_SECTION_ID;
      byCategory.set(key, [...(byCategory.get(key) ?? []), product]);
    }
    for (const category of categories) {
      if (filter !== "all" && filter !== category.id) continue;
      sections.push({
        id: category.id,
        title: category.name,
        eyebrow: eyebrows[category.type] ?? "Elegí tu favorito",
        featured: false,
        products: byCategory.get(category.id) ?? []
      });
    }
    if (filter === "all" || filter === OTHER_SECTION_ID) {
      sections.push({ id: OTHER_SECTION_ID, title: "Más opciones", eyebrow: "Elegí tu favorito", featured: false, products: byCategory.get(OTHER_SECTION_ID) ?? [] });
    }
  }

  return sections.filter((section) => section.products.length > 0);
}

/** Chips offered above the menu: everything, the featured section, then each non-empty category. */
export function menuFilters(products: readonly Product[], categories: readonly MenuCategory[]) {
  const sections = buildMenuSections(products, categories, "all", "");
  const listed = new Set(products.filter((product) => product.published).map((product) => categoryOf(product, categories)?.id));
  return [
    { id: "all", label: "Todo" },
    ...(sections.some((section) => section.featured) ? [{ id: FEATURED_SECTION_ID, label: "Destacadas" }] : []),
    ...categories.filter((category) => listed.has(category.id)).map((category) => ({ id: category.id, label: category.name }))
  ];
}
