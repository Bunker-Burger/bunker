import type { PaymentAttempt, ProviderPayment, ProviderPaymentOutcome } from "./ports";

/*
 * BB-15: what a payment read from Mercado Pago does to its attempt. The database applies the same
 * rules atomically (`public.apply_mercado_pago_payment`, under a row lock); this pure copy serves
 * the in-memory repository and documents them:
 * - nothing is credited when the currency is not ARS or the amount differs from the attempt or its
 *   frozen quote;
 * - pending-like statuses (pending, in_process, authorized, in_mediation) only record the status;
 * - an approved attempt never goes back; only a refund (or chargeback) of that same payment moves it;
 * - a second approved payment for the same reference is reported (`conflicting_payment`, money to
 *   return by hand), never recorded over the first one.
 */

const TRANSITIONS: Readonly<Record<string, "approved" | "rejected" | "cancelled" | "refunded">> = {
  approved: "approved",
  rejected: "rejected",
  cancelled: "cancelled",
  refunded: "refunded",
  charged_back: "refunded"
};

const PROVIDER_STATUS = /^[a-z_]{1,40}$/;

export interface PaymentApplication {
  outcome: ProviderPaymentOutcome;
  /** The attempt after applying the payment; absent when nothing changes. */
  next?: PaymentAttempt;
}

export function applyProviderPaymentToAttempt(
  attempt: PaymentAttempt | null,
  quoteTotalCents: bigint | null,
  payment: ProviderPayment
): PaymentApplication {
  if (!payment.id || payment.id.length > 255 || !PROVIDER_STATUS.test(payment.status)) {
    throw new Error("Pago del proveedor inválido");
  }
  if (!attempt) return { outcome: "unknown_reference" };
  if (payment.currency !== "ARS") return { outcome: "currency_mismatch" };
  if (payment.amountCents !== attempt.expectedAmountCents || (quoteTotalCents !== null && payment.amountCents !== quoteTotalCents)) {
    return { outcome: "amount_mismatch" };
  }

  const nextStatus = TRANSITIONS[payment.status];
  const settled = attempt.status === "approved" || attempt.status === "refunded";

  if (settled && attempt.providerPaymentId !== undefined && attempt.providerPaymentId !== payment.id) {
    return { outcome: nextStatus === "approved" ? "conflicting_payment" : "unchanged" };
  }
  if (attempt.status === "refunded") return { outcome: "unchanged" };
  if (attempt.status === "approved") {
    return nextStatus === "refunded"
      ? { outcome: "refunded", next: { ...attempt, status: "refunded", providerStatus: payment.status } }
      : { outcome: "unchanged" };
  }
  if (!nextStatus) return { outcome: "pending", next: { ...attempt, providerStatus: payment.status } };
  return {
    outcome: nextStatus,
    next: { ...attempt, status: nextStatus, providerPaymentId: payment.id, providerStatus: payment.status }
  };
}
