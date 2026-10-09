import { describe, expect, it } from "vitest";
import { products as fallbackProducts } from "@/data/catalog";
import type { Category, Product } from "@/domain/types";
import { buildMenuSections, FEATURED_SECTION_ID, menuCategories, menuFilters, normalizeSearch } from "./menu-sections";

const names = (sections: ReturnType<typeof buildMenuSections>) =>
  sections.map((section) => [section.title, section.products.map((product) => product.name)]);

const category = (id: string, name: string, type: Category["type"], sortOrder: number, visible = true): Category => ({
  id,
  slug: id,
  name,
  type,
  sortOrder,
  visible
});

describe("menu sections", () => {
  const fallback = menuCategories(undefined);

  it("stacks the featured section first and then each category in order, each product once", () => {
    const sections = buildMenuSections(fallbackProducts, fallback, "all", "");

    expect(names(sections)).toEqual([
      ["Las más pedidas", ["Smash Búnker Doble", "Oklahoma Onion"]],
      ["Sándwiches", ["Crispy Chicken Búnker", "Pulled Pork Búnker"]],
      ["Papas", ["Papas Búnker", "Aros de Cebolla"]],
      ["Bebidas", ["Gaseosa Lata 354ml", "Limonada de la Casa"]]
    ]);
    const listed = sections.flatMap((section) => section.products.map((product) => product.id));
    expect(new Set(listed).size).toBe(listed.length);
    expect(sections[0]?.featured).toBe(true);
  });

  it("lists a featured product under its own category when that category is filtered", () => {
    expect(names(buildMenuSections(fallbackProducts, fallback, "burgers", ""))).toEqual([
      ["Hamburguesas", ["Smash Búnker Doble", "Oklahoma Onion"]]
    ]);
    expect(names(buildMenuSections(fallbackProducts, fallback, FEATURED_SECTION_ID, ""))).toEqual([
      ["Las más pedidas", ["Smash Búnker Doble", "Oklahoma Onion"]]
    ]);
  });

  it("follows the store's category order and names, hiding hidden categories", () => {
    const products: Product[] = fallbackProducts.map((product) => ({
      ...product,
      featured: false,
      categoryId: { burger: "c-burger", sandwich: "c-sandwich", fries: "c-side", beverage: "c-drink", other: "c-other" }[product.type]
    }));
    const categories = menuCategories([
      category("c-drink", "Bebidas frías", "beverage", 10),
      category("c-burger", "Clásicas", "burger", 20),
      category("c-side", "Acompañamientos", "fries", 30),
      category("c-sandwich", "Sándwiches", "sandwich", 40, false)
    ]);

    const sections = buildMenuSections(products, categories, "all", "");

    expect(sections.map((section) => section.title)).toEqual(["Bebidas frías", "Clásicas", "Acompañamientos", "Más opciones"]);
    // A product whose category is hidden still has a home, never vanishes silently.
    expect(sections.at(-1)?.products.map((product) => product.type)).toEqual(["sandwich", "sandwich"]);
    expect(menuFilters(products, categories).map((option) => option.label)).toEqual([
      "Todo",
      "Bebidas frías",
      "Clásicas",
      "Acompañamientos"
    ]);
  });

  it("searches name and description ignoring case and accents, across sections", () => {
    expect(names(buildMenuSections(fallbackProducts, fallback, "all", "  SANDWICH  "))).toEqual([]);
    expect(names(buildMenuSections(fallbackProducts, fallback, "all", "cebolla"))).toEqual([
      ["Las más pedidas", ["Oklahoma Onion"]],
      ["Papas", ["Aros de Cebolla"]]
    ]);
    expect(names(buildMenuSections(fallbackProducts, fallback, "all", "búnker")).flatMap(([, list]) => list)).toContain("Papas Búnker");
    expect(normalizeSearch("  Sándwich   Búnker ")).toBe("sandwich bunker");
  });

  it("never lists unpublished products and keeps sold-out ones", () => {
    const products = fallbackProducts.map((product) => (product.id === "gaseosa" ? { ...product, published: false } : product));
    const listed = buildMenuSections(products, fallback, "all", "").flatMap((section) => section.products);

    expect(listed.map((product) => product.id)).not.toContain("gaseosa");
    expect(listed.filter((product) => !product.inStock).map((product) => product.id)).toEqual(["pulled-pork", "aros"]);
  });

  it("offers Todo, Destacadas and only categories that have products", () => {
    const withoutDrinks = fallbackProducts.filter((product) => product.type !== "beverage");
    expect(menuFilters(withoutDrinks, fallback).map((option) => option.label)).toEqual([
      "Todo",
      "Destacadas",
      "Hamburguesas",
      "Sándwiches",
      "Papas"
    ]);
  });
});
