import { getPublicCatalog } from "@/server/catalog";
import { publicProductsResponse } from "@/server/catalog/public-products";

/**
 * Public catalog products and option groups, read fresh from Supabase.
 * Never cached by the browser or service worker.
 */
export async function GET() {
  return publicProductsResponse(await getPublicCatalog());
}
