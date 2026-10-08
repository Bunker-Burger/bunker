import { z } from "zod";

import { assertAcceptingOrders, type StoreStatus } from "@/domain/store-status";
import type { PaymentAttemptsPort } from "./ports";

const REQUIRED_ENV = [
  "MERCADO_PAGO_ACCESS_TOKEN",
  "MERCADO_PAGO_WEBHOOK_SECRET",
  "APP_URL"
] as const;

export interface MercadoPagoConfig {
  accessToken: string;
  webhookSecret: string;
  appUrl: string;
}

export type MercadoPagoConfigDetection =
  | { enabled: false; missing: string[] }
  | { enabled: true; config: MercadoPagoConfig };

export function detectMercadoPagoConfig(environment: Readonly<Record<string, string | undefined>>): MercadoPagoConfigDetection {
  const missing = REQUIRED_ENV.filter((key) => !environment[key]?.trim());
  if (missing.length > 0) return { enabled: false, missing: [...missing] };
  const appUrl = new URL(environment.APP_URL!.trim());
  if (appUrl.protocol !== "https:" && appUrl.protocol !== "http:") {
    throw new Error("APP_URL debe usar HTTP o HTTPS");
  }
  return {
    enabled: true,
    config: {
      accessToken: environment.MERCADO_PAGO_ACCESS_TOKEN!.trim(),
      webhookSecret: environment.MERCADO_PAGO_WEBHOOK_SECRET!.trim(),
      appUrl: appUrl.href.replace(/\/$/, "")
    }
  };
}

const preferenceResponseSchema = z.object({
  id: z.string().min(1),
  init_point: z.string().url()
});

function centsToProviderNumber(cents: bigint): number {
  if (cents <= 0n || cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Importe fuera del rango permitido");
  }
  return Number(cents) / 100;
}

interface PreferenceInput {
  quote: { id: string; totalCents: bigint; expiresAt: Date };
  customer: { name: string; phone: string };
}

interface PreferenceDependencies {
  config: MercadoPagoConfig;
  fetcher: typeof fetch;
  attempts: PaymentAttemptsPort;
  /** Re-checked at payment time: the store may have closed since the quote was made. */
  storeStatus(): Promise<StoreStatus>;
  createId(): string;
  now(): Date;
}

export async function createCheckoutProPreference(
  input: PreferenceInput,
  dependencies: PreferenceDependencies
): Promise<{ preferenceId: string; checkoutUrl: string }> {
  assertAcceptingOrders(await dependencies.storeStatus());
  const attemptId = dependencies.createId();
  const [firstName, ...surnameParts] = input.customer.name.trim().split(/\s+/);
  const response = await dependencies.fetcher("https://api.mercadopago.com/checkout/preferences", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${dependencies.config.accessToken}`,
      "Content-Type": "application/json",
      "X-Idempotency-Key": attemptId
    },
    body: JSON.stringify({
      external_reference: attemptId,
      items: [{
        id: input.quote.id,
        title: `Pedido Bunker Burger ${input.quote.id}`,
        quantity: 1,
        unit_price: centsToProviderNumber(input.quote.totalCents),
        currency_id: "ARS"
      }],
      payer: {
        name: firstName,
        surname: surnameParts.join(" "),
        phone: { number: input.customer.phone }
      },
      notification_url: `${dependencies.config.appUrl}/api/payments/mercado-pago/webhook`,
      back_urls: {
        success: `${dependencies.config.appUrl}/?payment=success`,
        pending: `${dependencies.config.appUrl}/?payment=pending`,
        failure: `${dependencies.config.appUrl}/?payment=failure`
      },
      auto_return: "approved",
      expires: true,
      expiration_date_to: input.quote.expiresAt.toISOString()
    })
  });
  if (!response.ok) throw new Error(`Mercado Pago rechazó la preferencia (${response.status})`);
  const parsed = preferenceResponseSchema.parse(await response.json());
  await dependencies.attempts.save({
    id: attemptId,
    quoteId: input.quote.id,
    externalReference: attemptId,
    expectedAmountCents: input.quote.totalCents,
    status: "pending",
    createdAt: dependencies.now()
  });
  return { preferenceId: parsed.id, checkoutUrl: parsed.init_point };
}
