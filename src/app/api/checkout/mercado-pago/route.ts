import { getOperationalPublicCatalog, getStoreStatus } from "@/server/catalog";
import {
  mercadoPagoCheckoutResponse,
  prepareMercadoPagoCheckout
} from "@/server/checkout/mercadopago-checkout";
import { getPaymentPersistencePorts } from "@/server/payments/payment-repository";
import { createFixedWindowRateLimiter } from "@/server/rate-limit";

// Rate limiter: 10 peticiones por minuto por IP
const ipRateStore = new Map<string, { count: number; expiresAt: number }>();
const checkoutRateLimiter = createFixedWindowRateLimiter({
  limit: 10,
  windowMs: 60_000,
  now: () => Date.now(),
  store: {
    async increment(key, _windowStartMs, expiresAtMs) {
      const entry = ipRateStore.get(key);
      if (!entry || entry.expiresAt <= Date.now()) {
        ipRateStore.set(key, { count: 1, expiresAt: expiresAtMs });
        return 1;
      }
      entry.count += 1;
      return entry.count;
    }
  }
});

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "direct";

  const rateCheck = await checkoutRateLimiter.check(`checkout:mp:${ip}`);
  if (!rateCheck.allowed) {
    return Response.json(
      {
        error: "rate_limited",
        message: "Demasiadas solicitudes. Aguardá unos segundos antes de reintentar."
      },
      {
        status: 429,
        headers: {
          "Retry-After": Math.ceil(rateCheck.retryAfterMs / 1000).toString(),
          "Cache-Control": "no-store"
        }
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const now = new Date();
  const ports = getPaymentPersistencePorts();

  const result = await prepareMercadoPagoCheckout(body, {
    loadCatalog: () => getOperationalPublicCatalog(),
    loadStoreStatus: () => getStoreStatus(undefined, now),
    quotes: ports.quotes,
    attempts: ports.attempts,
    createId: () => crypto.randomUUID(),
    now: () => now
  });

  return mercadoPagoCheckoutResponse(result);
}
