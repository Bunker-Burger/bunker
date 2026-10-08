import { getOperationalPublicCatalog } from "@/server/catalog";
import { publicProductsResponse } from "@/server/catalog/public-products";

export const dynamic = "force-dynamic";

/**
 * Public catalog products and option groups, read fresh from Supabase.
 * Uses operational read (cache: "no-store") to bypass Next.js internal data cache tags/revalidation,
 * ensuring price, stock, and option availability modifications are immediately visible on the next read.
 */
export async function GET() {
  return publicProductsResponse(await getOperationalPublicCatalog());
}
