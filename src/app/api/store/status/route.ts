import { getStoreStatus } from "@/server/catalog";
import { storeStatusResponse } from "@/server/catalog/store-status";

/** Public store status: open/paused/closed, whether orders are accepted, next opening and fee. */
export async function GET() {
  return storeStatusResponse(await getStoreStatus());
}
