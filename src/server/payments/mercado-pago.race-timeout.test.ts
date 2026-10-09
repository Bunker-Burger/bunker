import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { evaluateStoreStatus } from "@/domain/store-status";
import {
  CONCURRENT_ATTEMPT_MAX_POLLS,
  CONCURRENT_ATTEMPT_WAIT_MS,
  ConcurrentAttemptPendingError,
  createCheckoutProPreference
} from "./mercado-pago";
import type { PaymentAttempt, PaymentAttemptsPort } from "./ports";

/*
 * BB-14 R6 P1-11B. The route freezes the business clock for a whole request
 * (`const now = new Date(); now: () => now`). A loser of the idempotency race (23505) must still
 * stop waiting for a winner that never publishes its preference: within real time, with a bounded
 * number of database lookups, and without ever calling Mercado Pago itself.
 *
 * Timers and `performance` are faked; `now` is the frozen business clock, exactly as in the route.
 * No `elapsedMs` is injected, so the default monotonic clock (`performance.now()`) is what runs.
 */

const FROZEN_NOW = new Date("2026-10-09T15:00:00Z");
/** One backoff step of slack: the deadline is checked before each lookup. */
const DEADLINE_SLACK_MS = 200;

const openStore = async () =>
  evaluateStoreStatus(
    { timezone: "America/Argentina/Tucuman", statusOverride: "open", deliveryFeeCents: 120000n, businessHours: [] },
    FROZEN_NOW
  );

interface Race {
  attempts: PaymentAttemptsPort;
  winner: PaymentAttempt;
  /** `performance.now()` of every idempotency-key lookup. */
  lookups: number[];
  mercadoPagoCalls: () => number;
  fetcher: typeof fetch;
}

/**
 * The loser reads the key before the winner's insert lands (nothing yet), then its own insert
 * hits the UNIQUE constraint (23505). From then on the winner's row is visible, pending, for the
 * same quote, and without `provider_preference_id` until (if ever) the winner publishes it.
 */
function lostRace(): Race {
  const winner: PaymentAttempt = {
    id: "winner-attempt",
    quoteId: "quote-frozen",
    idempotencyKey: "race-key",
    externalReference: "winner-reference",
    expectedAmountCents: 2_000_000n,
    status: "pending",
    createdAt: FROZEN_NOW
  };
  let winnerInserted = false;
  const lookups: number[] = [];
  let calls = 0;
  return {
    winner,
    lookups,
    mercadoPagoCalls: () => calls,
    fetcher: async () => {
      calls += 1;
      return new Response(JSON.stringify({ id: "pref-loser-must-not-exist", init_point: "https://mp.example/loser" }), { status: 201 });
    },
    attempts: {
      async save() {
        winnerInserted = true;
        throw Object.assign(new Error('duplicate key value violates unique constraint "payment_attempts_idempotency_key_key"'), {
          code: "23505"
        });
      },
      async findByIdempotencyKey() {
        lookups.push(performance.now());
        return winnerInserted ? winner : null;
      },
      async findByExternalReference() {
        return null;
      },
      async markApproved() {}
    }
  };
}

function lose(race: Race, options: { signal?: AbortSignal; elapsedMs?: () => number } = {}) {
  const startedAt = performance.now();
  const outcome = createCheckoutProPreference(
    {
      quote: { id: "quote-frozen", totalCents: 2_000_000n, expiresAt: new Date(FROZEN_NOW.getTime() + 15 * 60_000) },
      customer: { name: "Ana Pérez", phone: "+5491155551234" },
      idempotencyKey: "race-key"
    },
    {
      config: { accessToken: "test-token", appUrl: "https://bunker.example" },
      fetcher: race.fetcher,
      attempts: race.attempts,
      storeStatus: openStore,
      createId: () => "loser-attempt",
      now: () => FROZEN_NOW,
      inFlightMap: new Map(),
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.elapsedMs ? { elapsedMs: options.elapsedMs } : {})
    }
  ).then(
    (value) => ({ settled: "resolved" as const, value, after: performance.now() - startedAt, startedAt }),
    (error: unknown) => ({ settled: "rejected" as const, error, after: performance.now() - startedAt, startedAt })
  );
  return outcome;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("P1-11B: lost idempotency race with a frozen business clock", () => {
  it("gives up within the real-time budget, with bounded lookups and no Mercado Pago call", async () => {
    const race = lostRace();
    const outcome = lose(race);

    await vi.advanceTimersByTimeAsync(60_000);
    const result = await outcome;

    expect(result.settled).toBe("rejected");
    expect(result.settled === "rejected" && result.error).toBeInstanceOf(ConcurrentAttemptPendingError);
    expect(result.after).toBeGreaterThanOrEqual(CONCURRENT_ATTEMPT_WAIT_MS - DEADLINE_SLACK_MS);
    expect(result.after).toBeLessThanOrEqual(CONCURRENT_ATTEMPT_WAIT_MS + DEADLINE_SLACK_MS);
    // One read before the insert, then the bounded polling of the winner; none after the deadline.
    expect(Math.max(...race.lookups) - result.startedAt).toBeLessThan(CONCURRENT_ATTEMPT_WAIT_MS);
    expect(race.lookups.length).toBeGreaterThanOrEqual(3);
    expect(race.lookups.length).toBeLessThanOrEqual(1 + CONCURRENT_ATTEMPT_MAX_POLLS);
    expect(race.mercadoPagoCalls()).toBe(0);
    // Nothing keeps polling after it gave up.
    const lookupsAtFailure = race.lookups.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(race.lookups.length).toBe(lookupsAtFailure);
  });

  it("returns the winner's preference when it is published before the deadline", async () => {
    const race = lostRace();
    setTimeout(() => {
      race.winner.providerPreferenceId = "pref-winner";
    }, 1_000);
    const outcome = lose(race);

    await vi.advanceTimersByTimeAsync(60_000);
    const result = await outcome;

    expect(result).toMatchObject({
      settled: "resolved",
      value: {
        preferenceId: "pref-winner",
        externalReference: "winner-reference",
        checkoutUrl: "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-winner"
      }
    });
    expect(result.after).toBeGreaterThanOrEqual(1_000);
    expect(result.after).toBeLessThan(CONCURRENT_ATTEMPT_WAIT_MS);
    expect(race.mercadoPagoCalls()).toBe(0);
  });

  it("stops waiting as soon as the request is aborted", async () => {
    const race = lostRace();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 500);
    const outcome = lose(race, { signal: controller.signal });

    await vi.advanceTimersByTimeAsync(60_000);
    const result = await outcome;

    expect(result.settled).toBe("rejected");
    expect(result.settled === "rejected" && result.error).toBeInstanceOf(ConcurrentAttemptPendingError);
    // Rejected when the abort fires, not at the end of the current backoff step.
    expect(result.after).toBe(500);
    expect(race.mercadoPagoCalls()).toBe(0);
  });

  it("still stops after a bounded number of lookups if the duration clock never advances", async () => {
    const race = lostRace();
    let settled = false;
    const outcome = lose(race, { elapsedMs: () => 0 }).then((result) => {
      settled = true;
      return result;
    });

    await vi.advanceTimersByTimeAsync(60_000);

    // The clock-independent cap ends the wait even though no time ever "passes".
    expect(settled).toBe(true);
    const result = await outcome;
    expect(result.settled === "rejected" && result.error).toBeInstanceOf(ConcurrentAttemptPendingError);
    expect(race.lookups).toHaveLength(1 + CONCURRENT_ATTEMPT_MAX_POLLS);
    expect(race.mercadoPagoCalls()).toBe(0);
  });
});
