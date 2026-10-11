import { detectMercadoPagoConfig } from "@/server/payments/mercado-pago";
import { createMercadoPagoPaymentGateway } from "@/server/payments/mercado-pago-gateway";
import { getPaymentPersistencePorts } from "@/server/payments/payment-repository";
import { handleMercadoPagoWebhookRequest } from "@/server/payments/webhook-http";

/**
 * Mercado Pago payment notifications (BB-15). Configure this URL and the "Pagos" topic in the
 * application's Webhooks panel; the checkout also sends it as `notification_url`. Runs even when
 * the store stopped offering Mercado Pago: payments already started must still be recorded.
 */
export async function POST(request: Request) {
  const detection = detectMercadoPagoConfig();
  const config = detection.enabled ? detection.config : null;
  return handleMercadoPagoWebhookRequest(request, {
    secret: config?.webhookSecret ?? null,
    ports: getPaymentPersistencePorts(),
    gateway: config ? createMercadoPagoPaymentGateway({ accessToken: config.accessToken }) : null
  });
}
