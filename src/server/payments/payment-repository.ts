import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FulfilmentMethod } from "@/domain/types";
import { readSupabaseConfig } from "@/server/supabase/config";
import type { Database, Json } from "@/server/supabase/database.types";
import { applyProviderPaymentToAttempt } from "./payment-application";
import type {
  PaymentAttempt,
  PaymentAttemptsPort,
  PaymentQuote,
  PaymentQuotesPort,
  ProviderPayment,
  ProviderPaymentOutcome,
  QuoteLine,
  WebhookEventsPort
} from "./ports";

const DEFAULT_STORE_ID = "0199b2c8-40b0-7000-8000-000000000001";

/** Statuses a payment can still approve (BB-15); approved and refunded attempts are settled. */
const OPEN_ATTEMPT_STATUSES = ["created", "pending", "expired", "rejected", "cancelled"] as const;

const PROVIDER_PAYMENT_OUTCOMES = new Set<ProviderPaymentOutcome>([
  "approved",
  "refunded",
  "rejected",
  "cancelled",
  "pending",
  "unchanged",
  "unknown_reference",
  "currency_mismatch",
  "amount_mismatch",
  "conflicting_payment"
]);

/** An unexpected webhook claim in-flight longer than this is taken over by the next delivery. */
export const WEBHOOK_CLAIM_STALE_MS = 60_000;

export interface PaymentPersistencePorts {
  quotes: PaymentQuotesPort;
  attempts: PaymentAttemptsPort & Required<Pick<PaymentAttemptsPort, "applyProviderPayment">>;
  events: WebhookEventsPort;
}

function serializeLines(lines: QuoteLine[]): Json {
  return lines.map((line) => ({
    productId: line.productId,
    productName: line.productName,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents.toString(),
    basePriceCents: line.basePriceCents.toString(),
    selectedOptions: line.selectedOptions,
    notes: line.notes
  }));
}

function deserializeLines(json: unknown): QuoteLine[] {
  if (!Array.isArray(json)) return [];
  return json.map((item: unknown) => {
    const row = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    return {
      productId: String(row.productId ?? ""),
      productName: String(row.productName ?? ""),
      quantity: Number(row.quantity ?? 1),
      unitPriceCents: BigInt(String(row.unitPriceCents ?? 0)),
      basePriceCents: BigInt(String(row.basePriceCents ?? row.unitPriceCents ?? 0)),
      selectedOptions: Array.isArray(row.selectedOptions)
        ? (row.selectedOptions as Array<{ groupId: string; optionId: string; optionName: string }>)
        : [],
      notes: String(row.notes ?? "")
    };
  });
}

type AttemptRow = Database["public"]["Tables"]["payment_attempts"]["Row"];

function toAttempt(data: AttemptRow): PaymentAttempt {
  return {
    id: data.id,
    quoteId: data.quote_id ?? "",
    idempotencyKey: data.idempotency_key ?? undefined,
    externalReference: data.external_reference,
    expectedAmountCents: BigInt(data.amount_cents),
    status: data.status as PaymentAttempt["status"],
    createdAt: new Date(data.created_at),
    providerPaymentId: data.provider_payment_id ?? undefined,
    providerPreferenceId: data.provider_preference_id ?? undefined,
    providerStatus: data.provider_status ?? undefined,
    customer: data.customer_name && data.customer_phone ? { name: data.customer_name, phone: data.customer_phone } : undefined
  };
}

