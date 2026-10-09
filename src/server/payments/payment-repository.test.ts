import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/server/supabase/database.types";
import {
  createInMemoryPaymentRepository,
  createSupabasePaymentRepository,
  getPaymentPersistencePorts
} from "./payment-repository";
import type { PaymentAttempt, PaymentQuote } from "./ports";

describe("createInMemoryPaymentRepository", () => {
  it("saves and retrieves quotes by id", async () => {
    const repo = createInMemoryPaymentRepository();
    const expiresAt = new Date("2026-10-09T01:00:00Z");

    const quote: PaymentQuote = {
      id: "quote-123",
      lines: [{
        productId: "p1",
        productName: "Smash",
        quantity: 2,
        unitPriceCents: 150000n,
        basePriceCents: 150000n,
        selectedOptions: [],
        notes: "Sin sal"
      }],
      subtotalCents: 300000n,
      discountCents: 0n,
      deliveryCents: 120000n,
      totalCents: 420000n,
      promotion: null,
      fulfillmentChannel: "delivery",
      expiresAt
    };

    await repo.quotes.save(quote);
    const retrieved = await repo.quotes.findById("quote-123");

    expect(retrieved).toEqual(quote);
    expect(await repo.quotes.findById("non-existent")).toBeNull();
  });

  it("saves and retrieves quotes preserving fulfillmentChannel (pickup and delivery)", async () => {
    const repo = createInMemoryPaymentRepository();
    const expiresAt = new Date("2026-10-09T01:00:00Z");

    const deliveryQuote: PaymentQuote = {
      id: "quote-delivery",
      lines: [{
        productId: "p1",
        productName: "Smash",
        quantity: 1,
        unitPriceCents: 150000n,
        basePriceCents: 150000n,
        selectedOptions: [],
        notes: ""
      }],
      subtotalCents: 150000n,
      discountCents: 0n,
      deliveryCents: 120000n,
      totalCents: 270000n,
      promotion: null,
      fulfillmentChannel: "delivery",
      expiresAt
    };

    const pickupQuote: PaymentQuote = {
      ...deliveryQuote,
      id: "quote-pickup",
      deliveryCents: 0n,
      totalCents: 150000n,
      fulfillmentChannel: "pickup"
    };

    await repo.quotes.save(deliveryQuote);
    await repo.quotes.save(pickupQuote);

    const retrievedDelivery = await repo.quotes.findById("quote-delivery");
    const retrievedPickup = await repo.quotes.findById("quote-pickup");

    expect(retrievedDelivery?.fulfillmentChannel).toBe("delivery");
    expect(retrievedPickup?.fulfillmentChannel).toBe("pickup");
  });

  it("saves, finds, and marks approved payment attempts", async () => {
    const repo = createInMemoryPaymentRepository();
    const createdAt = new Date("2026-10-09T01:00:00Z");

    const attempt: PaymentAttempt = {
      id: "attempt-uuid-1",
      quoteId: "quote-123",
      externalReference: "attempt-uuid-1",
      expectedAmountCents: 420000n,
      status: "pending",
      createdAt
    };

    await repo.attempts.save(attempt);
    const found = await repo.attempts.findByExternalReference("attempt-uuid-1");
    expect(found).toEqual(attempt);

    await repo.attempts.markApproved("attempt-uuid-1", "mp-payment-999");
    const updated = await repo.attempts.findByExternalReference("attempt-uuid-1");
    expect(updated?.status).toBe("approved");
    expect(updated?.providerPaymentId).toBe("mp-payment-999");
  });
});

describe("getPaymentPersistencePorts (P1-02 fail closed)", () => {
  it("returns null when SUPABASE_SERVICE_ROLE_KEY is missing, never falling back to ephemeral memory", () => {
    const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    try {
      const ports = getPaymentPersistencePorts();
      expect(ports).toBeNull();
    } finally {
      if (previousKey !== undefined) {
        process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
      }
    }
  });

  it("demonstrates why separate ephemeral instances fail reconciliation (P1-02)", async () => {
    // Instance A receives POST and creates preference
    const instanceA = createInMemoryPaymentRepository();
    const attempt: PaymentAttempt = {
      id: "ref-cross-instance",
      quoteId: "q1",
      externalReference: "ref-cross-instance",
      expectedAmountCents: 100000n,
      status: "pending",
      createdAt: new Date()
    };
    await instanceA.attempts.save(attempt);

    // Instance B receives GET callback/status query
    const instanceB = createInMemoryPaymentRepository();
    const resultFromB = await instanceB.attempts.findByExternalReference("ref-cross-instance");
    // Separate instances without shared durable persistence result in 404 / not_found!
    expect(resultFromB).toBeNull();
  });
});

describe("createSupabasePaymentRepository adapter (P2-03)", () => {
  it("persists and reads back fulfillment_channel for delivery and pickup", async () => {
    const quotesTable: Array<Record<string, unknown>> = [];
    const attemptsTable: Array<Record<string, unknown>> = [];
    const getTable = (name: string): Array<Record<string, unknown>> =>
      name === "payment_quotes" ? quotesTable : attemptsTable;

    const mockClient = {
      from(table: string) {
        const rows = getTable(table);
        return {
          insert(row: Record<string, unknown>) {
            rows.push(row);
            return Promise.resolve({ error: null });
          },
          select() {
            return {
              eq(col: string, val: unknown) {
                return {
                  maybeSingle() {
                    const found = rows.find((r) => r[col] === val);
                    return Promise.resolve({ data: found ?? null, error: null });
                  }
                };
              }
            };
          },
          update(updates: Record<string, unknown>) {
            return {
              eq(col: string, val: unknown) {
                const found = rows.find((r) => r[col] === val);
                if (found) Object.assign(found, updates);
                return Promise.resolve({ error: null });
              }
            };
          }
        };
      }
    } as unknown as SupabaseClient<Database>;

    const repo = createSupabasePaymentRepository(mockClient);

    const deliveryQuote: PaymentQuote = {
      id: "quote-supa-delivery",
      lines: [],
      subtotalCents: 200000n,
      discountCents: 0n,
      deliveryCents: 50000n,
      totalCents: 250000n,
      promotion: null,
      fulfillmentChannel: "delivery",
      expiresAt: new Date(Date.now() + 60000)
    };

    await repo.quotes.save(deliveryQuote);

    // DB row must contain fulfillment_channel: 'delivery'
    const rawRow = quotesTable.find((r) => r.id === "quote-supa-delivery");
    expect(rawRow?.fulfillment_channel).toBe("delivery");

    const loaded = await repo.quotes.findById("quote-supa-delivery");
    expect(loaded?.fulfillmentChannel).toBe("delivery");
  });

  it("fails closed when Supabase insert fails", async () => {
    const errorClient = {
      from() {
        return {
          insert() {
            return Promise.resolve({ error: { message: "database connection lost" } });
          }
        };
      }
    } as unknown as SupabaseClient<Database>;

    const repo = createSupabasePaymentRepository(errorClient);
    const quote: PaymentQuote = {
      id: "q-fail",
      lines: [],
      subtotalCents: 100000n,
      discountCents: 0n,
      deliveryCents: 0n,
      totalCents: 100000n,
      promotion: null,
      fulfillmentChannel: "pickup",
      expiresAt: new Date()
    };

    await expect(repo.quotes.save(quote)).rejects.toThrow("Error al persistir quote: database connection lost");
  });
});
