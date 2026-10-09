import { getOperationalPublicCatalog, getStoreStatus } from "@/server/catalog";
import {
  mercadoPagoCheckoutResponse,
  prepareMercadoPagoCheckout
} from "@/server/checkout/mercadopago-checkout";
import { getPaymentPersistencePorts } from "@/server/payments/payment-repository";
import {
  createFixedWindowRateLimiter,
  extractClientIp,
  getSharedRateLimitStore
} from "@/server/rate-limit";

// Rate limiter: 10 peticiones por minuto por IP con almacenamiento compartido y expiración
const checkoutRateLimiter = createFixedWindowRateLimiter({
  limit: 10,
  windowMs: 60_000,
  now: () => Date.now(),
  store: getSharedRateLimitStore()
});

export async function POST(request: Request) {
  const clientIp = extractClientIp(request.headers);

  const rateCheck = await checkoutRateLimiter.check(`checkout:mp:${clientIp}`);
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
  if (!ports) {
    return Response.json(
      { error: "unavailable", message: "El servicio de pagos no está disponible en este momento." },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }

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
