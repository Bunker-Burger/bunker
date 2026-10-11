import { z } from "zod";
import type { MercadoPagoPaymentGateway, ProviderPayment } from "./ports";

/*
 * Reads a payment from the Mercado Pago API (`GET /v1/payments/{id}`), the only source the
 * webhook trusts (BB-15): the notification body says which payment changed, never its state.
 */

/** Mercado Pago does not know the payment (404): retrying will not change that. */
export class PaymentNotFoundError extends Error {
  constructor() {
    super("Mercado Pago no conoce el pago");
    this.name = "PaymentNotFoundError";
  }
}

/** The payment exists but its amount has fractions of a cent: it can never match a quote. */
export class UnusablePaymentAmountError extends Error {
  constructor() {
    super("Importe de pago con más de dos decimales");
    this.name = "UnusablePaymentAmountError";
  }
}

/** Mercado Pago could not answer now (network, timeout, 5xx, auth): the notification is retried. */
export class PaymentProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentProviderUnavailableError";
  }
}

const paymentSchema = z.object({
  id: z.union([z.number().int().positive(), z.string().regex(/^\d{1,30}$/)]),
  status: z.string().regex(/^[a-z_]{1,40}$/),
  external_reference: z.string().min(1).max(128).nullable().optional(),
  transaction_amount: z.number().positive(),
  currency_id: z.string().regex(/^[A-Z]{3}$/)
});

/** Exact cents of a provider amount; null when it has more than two decimals or is out of range. */
export function providerAmountToCents(amount: number): bigint | null {
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0 || Math.abs(amount * 100 - cents) > 1e-6) return null;
  return BigInt(cents);
}

/**
 * A payment object of the Mercado Pago API (`/v1/payments/{id}` or a `/v1/payments/search`
 * result), checked strictly: numeric id, known status shape, a finite positive amount with at most
 * two decimals, a currency code. The webhook and the customer's return both read payments through
 * this, so they credit exactly the same data (BB-15 round 1, H2).
 */
export function parseMercadoPagoPayment(
  raw: unknown
): { ok: true; payment: ProviderPayment } | { ok: false; reason: "shape" | "amount" } {
  const parsed = paymentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "shape" };
  const amountCents = providerAmountToCents(parsed.data.transaction_amount);
  if (amountCents === null) return { ok: false, reason: "amount" };
  return {
    ok: true,
    payment: {
      id: String(parsed.data.id),
      externalReference: parsed.data.external_reference ?? null,
      status: parsed.data.status,
      amountCents,
      currency: parsed.data.currency_id
    }
  };
}

export function createMercadoPagoPaymentGateway(options: {
  accessToken: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}): MercadoPagoPaymentGateway {
  const fetcher = options.fetcher ?? fetch;
  return {
    async getPayment(paymentId: string): Promise<ProviderPayment> {
      if (!/^\d{1,30}$/.test(paymentId)) throw new PaymentNotFoundError();
      let response: Response;
      try {
        response = await fetcher(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
          headers: { Authorization: `Bearer ${options.accessToken}` },
          cache: "no-store",
          signal: AbortSignal.timeout(options.timeoutMs ?? 8_000)
        });
      } catch {
        throw new PaymentProviderUnavailableError("Mercado Pago no respondió");
      }
      if (response.status === 404) throw new PaymentNotFoundError();
      if (!response.ok) throw new PaymentProviderUnavailableError(`Mercado Pago respondió ${response.status}`);

      const parsed = parseMercadoPagoPayment(await response.json().catch(() => null));
      if (!parsed.ok && parsed.reason === "amount") throw new UnusablePaymentAmountError();
      if (!parsed.ok) throw new PaymentProviderUnavailableError("Respuesta de pago inesperada");
      if (parsed.payment.id !== paymentId) throw new PaymentProviderUnavailableError("Mercado Pago devolvió otro pago");
      return parsed.payment;
    }
  };
}
