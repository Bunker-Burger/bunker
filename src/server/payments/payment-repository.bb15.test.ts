import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/server/supabase/database.types";
import { createSupabasePaymentRepository } from "./payment-repository";

/*
 * BB-15 Supabase adapter: payments and webhook events go through the database functions
 * (atomic, service_role only); contact columns are written with the attempt. The SQL itself is
 * covered by supabase/tests/database/bb15_mercado_pago_webhook.test.sql.
 */

interface Call {
  kind: string;
  args: unknown[];
}

function recordingClient(rpcResult: unknown, error: { message: string } | null = null) {
  const calls: Call[] = [];
  const builder = (table: string) => {
    const chain = {
      upsert: (...args: unknown[]) => {
        calls.push({ kind: `${table}.upsert`, args });
        return Promise.resolve({ error: null });
      },
      update: (...args: unknown[]) => {
        calls.push({ kind: `${table}.update`, args });
        return chain;
      },
      eq: (...args: unknown[]) => {
        calls.push({ kind: `${table}.eq`, args });
        return Object.assign(Promise.resolve({ error: null }), chain);
      },
      in: (...args: unknown[]) => {
        calls.push({ kind: `${table}.in`, args });
        return Promise.resolve({ error: null });
      }
    };
    return chain;
  };
  const client = {
    from: builder,
    rpc: (name: string, args: unknown) => {
      calls.push({ kind: `rpc.${name}`, args: [args] });
      return Promise.resolve({ data: rpcResult, error });
    }
  };
  return { client: client as unknown as SupabaseClient<Database>, calls };
}

const payment = { id: "1001", externalReference: "ref-00000001", status: "approved", amountCents: 150000n, currency: "ARS" };

describe("Supabase payment repository (BB-15)", () => {
  it("applies a provider payment through apply_mercado_pago_payment and returns its outcome", async () => {
    const { client, calls } = recordingClient("approved");
    await expect(createSupabasePaymentRepository(client).attempts.applyProviderPayment(payment)).resolves.toBe("approved");
    expect(calls).toEqual([
      {
        kind: "rpc.apply_mercado_pago_payment",
        args: [{
          target_external_reference: "ref-00000001",
          target_provider_payment_id: "1001",
          target_provider_status: "approved",
          target_amount_cents: 150000,
          target_currency: "ARS"
        }]
      }
    ]);
  });

  it("does not call the database for a payment without reference", async () => {
    const { client, calls } = recordingClient("approved");
    await expect(createSupabasePaymentRepository(client).attempts.applyProviderPayment({ ...payment, externalReference: null })).resolves.toBe(
      "unknown_reference"
    );
    expect(calls).toEqual([]);
  });

  it("fails on a database error or an unexpected outcome, so the delivery is retried", async () => {
    await expect(createSupabasePaymentRepository(recordingClient(null, { message: "timeout" }).client).attempts.applyProviderPayment(payment)).rejects.toThrow();
    await expect(createSupabasePaymentRepository(recordingClient("credited!").client).attempts.applyProviderPayment(payment)).rejects.toThrow();
  });

  it("claims webhook events through claim_payment_webhook_event", async () => {
    const { client, calls } = recordingClient("duplicate");
    await expect(createSupabasePaymentRepository(client).events.begin("event-1", "1001")).resolves.toBe("duplicate");
    expect(calls).toEqual([{ kind: "rpc.claim_payment_webhook_event", args: [{ target_event_id: "event-1", target_provider_payment_id: "1001" }] }]);
    await expect(createSupabasePaymentRepository(recordingClient("maybe").client).events.begin("event-1", "1001")).rejects.toThrow();
  });

  it("closes events as completed or failed with a bounded error code", async () => {
    const { client, calls } = recordingClient(null);
    const { events } = createSupabasePaymentRepository(client);
    await events.complete("event-1");
    await events.fail("event-2", "x".repeat(200));
    const updates = calls.filter((call) => call.kind === "payment_webhook_events.update").map((call) => call.args[0] as Record<string, unknown>);
    expect(updates[0]).toMatchObject({ processing_status: "completed", last_error_code: null });
    expect(updates[1]).toMatchObject({ processing_status: "failed", completed_at: null });
    expect(String(updates[1]?.last_error_code)).toHaveLength(80);
  });

  it("writes the minimal contact with the attempt", async () => {
    const { client, calls } = recordingClient(null);
    await createSupabasePaymentRepository(client).attempts.save({
      id: "attempt-1",
      quoteId: "quote-1",
      externalReference: "ref-00000001",
      expectedAmountCents: 150000n,
      status: "pending",
      createdAt: new Date("2026-10-11T12:00:00Z"),
      customer: { name: "Ana Pérez", phone: "+54 9 11 5555-0001" }
    });
    expect(calls[0]?.args[0]).toMatchObject({ customer_name: "Ana Pérez", customer_phone: "+54 9 11 5555-0001" });
  });

  it("never marks a settled attempt as approved again", async () => {
    const { client, calls } = recordingClient(null);
    await createSupabasePaymentRepository(client).attempts.markApproved("ref-00000001", "1001");
    expect(calls.find((call) => call.kind === "payment_attempts.in")?.args).toEqual([
      "status",
      ["created", "pending", "expired", "rejected", "cancelled"]
    ]);
  });
});
