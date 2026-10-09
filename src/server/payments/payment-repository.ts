import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FulfilmentMethod } from "@/domain/types";
import { readSupabaseConfig } from "@/server/supabase/config";
import type { Database, Json } from "@/server/supabase/database.types";
import type {
  PaymentAttempt,
  PaymentAttemptsPort,
  PaymentQuote,
  PaymentQuotesPort,
  QuoteLine
} from "./ports";

const DEFAULT_STORE_ID = "0199b2c8-40b0-7000-8000-000000000001";

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

export function createSupabasePaymentRepository(
  client: SupabaseClient<Database>,
  options?: { storeId?: string }
): { quotes: PaymentQuotesPort; attempts: PaymentAttemptsPort } {
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

  const attempts: PaymentAttemptsPort = {
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
      return {
        id: data.id,
        quoteId: data.quote_id ?? "",
        idempotencyKey: data.idempotency_key ?? undefined,
        externalReference: data.external_reference,
        expectedAmountCents: BigInt(data.amount_cents),
        status: data.status as PaymentAttempt["status"],
        createdAt: new Date(data.created_at),
        providerPaymentId: data.provider_payment_id ?? undefined,
        providerPreferenceId: data.provider_preference_id ?? undefined
      };
    },

    async findByIdempotencyKey(key: string): Promise<PaymentAttempt | null> {
      const { data, error } = await client
        .from("payment_attempts")
        .select("*")
        .eq("idempotency_key", key)
        .maybeSingle();

      if (error || !data) return null;
      return {
        id: data.id,
        quoteId: data.quote_id ?? "",
        idempotencyKey: data.idempotency_key ?? undefined,
        externalReference: data.external_reference,
        expectedAmountCents: BigInt(data.amount_cents),
        status: data.status as PaymentAttempt["status"],
        createdAt: new Date(data.created_at),
        providerPaymentId: data.provider_payment_id ?? undefined,
        providerPreferenceId: data.provider_preference_id ?? undefined
      };
    },

    async markApproved(reference: string, providerPaymentId: string): Promise<void> {
      const { error } = await client
        .from("payment_attempts")
        .update({
          status: "approved",
          provider_payment_id: providerPaymentId,
          updated_at: new Date().toISOString()
        })
        .eq("external_reference", reference);

      if (error) {
        throw new Error(`Error al actualizar attempt: ${error.message}`);
      }
    }
  };

  return { quotes, attempts };
}

export function createInMemoryPaymentRepository(): {
  quotes: PaymentQuotesPort;
  attempts: PaymentAttemptsPort;
} {
  const quotesMap = new Map<string, PaymentQuote>();
  const attemptsMap = new Map<string, PaymentAttempt>();

  const quotes: PaymentQuotesPort = {
    async save(quote: PaymentQuote): Promise<void> {
      quotesMap.set(quote.id, { ...quote });
    },
    async findById(id: string): Promise<PaymentQuote | null> {
      const found = quotesMap.get(id);
      return found ? { ...found } : null;
    }
  };

  const attempts: PaymentAttemptsPort = {
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
      if (found) {
        attemptsMap.set(reference, {
          ...found,
          status: "approved",
          providerPaymentId
        });
      }
    }
  };

  return { quotes, attempts };
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
}): { quotes: PaymentQuotesPort; attempts: PaymentAttemptsPort } | null {
  const settings = persistenceSettings(process.env);
  if (!settings) return null;

  const serviceClient = createClient<Database>(settings.url, settings.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  return createSupabasePaymentRepository(serviceClient, options);
}
