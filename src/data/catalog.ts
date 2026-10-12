import type { Category, Product } from "@/domain/types";

/*
 * Demo menu for local work and CI without Supabase (never on a Vercel deployment: see
 * `allowsDemoCatalog`). BB-18: no photos, the Stitch mock-ups were never authorized for production.
 */

const burgerOptions = [
  {
    id: "patty",
    name: "Tamaño / medallones",
    selectionMode: "single" as const,
    required: true,
    minSelections: 1,
    maxSelections: 1,
    defaultOptionIds: ["double"],
    applicableTypes: ["burger" as const],
    options: [
      { id: "double", name: "Doble (2× 100g)", priceDeltaCents: 0n, available: true },
      { id: "triple", name: "Triple (3× 100g)", priceDeltaCents: 160000n, available: true }
    ]
  },
  {
    id: "extras",
    name: "Extras",
    selectionMode: "multiple" as const,
    required: false,
    minSelections: 0,
    maxSelections: 3,
    defaultOptionIds: [],
    applicableTypes: ["burger" as const, "sandwich" as const],
    options: [
      { id: "bacon", name: "Extra bacon ahumado", priceDeltaCents: 90000n, available: true },
      { id: "cheddar", name: "Cheddar fundido doble", priceDeltaCents: 80000n, available: true },
      { id: "egg", name: "Huevo a la plancha", priceDeltaCents: 60000n, available: true }
    ]
  }
];

const sandwichOptions = [
  {
    id: "bread",
    name: "Tipo de pan",
    selectionMode: "single" as const,
    required: true,
    minSelections: 1,
    maxSelections: 1,
    defaultOptionIds: ["brioche"],
    applicableTypes: ["sandwich" as const],
    options: [
      { id: "brioche", name: "Pan brioche tostado", priceDeltaCents: 0n, available: true },
      { id: "potato-roll", name: "Pan de papa", priceDeltaCents: 0n, available: true }
    ]
  }
];

const friesOptions = [
  {
    id: "portion",
    name: "Tamaño de porción",
    selectionMode: "single" as const,
    required: true,
    minSelections: 1,
    maxSelections: 1,
    defaultOptionIds: ["regular"],
    applicableTypes: ["fries" as const],
    options: [
      { id: "regular", name: "Regular", priceDeltaCents: 0n, available: true },
      { id: "large", name: "Grande para compartir", priceDeltaCents: 120000n, available: true }
    ]
  }
];

const beverageOptions = [
  {
    id: "ice",
    name: "Hielo",
    selectionMode: "single" as const,
    required: true,
    minSelections: 1,
    maxSelections: 1,
    defaultOptionIds: ["with-ice"],
    applicableTypes: ["beverage" as const],
    options: [
      { id: "with-ice", name: "Con hielo", priceDeltaCents: 0n, available: true },
      { id: "no-ice", name: "Sin hielo", priceDeltaCents: 0n, available: true }
    ]
  }
];

export const products: Product[] = [
  { id: "smash-doble", slug: "smash-bunker-doble", categoryId: "burgers", type: "burger", name: "Smash Búnker Doble", description: "Dos medallones smash, doble cheddar, bacon crocante y salsa Búnker.", priceCents: 780000n, imageUrl: null, published: true, featured: true, inStock: true, optionGroups: burgerOptions },
  { id: "oklahoma", slug: "oklahoma-onion", categoryId: "burgers", type: "burger", name: "Oklahoma Onion", description: "Cebolla ultrafina smashada, cheddar fundido, pepinillos y mostaza dijon.", priceCents: 720000n, imageUrl: null, published: true, featured: true, inStock: true, optionGroups: burgerOptions },
  { id: "crispy-chicken", slug: "crispy-chicken-bunker", categoryId: "sandwiches", type: "sandwich", name: "Crispy Chicken Búnker", description: "Pechuga extra crujiente, ensalada coleslaw fresca y pepinillo.", priceCents: 680000n, imageUrl: null, published: true, featured: false, inStock: true, optionGroups: sandwichOptions },
  { id: "pulled-pork", slug: "pulled-pork-bunker", categoryId: "sandwiches", type: "sandwich", name: "Pulled Pork Búnker", description: "Bondiola braseada lentamente, barbacoa Búnker y pan brioche.", priceCents: 740000n, imageUrl: null, published: true, featured: false, inStock: false, optionGroups: sandwichOptions },
  { id: "papas", slug: "papas-bunker", categoryId: "fries", type: "fries", name: "Papas Búnker", description: "Papas doradas con bacon crocante y cheddar fundido.", priceCents: 350000n, imageUrl: null, published: true, featured: false, inStock: true, optionGroups: friesOptions },
  { id: "aros", slug: "aros-de-cebolla", categoryId: "fries", type: "fries", name: "Aros de Cebolla", description: "Rebozado extra crocante con dip de barbacoa.", priceCents: 320000n, imageUrl: null, published: true, featured: false, inStock: false, optionGroups: friesOptions },
  { id: "gaseosa", slug: "gaseosa-lata", categoryId: "drinks", type: "beverage", name: "Gaseosa Lata 354ml", description: "Bien fría para acompañar tu pedido.", priceCents: 140000n, imageUrl: null, published: true, featured: false, inStock: true, containsAlcohol: false, optionGroups: beverageOptions },
  { id: "limonada", slug: "limonada-de-la-casa", categoryId: "drinks", type: "beverage", name: "Limonada de la Casa", description: "Limón exprimido, menta fresca y hielo.", priceCents: 240000n, imageUrl: null, published: true, featured: false, inStock: true, containsAlcohol: false, optionGroups: beverageOptions }
];

/** Store time zone; promotion windows are evaluated in it. */
export const STORE_TIMEZONE = "America/Argentina/Tucuman";

export const categoryLabels = {
  burgers: "Hamburguesas",
  sandwiches: "Sándwiches",
  fries: "Papas",
  drinks: "Bebidas"
} as const;

export type StoreCategory = keyof typeof categoryLabels;

/** Categories of the static fallback products (their `categoryId`s), in menu order. */
export const categories: Category[] = [
  { id: "burgers", slug: "hamburguesas", name: categoryLabels.burgers, type: "burger", sortOrder: 10, visible: true },
  { id: "sandwiches", slug: "sandwiches", name: categoryLabels.sandwiches, type: "sandwich", sortOrder: 20, visible: true },
  { id: "fries", slug: "papas", name: categoryLabels.fries, type: "fries", sortOrder: 30, visible: true },
  { id: "drinks", slug: "bebidas", name: categoryLabels.drinks, type: "beverage", sortOrder: 40, visible: true }
];
