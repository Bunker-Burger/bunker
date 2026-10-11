import { z } from "zod";

import { assertAcceptingOrders, type StoreStatus } from "@/domain/store-status";
import type { PaymentAttemptsPort } from "./ports";

export interface MercadoPagoConfig {
  accessToken: string;
  webhookSecret?: string;
  appUrl: string;
  publicKey?: string;
}

/**
 * `missing`: required variables that are absent. `invalid`: present but unusable (e.g. an
 * `APP_URL` that is not an http(s) URL). Either one disables Mercado Pago; detection never throws,
 * so a bad value of this optional payment method cannot break the pages that ask for it.
 */
export type MercadoPagoConfigDetection =
  | { enabled: false; missing: string[]; invalid?: string[] }
  | { enabled: true; config: MercadoPagoConfig };

function parsePublicAppUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

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

  let rawAppUrl = getEnvValue(environment, "APP_URL", "NEXT_PUBLIC_APP_URL");
  if (!rawAppUrl && environment.VERCEL_URL?.trim()) {
    rawAppUrl = `https://${environment.VERCEL_URL.trim()}`;
  }
  if (!rawAppUrl) missing.push("APP_URL");

  if (missing.length > 0) return { enabled: false, missing };

  const appUrl = parsePublicAppUrl(rawAppUrl!);
  if (!appUrl) return { enabled: false, missing: [], invalid: ["APP_URL"] };

  const webhookSecret = getEnvValue(environment, "MERCADO_PAGO_WEBHOOK_SECRET", "MERCADOPAGO_WEBHOOK_SECRET");

  const publicKey = getEnvValue(
    environment,
    "NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY",
    "NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY"
  );

  return {
    enabled: true,
    config: {
      accessToken: accessToken!,
      appUrl: appUrl.href.replace(/\/+$/, ""),
      ...(webhookSecret ? { webhookSecret } : {}),
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
  /** Business clock (quote expiry, timestamps). May be frozen for a whole request. */
  now(): Date;
  /**
   * Monotonic clock in milliseconds, used only to measure how long a lost race has waited.
   * Defaults to `performance.now()`; never derived from `now()`, which a request may freeze.
   */
  elapsedMs?(): number;
  /** Aborts the wait for a concurrent winner (e.g. the client went away). */
  signal?: AbortSignal;
  inFlightMap?: Map<string, Promise<{ preferenceId: string; checkoutUrl: string; externalReference: string }>>;
}

/** Longest real time a race loser waits for the winner's preference before failing safe. */
export const CONCURRENT_ATTEMPT_WAIT_MS = 3_000;
/** Hard cap on winner lookups, independent of any clock. */
export const CONCURRENT_ATTEMPT_MAX_POLLS = 25;

/** A concurrent attempt owns the idempotency key but did not publish its preference in time. */
export class ConcurrentAttemptPendingError extends Error {
  constructor(message = "El intento de pago concurrente no se resolvió a tiempo.") {
    super(message);
    this.name = "ConcurrentAttemptPendingError";
  }
}

/** The attempt was approved, refunded or closed while its preference was being created (BB-15). */
export class PaymentAttemptSettledError extends Error {
  constructor(message = "El intento de pago ya no está abierto.") {
    super(message);
    this.name = "PaymentAttemptSettledError";
  }
}

function waitFor(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ConcurrentAttemptPendingError("Espera del intento concurrente cancelada."));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ConcurrentAttemptPendingError("Espera del intento concurrente cancelada."));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
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

  // P2-09 & P1-11: Deduplicación atómica en memoria para carreras dentro del mismo proceso
  const inFlightTracker = dependencies.inFlightMap ?? inFlightPreferenceCreations;
  const inFlight = inFlightTracker.get(idempotencyKey);
  if (inFlight) {
    return inFlight;
  }

  // Minimal contact kept with the attempt (BB-15): a paid order is reachable even if the customer
  // never sends the WhatsApp message. Removed with the attempt by the 90-day purge.
  const customer = { name: input.customer.name.trim(), phone: input.customer.phone.trim() };

  const creationPromise = (async () => {
    assertAcceptingOrders(await dependencies.storeStatus());

    let finalAttemptId = attemptId;
    let finalExternalReference = initialExternalReference;

    // P1-10 & P2-09: Deduplicación durable en payment_attempts
    if (dependencies.attempts.findByIdempotencyKey) {
      const existing = await dependencies.attempts.findByIdempotencyKey(idempotencyKey);
      if (existing) {
        const isMatchingQuote =
          existing.quoteId === input.quote.id || existing.expectedAmountCents === input.quote.totalCents;
        const isPending = existing.status === "pending";
        const isUnexpired = input.quote.expiresAt.getTime() > dependencies.now().getTime();

        if (existing.providerPreferenceId && isMatchingQuote && isPending && isUnexpired) {
          // Respuesta previa existente completa y vigente: retornar sin invocar MP nuevamente
          return {
            preferenceId: existing.providerPreferenceId,
            checkoutUrl: `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=${existing.providerPreferenceId}`,
            externalReference: existing.externalReference
          };
        }

        if (isPending && isMatchingQuote && isUnexpired) {
          // Intento persistido previamente sin preference_id (ej. reintento tras timeout o error de red):
          // Reusar la identidad existente para mantener el mismo external_reference y clave
          finalAttemptId = existing.id;
          finalExternalReference = existing.externalReference;
        }
      }
    }

    // P2-08 & P1-10: Persistir intento e idempotency key durable ANTES de crear preferencia remota
    // Gestionar conflicto de idempotency_key ante carreras concurrentes entre procesos independientes
    try {
      await dependencies.attempts.save({
        id: finalAttemptId,
        quoteId: input.quote.id,
        idempotencyKey,
        externalReference: finalExternalReference,
        expectedAmountCents: input.quote.totalCents,
        status: "pending",
        createdAt: dependencies.now(),
        customer
      });
    } catch (saveError) {
      const isUniqueConflict =
        saveError instanceof Error &&
        (saveError.message.includes("unique") ||
          saveError.message.includes("idempotency_key") ||
          saveError.message.includes("duplicate key") ||
          (saveError as { code?: string }).code === "23505");

      if (isUniqueConflict && dependencies.attempts.findByIdempotencyKey) {
        // P1-11: El perdedor de la carrera atómica en DB NUNCA debe continuar a ejecutar un POST concurrente a Mercado Pago!
        // Espera/lee al ganador con timeout acotado y valida quote, monto, estado y vigencia.
        // P1-11B: la duración se mide con un reloj monotónico, nunca con `now()` (la ruta lo congela
        // por request), y además hay un tope de lecturas: termina aunque el reloj de negocio no avance.
        const elapsedMs = dependencies.elapsedMs ?? (() => performance.now());
        const startedAt = elapsedMs();
        let pollDelayMs = 40;

        for (let poll = 0; poll < CONCURRENT_ATTEMPT_MAX_POLLS; poll++) {
          const remainingMs = CONCURRENT_ATTEMPT_WAIT_MS - (elapsedMs() - startedAt);
          if (remainingMs <= 0) break;
          if (dependencies.signal?.aborted) throw new ConcurrentAttemptPendingError("Espera del intento concurrente cancelada.");

          const winning = await dependencies.attempts.findByIdempotencyKey(idempotencyKey);
          if (!winning) {
            throw saveError;
          }

          // Validar quote, status y vigencia
          const isMatchingQuote =
            winning.quoteId === input.quote.id ||
            winning.expectedAmountCents === input.quote.totalCents;
          const isPending = winning.status === "pending";
          const isUnexpired = input.quote.expiresAt.getTime() > dependencies.now().getTime();

          if (!isMatchingQuote || !isPending || !isUnexpired) {
            throw new Error("El intento de pago concurrente en DB no coincide con la cotización o ha expirado.");
          }

          if (winning.providerPreferenceId) {
            return {
              preferenceId: winning.providerPreferenceId,
              checkoutUrl: `https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=${winning.providerPreferenceId}`,
              externalReference: winning.externalReference
            };
          }

          await waitFor(Math.min(pollDelayMs, Math.max(0, remainingMs)), dependencies.signal);
          pollDelayMs = Math.min(pollDelayMs * 1.5, 200);
        }

        // Fail safe: the loser never creates a second remote preference for the same key.
        throw new ConcurrentAttemptPendingError(
          "Tiempo de espera agotado aguardando la resolución del intento concurrente."
        );
      } else {
        throw saveError;
      }
    }

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
        back_urls: {
          success: `${dependencies.config.appUrl}/?payment=success&ref=${finalExternalReference}`,
          pending: `${dependencies.config.appUrl}/?payment=pending&ref=${finalExternalReference}`,
          failure: `${dependencies.config.appUrl}/?payment=failure&ref=${finalExternalReference}`
        },
        auto_return: "approved",
        // BB-15: where Mercado Pago notifies payment changes. Only a public https URL is accepted
        // there; a local http APP_URL relies on the panel's webhook URL and the return check.
        ...(dependencies.config.appUrl.startsWith("https://")
          ? { notification_url: `${dependencies.config.appUrl}/api/payments/mercado-pago/webhook` }
          : {}),
        expires: true,
        expiration_date_to: input.quote.expiresAt.toISOString()
      })
    });
    if (!response.ok) throw new Error(`Mercado Pago rechazó la preferencia (${response.status})`);
    const parsed = preferenceResponseSchema.parse(await response.json());

    // P2-08: Completar provider_preference_id al volver exitosamente de Mercado Pago
    if (dependencies.attempts.updatePreferenceId) {
      const recorded = await dependencies.attempts.updatePreferenceId(finalExternalReference, parsed.id);
      // BB-15 R1 H3: a payment settled the attempt while the preference was being created (an
      // earlier preference of the same reference was paid or refunded). Nothing is overwritten and
      // no payment link is handed out for an order that is no longer open.
      if (recorded === false) throw new PaymentAttemptSettledError();
    } else {
      await dependencies.attempts.save({
        id: finalAttemptId,
        quoteId: input.quote.id,
        idempotencyKey,
        externalReference: finalExternalReference,
        expectedAmountCents: input.quote.totalCents,
        status: "pending",
        createdAt: dependencies.now(),
        providerPreferenceId: parsed.id,
        customer
      });
    }

    return { preferenceId: parsed.id, checkoutUrl: parsed.init_point, externalReference: finalExternalReference };
  })();

  inFlightTracker.set(idempotencyKey, creationPromise);
  try {
    return await creationPromise;
  } finally {
    inFlightTracker.delete(idempotencyKey);
  }
}
