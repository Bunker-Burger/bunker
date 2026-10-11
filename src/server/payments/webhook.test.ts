import { describe, expect, it, vi } from "vitest";
import { checkMercadoPagoPaymentStatus } from "@/server/checkout/mercadopago-status";
import { PaymentNotFoundError, PaymentProviderUnavailableError, UnusablePaymentAmountError } from "./mercado-pago-gateway";
import { createInMemoryPaymentRepository } from "./payment-repository";
import type { MercadoPagoPaymentGateway, PaymentQuote, ProviderPayment, WebhookNotification } from "./ports";
import { createMercadoPagoSignatureVerifier, signatureManifest, signMercadoPagoManifest } from "./webhook-signature";
import { processMercadoPagoWebhook, WebhookRetryableError } from "./webhook";

/*
 * BB-15 acceptance: replay, invalid signature, mismatches, races and retries, with the real
 * signature check and the in-memory repository (same transition rules as the database).
 */

const SECRET = "test-webhook-secret";
const REFERENCE = "ref-00000001";

const quote: PaymentQuote = {
  id: "quote-1",
  lines: [{ productId: "p1", productName: "Smash", quantity: 1, unitPriceCents: 150000n, basePriceCents: 150000n, selectedOptions: [], notes: "" }],
  subtotalCents: 150000n,
  discountCents: 0n,
  deliveryCents: 0n,
  totalCents: 150000n,
  promotion: null,
  fulfillmentChannel: "pickup",
  expiresAt: new Date("2026-10-11T12:15:00Z")
};

const approvedPayment: ProviderPayment = { id: "1001", externalReference: REFERENCE, status: "approved", amountCents: 150000n, currency: "ARS" };

function notification(overrides: Partial<WebhookNotification> & { secret?: string } = {}): WebhookNotification {
  const { secret = SECRET, ...rest } = overrides;
  const dataId = rest.dataId ?? "1001";
  const requestId = rest.requestId === undefined ? "request-1" : rest.requestId;
  const ts = "1742505638683";
  return {
    eventId: "event-1",
    type: "payment",
    dataId,
    requestId,
    signature: `ts=${ts},v1=${signMercadoPagoManifest(secret, signatureManifest({ dataId, requestId, ts }))}`,
    ...rest
  };
}

async function setup(options: { payment?: ProviderPayment | (() => Promise<ProviderPayment>); now?: () => Date } = {}) {
  const repository = createInMemoryPaymentRepository(options.now ? { now: options.now } : {});
  await repository.quotes.save(quote);
  await repository.attempts.save({
    id: "attempt-1",
    quoteId: quote.id,
    idempotencyKey: "idempotency-key-0001",
    externalReference: REFERENCE,
    expectedAmountCents: 150000n,
    status: "pending",
    createdAt: new Date("2026-10-11T12:00:00Z"),
    customer: { name: "Ana Pérez", phone: "+54 9 11 5555-0001" }
  });
  const source = options.payment ?? approvedPayment;
  const getPayment = vi.fn(typeof source === "function" ? source : async () => source);
  const gateway: MercadoPagoPaymentGateway = { getPayment };
  const apply = vi.spyOn(repository.attempts, "applyProviderPayment");
  const deps = {
    verifier: createMercadoPagoSignatureVerifier(SECRET),
    events: repository.events,
    attempts: repository.attempts,
    gateway
  };
  return { repository, deps, getPayment, apply, attempt: () => repository.attempts.findByExternalReference(REFERENCE) };
}

