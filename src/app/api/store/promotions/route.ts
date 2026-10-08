import { getPublicPromotions } from "@/server/catalog";
import { publicPromotionsResponse } from "@/server/catalog/public-promotions";

/** Public promotion rules, read fresh, for the menu's struck-through prices and the checkout estimate. */
export async function GET() {
  return publicPromotionsResponse(await getPublicPromotions());
}
