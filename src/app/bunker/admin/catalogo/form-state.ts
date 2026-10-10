export interface AdminFormState {
  status: "idle" | "success" | "error";
  message: string | null;
  fieldErrors?: Record<string, string>;
  /** Publication rules that failed, one sentence each. */
  issues?: string[];
}

export const IDLE_FORM_STATE: AdminFormState = { status: "idle", message: null };

export const ADMIN_CATALOG_PATH = "/bunker/admin/catalogo";

export const productEditPath = (productId: string) => `${ADMIN_CATALOG_PATH}/productos/${productId}`;

/** Tabs of the catalog screen: one per product type, in menu order. */
export const CATALOG_TABS = [
  { kind: "burger", type: "burger", slug: "hamburguesas", label: "Hamburguesas", singular: "hamburguesa" },
  { kind: "sandwich", type: "sandwich", slug: "sandwiches", label: "Sándwiches", singular: "sándwich" },
  { kind: "side", type: "fries", slug: "papas", label: "Papas", singular: "papas" },
  { kind: "drink", type: "beverage", slug: "bebidas", label: "Bebidas", singular: "bebida" }
] as const;

export type CatalogTab = (typeof CATALOG_TABS)[number];

export function tabForType(type: string): CatalogTab | undefined {
  return CATALOG_TABS.find((tab) => tab.type === type);
}

export function tabFor(slug: string | undefined): CatalogTab {
  return CATALOG_TABS.find((tab) => tab.slug === slug) ?? CATALOG_TABS[0];
}
