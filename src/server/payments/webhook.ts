import type {
  MercadoPagoPaymentGateway,
  PaymentAttemptsPort,
  WebhookEventsPort,
  WebhookNotification,
  WebhookSignatureVerifier
} from "./ports";

interface WebhookDependencies {
  verifier: WebhookSignatureVerifier;
  events: WebhookEventsPort;
  attempts: PaymentAttemptsPort;
  gateway: MercadoPagoPaymentGateway;
}

export type WebhookResult =
  | { kind: "invalid_signature" }
  | { kind: "duplicate" }
  | { kind: "ignored"; status: string }
  | { kind: "approved"; attemptId: string; paymentId: string };

export async function processMercadoPagoWebhook(
  notification: WebhookNotification,
  dependencies: WebhookDependencies
): Promise<WebhookResult> {
  if (!await dependencies.verifier.verify(notification)) return { kind: "invalid_signature" };
  if (await dependencies.events.begin(notification.eventId) === "duplicate") return { kind: "duplicate" };

  try {
    const payment = await dependencies.gateway.getPayment(notification.paymentId);
    const attempt = await dependencies.attempts.findByExternalReference(payment.externalReference);
    if (!attempt) throw new Error("Intento de pago desconocido");
    if (payment.currency !== "ARS") throw new Error("Moneda de pago inesperada");
    if (payment.amountCents !== attempt.expectedAmountCents) throw new Error("Importe de pago no coincide");

    if (payment.status !== "approved") {
      await dependencies.events.complete(notification.eventId);
      return { kind: "ignored", status: payment.status };
    }

    await dependencies.attempts.markApproved(attempt.externalReference, payment.id);
    await dependencies.events.complete(notification.eventId);
    return { kind: "approved", attemptId: attempt.id, paymentId: payment.id };
  } catch (error) {
    await dependencies.events.fail(notification.eventId);
    throw error;
  }
}