describe("processMercadoPagoWebhook", () => {
  it("approves the attempt from the payment read in the API, keeping the contact, without anyone returning", async () => {
    const { deps, getPayment, attempt } = await setup();
    await expect(processMercadoPagoWebhook(notification(), deps)).resolves.toEqual({ kind: "processed", outcome: "approved", paymentId: "1001" });
    expect(getPayment).toHaveBeenCalledWith("1001");
    expect(await attempt()).toMatchObject({
      status: "approved",
      providerPaymentId: "1001",
      customer: { name: "Ana Pérez", phone: "+54 9 11 5555-0001" }
    });
  });

  it("replay: the same notification again is a duplicate and has no effect", async () => {
    const { deps, getPayment, apply } = await setup();
    await processMercadoPagoWebhook(notification(), deps);
    await expect(processMercadoPagoWebhook(notification(), deps)).resolves.toEqual({ kind: "duplicate" });
    expect(getPayment).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("replay under another notification id re-reads the payment and changes nothing", async () => {
    const { deps, attempt } = await setup();
    await processMercadoPagoWebhook(notification(), deps);
    await expect(processMercadoPagoWebhook(notification({ eventId: "event-2" }), deps)).resolves.toEqual({
      kind: "processed",
      outcome: "unchanged",
      paymentId: "1001"
    });
    expect(await attempt()).toMatchObject({ status: "approved", providerPaymentId: "1001" });
  });

  it.each([
    ["another secret", notification({ secret: "attacker-secret" })],
    ["a changed payment id", { ...notification(), dataId: "2002" }],
    ["no signature", { ...notification(), signature: null }]
  ])("invalid signature (%s): nothing is claimed, read or applied", async (_case, forged) => {
    const { deps, getPayment, apply, attempt } = await setup();
    const begin = vi.spyOn(deps.events, "begin");
    await expect(processMercadoPagoWebhook(forged, deps)).resolves.toEqual({ kind: "invalid_signature" });
    expect(begin).not.toHaveBeenCalled();
    expect(getPayment).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect((await attempt())?.status).toBe("pending");
  });

  it("acknowledges other topics without reading anything", async () => {
    const { deps, getPayment } = await setup();
    await expect(processMercadoPagoWebhook(notification({ type: "merchant_order" }), deps)).resolves.toEqual({ kind: "ignored", type: "merchant_order" });
    expect(getPayment).not.toHaveBeenCalled();
  });

  it.each([
    ["amount_mismatch", { amountCents: 149999n }],
    ["currency_mismatch", { currency: "USD" }],
    ["unknown_reference", { externalReference: "ref-of-someone-else" }],
    ["unknown_reference", { externalReference: null }]
  ] as const)("%s: nothing is credited and the event records why", async (reason, change) => {
    const { deps, attempt } = await setup({ payment: { ...approvedPayment, ...change } });
    await expect(processMercadoPagoWebhook(notification(), deps)).resolves.toEqual({ kind: "not_applied", reason, paymentId: "1001" });
    expect((await attempt())?.status).toBe("pending");
    // Recorded as failed: a retry from Mercado Pago may look again, still without crediting.
    await expect(deps.events.begin("event-1", "1001")).resolves.toBe("started");
  });

  it("a payment Mercado Pago does not know, or with fractions of a cent, credits nothing and is not retried forever", async () => {
    for (const error of [new PaymentNotFoundError(), new UnusablePaymentAmountError()]) {
      const { deps, attempt } = await setup({ payment: async () => { throw error; } });
      const result = await processMercadoPagoWebhook(notification(), deps);
      expect(result.kind).toBe("not_applied");
      expect((await attempt())?.status).toBe("pending");
    }
  });

  it("a second approved payment for the same order is reported, the first one stays", async () => {
    const { deps, attempt } = await setup();
    await processMercadoPagoWebhook(notification(), deps);
    deps.gateway.getPayment = async () => ({ ...approvedPayment, id: "2002" });
    await expect(processMercadoPagoWebhook(notification({ eventId: "event-2", dataId: "2002" }), deps)).resolves.toEqual({
      kind: "not_applied",
      reason: "conflicting_payment",
      paymentId: "2002"
    });
    expect(await attempt()).toMatchObject({ status: "approved", providerPaymentId: "1001" });
  });

  it("Mercado Pago down: the event is released for the next delivery, which then applies the payment", async () => {
    let down = true;
    const { deps, attempt } = await setup({
      payment: async () => {
        if (down) throw new PaymentProviderUnavailableError("503");
        return approvedPayment;
      }
    });
    await expect(processMercadoPagoWebhook(notification(), deps)).rejects.toBeInstanceOf(WebhookRetryableError);
    expect((await attempt())?.status).toBe("pending");
    down = false;
    await expect(processMercadoPagoWebhook(notification(), deps)).resolves.toMatchObject({ kind: "processed", outcome: "approved" });
  });

  it("race: two deliveries of the same notification at once apply it once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { deps, getPayment, apply } = await setup({ payment: async () => { await gate; return approvedPayment; } });
    const first = processMercadoPagoWebhook(notification(), deps);
    const second = processMercadoPagoWebhook(notification(), deps);
    release();
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.kind).sort()).toEqual(["duplicate", "processed"]);
    expect(getPayment).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("race: two notifications of the same payment at once approve it once", async () => {
    const { deps, attempt } = await setup();
    const results = await Promise.all([
      processMercadoPagoWebhook(notification({ eventId: "created" }), deps),
      processMercadoPagoWebhook(notification({ eventId: "updated" }), deps)
    ]);
    expect(results.map((result) => (result.kind === "processed" ? result.outcome : result.kind)).sort()).toEqual(["approved", "unchanged"]);
    expect(await attempt()).toMatchObject({ status: "approved", providerPaymentId: "1001" });
  });

  it("race: the webhook and the customer's return confirm the same payment once", async () => {
    const { repository, deps, attempt } = await setup();
    const fetcher = vi.fn(async () =>
      Response.json({ id: 1001, external_reference: REFERENCE, status: "approved", transaction_amount: 1500, currency_id: "ARS" })
    );
    const [webhook, returned] = await Promise.all([
      processMercadoPagoWebhook(notification(), deps),
      checkMercadoPagoPaymentStatus(
        { ref: REFERENCE, paymentId: "1001" },
        {
          attempts: repository.attempts,
          quotes: repository.quotes,
          detectConfig: () => ({ enabled: true, config: { accessToken: "t", appUrl: "https://bunker.example" } }),
          fetcher: fetcher as unknown as typeof fetch,
          now: () => new Date("2026-10-11T12:05:00Z")
        }
      )
    ]);
    expect(webhook.kind).toBe("processed");
    expect(returned).toMatchObject({ status: "approved", paymentReference: "1001" });
    expect(await attempt()).toMatchObject({ status: "approved", providerPaymentId: "1001" });
  });

  it("an abandoned claim (crashed delivery) is taken over after 60 s, not before", async () => {
    let now = new Date("2026-10-11T12:00:00Z");
    const { deps } = await setup({ now: () => now });
    await expect(deps.events.begin("event-1", "1001")).resolves.toBe("started"); // a delivery that died mid-way
    await expect(processMercadoPagoWebhook(notification(), deps)).resolves.toEqual({ kind: "duplicate" });
    now = new Date("2026-10-11T12:01:01Z");
    await expect(processMercadoPagoWebhook(notification(), deps)).resolves.toMatchObject({ kind: "processed", outcome: "approved" });
  });

  it("a failed database write is retried by the next delivery", async () => {
    const { deps, attempt } = await setup();
    const original = deps.attempts.applyProviderPayment.bind(deps.attempts);
    deps.attempts.applyProviderPayment = async () => { throw new Error("connection reset"); };
    await expect(processMercadoPagoWebhook(notification(), deps)).rejects.toBeInstanceOf(WebhookRetryableError);
    deps.attempts.applyProviderPayment = original;
    await expect(processMercadoPagoWebhook(notification(), deps)).resolves.toMatchObject({ kind: "processed", outcome: "approved" });
    expect((await attempt())?.status).toBe("approved");
  });
});
