import { describe, expect, it, vi } from "vitest";
import { evaluateStoreStatus, type StoreOperatingSettings } from "@/domain/store-status";
import { createCheckoutProPreference, PaymentAttemptSettledError } from "./mercado-pago";
import { createInMemoryPaymentRepository } from "./payment-repository";
import type { ProviderPayment } from "./ports";

/*
 * BB-15 round 1, H3: a late write of the checkout (recording the preference, or a retried save)
 * never takes back a payment that settled the attempt in the meantime, and no second preference
 * is created for it. Interleavings run on the in-memory repository, which follows the same rules as
 * the Supabase adapter (filtered update, ON CONFLICT DO NOTHING).
 */

const REFERENCE = "attempt-1";

function openStore() {
  const settings: StoreOperatingSettings = {
    timezone: "America/Argentina/Tucuman",
    statusOverride: "open",
    deliveryFeeCents: 0n,
    businessHours: []
  };
  return async () => evaluateStoreStatus(settings, new Date("2026-10-11T12:00:00Z"));
}

const approved = (overrides: Partial<ProviderPayment> = {}): ProviderPayment => ({
  id: "1001",
  externalReference: REFERENCE,
  status: "approved",
  amountCents: 150000n,
  currency: "ARS",
  ...overrides
});

/** Creates a preference while `meanwhile` runs inside the Mercado Pago call (a payment landing). */
async function createWhile(meanwhile: (repository: ReturnType<typeof createInMemoryPaymentRepository>) => Promise<void>) {
  const repository = createInMemoryPaymentRepository();
  const fetcher = vi.fn(async () => {
    await meanwhile(repository);
    return new Response(JSON.stringify({ id: "pref-1", init_point: "https://mp.example/pay" }), { status: 201 });
  });
  const result = createCheckoutProPreference(
    {
      quote: { id: "quote-1", totalCents: 150000n, expiresAt: new Date("2026-10-11T12:15:00Z") },
      customer: { name: "Ana Pérez", phone: "+5491155551234" },
      idempotencyKey: "idempotency-key-0001"
    },
    {
      config: { accessToken: "TEST-token", webhookSecret: "secret", appUrl: "https://bunker.example" },
      fetcher: fetcher as unknown as typeof fetch,
      attempts: repository.attempts,
      storeStatus: openStore(),
      createId: () => REFERENCE,
      now: () => new Date("2026-10-11T12:00:00Z"),
      inFlightMap: new Map()
    }
  );
  return { repository, fetcher, result };
}

describe("late checkout writes never undo a payment (BB-15 R1 H3)", () => {
  it("control: without a payment in between, the preference is recorded on the open attempt", async () => {
    const { repository, result } = await createWhile(async () => {});
    await expect(result).resolves.toMatchObject({ preferenceId: "pref-1" });
    expect(await repository.attempts.findByExternalReference(REFERENCE)).toMatchObject({ status: "pending", providerPreferenceId: "pref-1" });
  });

  it("an approval that lands while the preference is created stays approved, with its payment", async () => {
    const { repository, fetcher, result } = await createWhile(async (repo) => {
      await expect(repo.attempts.applyProviderPayment(approved())).resolves.toBe("approved");
    });
    await expect(result).rejects.toBeInstanceOf(PaymentAttemptSettledError);
    const attempt = await repository.attempts.findByExternalReference(REFERENCE);
    expect(attempt).toMatchObject({ status: "approved", providerPaymentId: "1001" });
    expect(attempt?.providerPreferenceId).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("a refund that lands in the same window stays refunded", async () => {
    const { repository, result } = await createWhile(async (repo) => {
      await repo.attempts.applyProviderPayment(approved());
      await expect(repo.attempts.applyProviderPayment(approved({ status: "refunded" }))).resolves.toBe("refunded");
    });
    await expect(result).rejects.toBeInstanceOf(PaymentAttemptSettledError);
    expect(await repository.attempts.findByExternalReference(REFERENCE)).toMatchObject({ status: "refunded", providerPaymentId: "1001" });
  });

  it("a retried save of the same attempt after the approval changes nothing", async () => {
    const { repository, result } = await createWhile(async () => {});
    await result;
    await repository.attempts.applyProviderPayment(approved());
    await repository.attempts.save({
      id: REFERENCE,
      quoteId: "quote-1",
      idempotencyKey: "idempotency-key-0001",
      externalReference: REFERENCE,
      expectedAmountCents: 150000n,
      status: "pending",
      createdAt: new Date("2026-10-11T12:00:00Z")
    });
    expect(await repository.attempts.findByExternalReference(REFERENCE)).toMatchObject({
      status: "approved",
      providerPaymentId: "1001",
      providerPreferenceId: "pref-1"
    });
  });

  it("retrying the checkout of a paid order creates no second preference", async () => {
    const { repository, fetcher, result } = await createWhile(async () => {});
    await result;
    await repository.attempts.applyProviderPayment(approved());

    const retryFetcher = vi.fn(async () => new Response(JSON.stringify({ id: "pref-2", init_point: "https://mp.example/pay2" }), { status: 201 }));
    let ids = 0;
    await expect(
      createCheckoutProPreference(
        {
          quote: { id: "quote-1", totalCents: 150000n, expiresAt: new Date("2026-10-11T12:15:00Z") },
          customer: { name: "Ana Pérez", phone: "+5491155551234" },
          idempotencyKey: "idempotency-key-0001"
        },
        {
          config: { accessToken: "TEST-token", webhookSecret: "secret", appUrl: "https://bunker.example" },
          fetcher: retryFetcher as unknown as typeof fetch,
          attempts: repository.attempts,
          storeStatus: openStore(),
          createId: () => `retry-attempt-${++ids}`,
          now: () => new Date("2026-10-11T12:01:00Z"),
          elapsedMs: () => 0,
          inFlightMap: new Map()
        }
      )
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(retryFetcher).not.toHaveBeenCalled();
    expect(await repository.attempts.findByExternalReference(REFERENCE)).toMatchObject({ status: "approved", providerPaymentId: "1001" });
  });
});