export function createSupabasePaymentRepository(
  client: SupabaseClient<Database>,
  options?: { storeId?: string }
): PaymentPersistencePorts {
  const storeId = options?.storeId ?? DEFAULT_STORE_ID;

  const quotes: PaymentQuotesPort = {
    async save(quote: PaymentQuote): Promise<void> {
      const { error } = await client.from("payment_quotes").insert({
        id: quote.id,
        store_id: storeId,
        lines: serializeLines(quote.lines),
        subtotal_cents: Number(quote.subtotalCents),
        discount_cents: Number(quote.discountCents),
        delivery_cents: Number(quote.deliveryCents),
        total_cents: Number(quote.totalCents),
        currency: "ARS",
        fulfillment_channel: quote.fulfillmentChannel,
        expires_at: quote.expiresAt.toISOString()
      });
      if (error) {
        throw new Error(`Error al persistir quote: ${error.message}`);
      }
    },

    async findById(id: string): Promise<PaymentQuote | null> {
      const { data, error } = await client
        .from("payment_quotes")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error || !data) return null;
      return {
        id: data.id,
        lines: deserializeLines(data.lines),
        subtotalCents: BigInt(data.subtotal_cents),
        discountCents: BigInt(data.discount_cents),
        deliveryCents: BigInt(data.delivery_cents),
        totalCents: BigInt(data.total_cents),
        promotion: null,
        fulfillmentChannel: (data.fulfillment_channel as FulfilmentMethod) ?? "pickup",
        expiresAt: new Date(data.expires_at)
      };
    }
  };

  const attempts: PersistencePortsAttempts = {
    async save(attempt: PaymentAttempt): Promise<void> {
      const { error } = await client.from("payment_attempts").upsert({
        id: attempt.id,
        store_id: storeId,
        quote_id: attempt.quoteId,
        amount_cents: Number(attempt.expectedAmountCents),
        currency: "ARS",
        external_reference: attempt.externalReference,
        idempotency_key: attempt.idempotencyKey ?? attempt.id,
        provider: "mercado_pago",
        provider_preference_id: attempt.providerPreferenceId ?? null,
        provider_payment_id: attempt.providerPaymentId ?? null,
        status: attempt.status,
        customer_name: attempt.customer?.name ?? null,
        customer_phone: attempt.customer?.phone ?? null,
        expires_at: new Date(attempt.createdAt.getTime() + 15 * 60_000).toISOString()
      }, { onConflict: "external_reference" });
      if (error) {
        throw new Error(`Error al persistir attempt: ${error.message}`);
      }
    },

    async updatePreferenceId(reference: string, providerPreferenceId: string): Promise<void> {
      const { error } = await client
        .from("payment_attempts")
        .update({
          provider_preference_id: providerPreferenceId,
          status: "pending",
          updated_at: new Date().toISOString()
        })
        .eq("external_reference", reference);

      if (error) {
        throw new Error(`Error al actualizar preference_id: ${error.message}`);
      }
    },

    async findByExternalReference(reference: string): Promise<PaymentAttempt | null> {
      const { data, error } = await client
        .from("payment_attempts")
        .select("*")
        .eq("external_reference", reference)
        .maybeSingle();

      if (error || !data) return null;
      return toAttempt(data);
    },

    async findByIdempotencyKey(key: string): Promise<PaymentAttempt | null> {
      const { data, error } = await client
        .from("payment_attempts")
        .select("*")
        .eq("idempotency_key", key)
        .maybeSingle();

      if (error || !data) return null;
      return toAttempt(data);
    },

    async markApproved(reference: string, providerPaymentId: string): Promise<void> {
      // Never over a settled attempt: another payment must not replace the approved one (BB-15).
      const { error } = await client
        .from("payment_attempts")
        .update({
          status: "approved",
          provider_payment_id: providerPaymentId,
          updated_at: new Date().toISOString()
        })
        .eq("external_reference", reference)
        .in("status", [...OPEN_ATTEMPT_STATUSES]);

      if (error) {
        throw new Error(`Error al actualizar attempt: ${error.message}`);
      }
    },

    async applyProviderPayment(payment: ProviderPayment): Promise<ProviderPaymentOutcome> {
      if (!payment.externalReference) return "unknown_reference";
      const { data, error } = await client.rpc("apply_mercado_pago_payment", {
        target_external_reference: payment.externalReference,
        target_provider_payment_id: payment.id,
        target_provider_status: payment.status,
        target_amount_cents: Number(payment.amountCents),
        target_currency: payment.currency
      });
      if (error) throw new Error(`Error al aplicar el pago: ${error.message}`);
      if (!PROVIDER_PAYMENT_OUTCOMES.has(data as ProviderPaymentOutcome)) throw new Error("Resultado de pago inesperado");
      return data as ProviderPaymentOutcome;
    }
  };

  const events: WebhookEventsPort = {
    async begin(eventId: string, providerPaymentId: string) {
      const { data, error } = await client.rpc("claim_payment_webhook_event", {
        target_event_id: eventId,
        target_provider_payment_id: providerPaymentId
      });
      if (error) throw new Error(`Error al registrar el evento: ${error.message}`);
      if (data !== "started" && data !== "duplicate") throw new Error("Resultado de evento inesperado");
      return data;
    },

    async complete(eventId: string) {
      const { error } = await client
        .from("payment_webhook_events")
        .update({ processing_status: "completed", completed_at: new Date().toISOString(), last_error_code: null })
        .eq("event_id", eventId);
      if (error) throw new Error(`Error al completar el evento: ${error.message}`);
    },

    async fail(eventId: string, errorCode: string) {
      const { error } = await client
        .from("payment_webhook_events")
        .update({ processing_status: "failed", completed_at: null, last_error_code: errorCode.slice(0, 80) })
        .eq("event_id", eventId);
      if (error) throw new Error(`Error al marcar el evento: ${error.message}`);
    }
  };

  return { quotes, attempts, events };
}

type PersistencePortsAttempts = PaymentPersistencePorts["attempts"];

