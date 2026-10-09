import { getOperationalPublicCatalog, getStoreStatus } from "@/server/catalog";
import { prepareWhatsAppCheckout, whatsAppCheckoutResponse } from "@/server/checkout/whatsapp-checkout";

/**
 * Cash/transfer checkout: recomputes the total from fresh data and returns it with the owner's
 * `wa.me` link. Nothing is stored; a closed store or an invalid cart gets no link. POST Route
 * Handlers are never cached by Next; the data reads below are `no-store` themselves.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  const now = new Date();
  return whatsAppCheckoutResponse(
    await prepareWhatsAppCheckout(body, {
      loadCatalog: () => getOperationalPublicCatalog(),
      loadStoreStatus: () => getStoreStatus(undefined, now),
      now: () => now
    })
  );
}
