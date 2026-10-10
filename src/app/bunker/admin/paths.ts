export const ADMIN_STORE_PATH = "/bunker/admin/tienda";
export const ADMIN_PROMOTIONS_PATH = "/bunker/admin/promociones";
export const promotionEditPath = (promotionId: string) => `${ADMIN_PROMOTIONS_PATH}/${promotionId}`;

/**
 * Admin sections, shared by the navigation (client) and the admin home (server). Kept out of the
 * "use client" module: a server component importing a constant from it gets a client reference,
 * not the array.
 */
export const ADMIN_SECTIONS = [
  { href: "/bunker/admin/catalogo", label: "Catálogo" },
  { href: ADMIN_STORE_PATH, label: "Tienda" },
  { href: ADMIN_PROMOTIONS_PATH, label: "Promociones" }
] as const;
