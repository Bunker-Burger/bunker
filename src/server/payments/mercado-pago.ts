import { z } from "zod";

import { assertAcceptingOrders, type StoreStatus } from "@/domain/store-status";
import type { PaymentAttemptsPort } from "./ports";

export interface MercadoPagoConfig {
  accessToken: string;
  webhookSecret: string;
  appUrl: string;
  publicKey?: string;
}

export type MercadoPagoConfigDetection =
  | { enabled: false; missing: string[] }
  | { enabled: true; config: MercadoPagoConfig };

function getEnvValue(env: Readonly<Record<string, string | undefined>>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function detectMercadoPagoConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env
): MercadoPagoConfigDetection {
  const missing: string[] = [];

  const accessToken = getEnvValue(environment, "MERCADO_PAGO_ACCESS_TOKEN", "MERCADOPAGO_ACCESS_TOKEN");
  if (!accessToken) missing.push("MERCADO_PAGO_ACCESS_TOKEN");

  const webhookSecret = getEnvValue(environment, "MERCADO_PAGO_WEBHOOK_SECRET", "MERCADOPAGO_WEBHOOK_SECRET");
  if (!webhookSecret) missing.push("MERCADO_PAGO_WEBHOOK_SECRET");

  let rawAppUrl = getEnvValue(environment, "APP_URL", "NEXT_PUBLIC_APP_URL");
  if (!rawAppUrl && environment.VERCEL_URL?.trim()) {
    rawAppUrl = `https://${environment.VERCEL_URL.trim()}`;
  }
  if (!rawAppUrl) missing.push("APP_URL");

  if (missing.length > 0) return { enabled: false, missing };

  const appUrl = new URL(rawAppUrl!);
  if (appUrl.protocol !== "https:" && appUrl.protocol !== "http:") {
    throw new Error("APP_URL debe usar HTTP o HTTPS");
  }

  const publicKey = getEnvValue(
    environment,
    "NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY",
    "NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY"
  );

  return {
    enabled: true,
    config: {
      accessToken: accessToken!,
      webhookSecret: webhookSecret!,
      appUrl: appUrl.href.replace(/\/+$/, ""),
      ...(publicKey ? { publicKey } : {})
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

export interface PreferenceInput {
  quote: { id: string; totalCents: bigint; expiresAt: Date };
  customer: { name: string; phone: string };
  idempotencyKey?: string;
  externalReference?: string;
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

const inFlightPreferenceCreations = new Map<
  string,
  Promise<{ preferenceId: string; checkoutUrl: string; externalReference: string }>
>();

export async function createCheckoutProPreference(
  input: PreferenceInput,
  dependencies: PreferenceDependencies
): Promise<{ preferenceId: string; checkoutUrl: string; externalReference: string }> {
  const attemptId = dependencies.createId();
  const idempotencyKey = input.idempotencyKey ?? attemptId;
  const initialExternalReference = input.externalReference ?? attemptId;

  // P2-09: Deduplicación atómica en memoria para carreras concurrentes (síncrona antes de cualquier await)
  const inFlight = inFlightPreferenceCreations.get(idempotencyKey);
  if (inFlight) {
    return inFlight;
  }

  const creationPromise = (async () => {
    assertAcceptingOrders(await dependencies.storeStatus());

    let finalAttemptId = attemptId;
    let finalExternalReference = initialExternalReference;

    // P2-09: Deduplicación durable en payment_attempts
    if (dependencies.attempts.findByIdempotencyKey) {
      const existing = await dependencies.attempts.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        if (existing.providerPreferenceId) {
          // Respuesta previa existente completa: retornar sin invocar MP nuevamente
          return {
            preferenceId: existing.providerPreferenceId,
            checkoutUrl: `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=${existing.providerPreferenceId}`,
            externalReference: existing.externalReference
          };
        }
        // Intento persistido previamente sin preference_id (ej. reintento tras timeout o error de red):
        // Reusar la identidad existente para mantener el mismo external_reference y clave
        finalAttemptId = existing.id;
        finalExternalReference = existing.externalReference;
      }
    }

    // P2-08: Persistir intento e idempotency key durable ANTES de crear preferencia remota
    // Si la base de datos falla al guardar el attempt, NUNCA se invoca Mercado Pago.
    await dependencies.attempts.save({
      id: finalAttemptId,
      quoteId: input.quote.id,
      idempotencyKey,
      externalReference: finalExternalReference,
      expectedAmountCents: input.quote.totalCents,
      status: "pending",
      createdAt: dependencies.now()
    });

    const [firstName, ...surnameParts] = input.customer.name.trim().split(/\s+/);
    const response = await dependencies.fetcher("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${dependencies.config.accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify({
        external_reference: finalExternalReference,
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
          success: `${dependencies.config.appUrl}/?payment=success&ref=${finalExternalReference}`,
          pending: `${dependencies.config.appUrl}/?payment=pending&ref=${finalExternalReference}`,
          failure: `${dependencies.config.appUrl}/?payment=failure&ref=${finalExternalReference}`
        },
        auto_return: "approved",
        expires: true,
        expiration_date_to: input.quote.expiresAt.toISOString()
      })
    });
    if (!response.ok) throw new Error(`Mercado Pago rechazó la preferencia (${response.status})`);
    const parsed = preferenceResponseSchema.parse(await response.json());

    // P2-08: Completar provider_preference_id al volver exitosamente de Mercado Pago
    if (dependencies.attempts.updatePreferenceId) {
      await dependencies.attempts.updatePreferenceId(finalExternalReference, parsed.id);
    } else {
      await dependencies.attempts.save({
        id: finalAttemptId,
        quoteId: input.quote.id,
        idempotencyKey,
        externalReference: finalExternalReference,
        expectedAmountCents: input.quote.totalCents,
        status: "pending",
        createdAt: dependencies.now(),
        providerPreferenceId: parsed.id
      });
    }

    return { preferenceId: parsed.id, checkoutUrl: parsed.init_point, externalReference: finalExternalReference };
  })();

  inFlightPreferenceCreations.set(idempotencyKey, creationPromise);
  try {
    return await creationPromise;
  } finally {
    inFlightPreferenceCreations.delete(idempotencyKey);
  }
}
