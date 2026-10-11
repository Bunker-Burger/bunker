import { PaymentNotFoundError, UnusablePaymentAmountError } from "./mercado-pago-gateway";
import type {
  MercadoPagoPaymentGateway,
  PaymentAttemptsPort,
  ProviderPaymentOutcome,
  WebhookEventsPort,
  WebhookNotification,
  WebhookSignatureVerifier
} from "./ports";

/*
 * BB-15: a Mercado Pago notification only says "payment X changed". The state comes from the API
 * and is applied atomically to the attempt of its reference (amount, currency and reference checked
 * against the frozen quote). Effects are idempotent at two levels: a notification id is processed
 * by one delivery at a time and once completed never again, and applying the same payment twice
 * changes nothing. Nothing is sent to anyone: an approved payment is recorded with its contact even
 * if the customer never comes back to send the WhatsApp message.
 */

interface WebhookDependencies {
  verifier: WebhookSignatureVerifier;
  events: WebhookEventsPort;
  attempts: Required<Pick<PaymentAttemptsPort, "applyProviderPayment">>;
  gateway: MercadoPagoPaymentGateway;
}

/** Outcomes that credit nothing; recorded on the event so a person can review them. */
export type NotAppliedReason =
  | "payment_not_found"
  | "unknown_reference"
  | "currency_mismatch"
  | "amount_mismatch"
  | "conflicting_payment";

const NOT_APPLIED = new Set<ProviderPaymentOutcome>(["unknown_reference", "currency_mismatch", "amount_mismatch", "conflicting_payment"]);

export type WebhookResult =
  | { kind: "invalid_signature" }
  /** Not a payment notification (merchant orders, other topics): acknowledged, nothing done. */
  | { kind: "ignored"; type: string }
  | { kind: "duplicate" }
  | { kind: "processed"; outcome: Exclude<ProviderPaymentOutcome, NotAppliedReason>; paymentId: string }
  | { kind: "not_applied"; reason: NotAppliedReason; paymentId: string };

/** Mercado Pago or the database could not complete the work now: the delivery must be retried. */
export class WebhookRetryableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WebhookRetryableError";
  }
}

export async function processMercadoPagoWebhook(
  notification: WebhookNotification,
  dependencies: WebhookDependencies
): Promise<WebhookResult> {
  if (!(await dependencies.verifier.verify(notification))) return { kind: "invalid_signature" };
  if (notification.type !== "payment") return { kind: "ignored", type: notification.type };

  const { eventId, dataId: paymentId } = notification;
  if ((await dependencies.events.begin(eventId, paymentId)) === "duplicate") return { kind: "duplicate" };

  const fail = async (code: string) => {
    try {
      await dependencies.events.fail(eventId, code);
    } catch {
      // The claim expires on its own (60 s) and the next delivery takes it again.
    }
  };
  const notApplied = async (reason: NotAppliedReason): Promise<WebhookResult> => {
    await fail(reason);
    return { kind: "not_applied", reason, paymentId };
  };

  let payment;
  try {
    payment = await dependencies.gateway.getPayment(paymentId);
  } catch (error) {
    if (error instanceof PaymentNotFoundError) return notApplied("payment_not_found");
    if (error instanceof UnusablePaymentAmountError) return notApplied("amount_mismatch");
    await fail("provider_unavailable");
    throw new WebhookRetryableError("No se pudo leer el pago en Mercado Pago", { cause: error });
  }
  if (!payment.externalReference) return notApplied("unknown_reference");

  let outcome: ProviderPaymentOutcome;
  try {
    outcome = await dependencies.attempts.applyProviderPayment(payment);
  } catch (error) {
    await fail("storage_unavailable");
    throw new WebhookRetryableError("No se pudo registrar el pago", { cause: error });
  }
  if (NOT_APPLIED.has(outcome)) return notApplied(outcome as NotAppliedReason);

  try {
    await dependencies.events.complete(eventId);
  } catch (error) {
    // The payment is applied; a retry re-reads it and changes nothing.
    throw new WebhookRetryableError("No se pudo cerrar el evento", { cause: error });
  }
  return { kind: "processed", outcome: outcome as Exclude<ProviderPaymentOutcome, NotAppliedReason>, paymentId };
}