export function createInMemoryPaymentRepository(options: { now?: () => Date } = {}): PaymentPersistencePorts {
  const now = options.now ?? (() => new Date());
  const quotesMap = new Map<string, PaymentQuote>();
  const attemptsMap = new Map<string, PaymentAttempt>();
  const eventsMap = new Map<string, { providerPaymentId: string; status: "processing" | "completed" | "failed"; claimedAt: number; errorCode: string | null; deliveries: number }>();

  const quotes: PaymentQuotesPort = {
    async save(quote: PaymentQuote): Promise<void> {
      quotesMap.set(quote.id, { ...quote });
    },
    async findById(id: string): Promise<PaymentQuote | null> {
      const found = quotesMap.get(id);
      return found ? { ...found } : null;
    }
  };

  const attempts: PersistencePortsAttempts = {
    async save(attempt: PaymentAttempt): Promise<void> {
      // P1-10: Simular la restricción UNIQUE de PostgreSQL sobre idempotency_key
      if (attempt.idempotencyKey) {
        for (const existing of attemptsMap.values()) {
          if (
            existing.id !== attempt.id &&
            existing.idempotencyKey === attempt.idempotencyKey
          ) {
            const err = new Error(
              'duplicate key value violates unique constraint "payment_attempts_idempotency_key_key"'
            );
            (err as { code?: string }).code = "23505";
            throw err;
          }
        }
      }
      attemptsMap.set(attempt.externalReference, { ...attempt });
    },
    async updatePreferenceId(reference: string, providerPreferenceId: string): Promise<void> {
      const found = attemptsMap.get(reference);
      if (found) {
        attemptsMap.set(reference, {
          ...found,
          providerPreferenceId,
          status: "pending"
        });
      }
    },
    async findByExternalReference(reference: string): Promise<PaymentAttempt | null> {
      const found = attemptsMap.get(reference);
      return found ? { ...found } : null;
    },
    async findByIdempotencyKey(key: string): Promise<PaymentAttempt | null> {
      for (const att of attemptsMap.values()) {
        if ((att.idempotencyKey ?? att.id) === key) {
          return { ...att };
        }
      }
      return null;
    },
    async markApproved(reference: string, providerPaymentId: string): Promise<void> {
      const found = attemptsMap.get(reference);
      if (found && (OPEN_ATTEMPT_STATUSES as readonly string[]).includes(found.status)) {
        attemptsMap.set(reference, {
          ...found,
          status: "approved",
          providerPaymentId
        });
      }
    },
    async applyProviderPayment(payment: ProviderPayment): Promise<ProviderPaymentOutcome> {
      // Synchronous read-decide-write: no await in between, like the row lock of the database.
      const attempt = payment.externalReference ? attemptsMap.get(payment.externalReference) ?? null : null;
      const quoteTotal = attempt ? quotesMap.get(attempt.quoteId)?.totalCents ?? null : null;
      const { outcome, next } = applyProviderPaymentToAttempt(attempt, quoteTotal, payment);
      if (next) attemptsMap.set(next.externalReference, next);
      return outcome;
    }
  };

  const events: WebhookEventsPort = {
    async begin(eventId: string, providerPaymentId: string) {
      const existing = eventsMap.get(eventId);
      const at = now().getTime();
      if (!existing) {
        eventsMap.set(eventId, { providerPaymentId, status: "processing", claimedAt: at, errorCode: null, deliveries: 1 });
        return "started";
      }
      const retryable = existing.status === "failed" || (existing.status === "processing" && at - existing.claimedAt > WEBHOOK_CLAIM_STALE_MS);
      if (existing.providerPaymentId !== providerPaymentId || !retryable) return "duplicate";
      eventsMap.set(eventId, { ...existing, status: "processing", claimedAt: at, errorCode: null, deliveries: existing.deliveries + 1 });
      return "started";
    },
    async complete(eventId: string) {
      const existing = eventsMap.get(eventId);
      if (existing) eventsMap.set(eventId, { ...existing, status: "completed", errorCode: null });
    },
    async fail(eventId: string, errorCode: string) {
      const existing = eventsMap.get(eventId);
      if (existing) eventsMap.set(eventId, { ...existing, status: "failed", errorCode });
    }
  };

  return { quotes, attempts, events };
}

type Environment = Readonly<Record<string, string | undefined>>;

/** Durable payment storage settings (service role + valid project), or null when incomplete. */
function persistenceSettings(environment: Environment): { url: string; serviceRoleKey: string } | null {
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const configResult = readSupabaseConfig(environment);
  return serviceRoleKey && configResult.ok ? { url: configResult.value.url, serviceRoleKey } : null;
}

/**
 * Whether quotes and attempts can be stored durably. Same rule as `getPaymentPersistencePorts`,
 * without creating a client, so availability checks can run during a page render.
 */
export function isPaymentPersistenceConfigured(environment: Environment = process.env): boolean {
  return persistenceSettings(environment) !== null;
}

export function getPaymentPersistencePorts(options?: {
  storeId?: string;
}): PaymentPersistencePorts | null {
  const settings = persistenceSettings(process.env);
  if (!settings) return null;

  const serviceClient = createClient<Database>(settings.url, settings.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return createSupabasePaymentRepository(serviceClient, options);
}
