import { describe, expect, it, vi } from "vitest";
import type { Catalog } from "@/domain/types";
import { ok } from "@/lib/result";
import { createInMemoryPaymentRepository } from "../payments/payment-repository";
import type { PaymentQuote } from "../payments/ports";
import { checkMercadoPagoPaymentStatus } from "./mercadopago-status";

/*
 * BB-15 round 1, H2: the customer's return credits a payment only with the amount and currency
 * Mercado Pago actually reports, parsed as strictly as the webhook does. Nothing that cannot be
 * trusted approves the attempt or produces the WhatsApp link.
 */

const REFERENCE = "ref-00000001";
const catalog = { store: { whatsappE164: "+5493815550000" } } as unknown as Catalog;

function quote(totalCents = 150000n): PaymentQuote {
  return {
    id: "quote-1",
    lines: [{ productId: "p1", productName: "Smash", quantity: 1, unitPriceCents: totalCents, basePriceCents: totalCents, selectedOptions: [], notes: "" }],
    subtotalCents: totalCents,
    discountCents: 0n,
    deliveryCents: 0n,
    totalCents,
    promotion: null,
    fulfillmentChannel: "pickup",
    expiresAt: new Date("2026-10-11T12:15:00Z")
  };
}

/** Mercado Pago's payments API as the return reads it: by id, and searched by external reference. */
function provider(payments: Array<Record<string, unknown>>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/payments/search") {
      const results = payments.filter((payment) => payment.external_reference === url.searchParams.get("external_reference"));
      return Response.json({ results, paging: { total: results.length, offset: 0, limit: 30 } });
    }
    const found = payments.find((payment) => String(payment.id) === url.pathname.split("/").pop());
    return found ? Response.json(found) : Response.json({ message: "not found" }, { status: 404 });
  });
}

const mpPayment = (overrides: Record<string, unknown> = {}) => ({
  id: 1001,
  external_reference: REFERENCE,
  status: "approved",
  transaction_amount: 1500,
  currency_id: "ARS",
  ...overrides
});

async function check(payments: Array<Record<string, unknown>>, options: { paymentId?: string; quoteTotal?: bigint; now?: Date } = {}) {
  const repository = createInMemoryPaymentRepository();
  await repository.quotes.save(quote(options.quoteTotal));
  await repository.attempts.save({
    id: "attempt-1",
    quoteId: "quote-1",
    externalReference: REFERENCE,
    expectedAmountCents: 150000n,
    status: "pending",
    createdAt: new Date("2026-10-11T12:00:00Z")
  });
  const apply = vi.spyOn(repository.attempts, "applyProviderPayment");
  const result = await checkMercadoPagoPaymentStatus(
    { ref: REFERENCE, paymentId: options.paymentId ?? null },
    {
      attempts: repository.attempts,
      quotes: repository.quotes,
      loadCatalog: async () => ok(catalog),
      detectConfig: () => ({ enabled: true, config: { accessToken: "TEST-token", appUrl: "https://bunker.example" } }),
      fetcher: provider(payments) as unknown as typeof fetch,
      now: () => options.now ?? new Date("2026-10-11T12:05:00Z")
    }
  );
  return { result, apply, attempt: await repository.attempts.findByExternalReference(REFERENCE) };
}

describe("checkMercadoPagoPaymentStatus with the provider's real amounts (BB-15 R1 H2)", () => {
  it.each([
    ["searched by reference", {}],
    ["read by the payment id of the return", { paymentId: "1001" }]
  ])("approves a correct payment (%s) with the amount and currency Mercado Pago reported", async (_case, options) => {
    const { result, apply, attempt } = await check([mpPayment()], options);
    expect(result).toMatchObject({ status: "approved", paymentReference: "1001", totalCents: "150000" });
    expect(result.status === "approved" && result.whatsappUrl).toContain("1001");
    expect(apply).toHaveBeenCalledWith({ id: "1001", externalReference: REFERENCE, status: "approved", amountCents: 150000n, currency: "ARS" });
    expect(attempt).toMatchObject({ status: "approved", providerPaymentId: "1001", providerStatus: "approved" });
  });

  it.each([
    ["1500.004 over a 1500.00 quote (fraction of a cent)", mpPayment({ transaction_amount: 1500.004 })],
    ["1499.996 (rounds to the quote)", mpPayment({ transaction_amount: 1499.996 })],
    ["a null amount", mpPayment({ transaction_amount: null })],
    ["the amount as text", mpPayment({ transaction_amount: "1500.00" })],
    ["NaN as text", mpPayment({ transaction_amount: "NaN" })],
    ["a negative amount", mpPayment({ transaction_amount: -1500 })],
    ["an absurd amount", mpPayment({ transaction_amount: 1e308 })],
    ["no amount at all", mpPayment({ transaction_amount: undefined })],
    ["USD", mpPayment({ currency_id: "USD" })],
    ["no currency", mpPayment({ currency_id: undefined })],
    ["another amount", mpPayment({ transaction_amount: 1400 })],
    ["a malformed status", mpPayment({ status: "APPROVED!" })],
    ["a malformed id", mpPayment({ id: "1001; drop" })]
  ])("fails closed with %s: not approved, no WhatsApp, nothing applied", async (_case, payment) => {
    for (const options of [{}, { paymentId: "1001" }]) {
      const { result, apply, attempt } = await check([payment], options);
      expect(result).toEqual({ status: "pending", verifying: true });
      expect(apply).not.toHaveBeenCalled();
      expect(attempt?.status).toBe("pending");
      expect(attempt?.providerPaymentId).toBeUndefined();
    }
  });

  it("does not credit a payment of another reference, even if the return names it", async () => {
    const { result, apply, attempt } = await check([mpPayment({ external_reference: "ref-of-someone-else" })], { paymentId: "1001" });
    expect(result.status).not.toBe("approved");
    expect(result).not.toHaveProperty("whatsappUrl");
    expect(apply).not.toHaveBeenCalled();
    expect(attempt?.status).toBe("pending");
  });

  it("does not credit when the attempt amount and the frozen quote disagree", async () => {
    const { result, apply, attempt } = await check([mpPayment()], { quoteTotal: 140000n });
    expect(result).toEqual({ status: "pending", verifying: true });
    expect(apply).not.toHaveBeenCalled();
    expect(attempt?.status).toBe("pending");
  });

  it("does not choose between two approved payments of the same order", async () => {
    const { result, apply, attempt } = await check([mpPayment(), mpPayment({ id: 2002 })]);
    expect(result).toEqual({ status: "pending", verifying: true });
    expect(apply).not.toHaveBeenCalled();
    expect(attempt?.status).toBe("pending");
  });

  it("an untrustworthy payment next to a valid approved one keeps the order in review", async () => {
    const { result, apply } = await check([mpPayment(), mpPayment({ id: 2002, transaction_amount: 1500.004 })]);
    expect(result).toEqual({ status: "pending", verifying: true });
    expect(apply).not.toHaveBeenCalled();
  });

  it("never turns an untrustworthy payment into rejected or expired", async () => {
    const { result } = await check([mpPayment({ status: "rejected", transaction_amount: 1500.004 })]);
    expect(result).toEqual({ status: "pending", verifying: true });
  });

  it("after the quote expired, an untrustworthy payment of this order still keeps it in review, not expired", async () => {
    const afterExpiry = new Date("2026-10-11T13:00:00Z");
    for (const payment of [mpPayment({ transaction_amount: 1500.004 }), mpPayment({ currency_id: "USD" }), mpPayment({ transaction_amount: "1500" })]) {
      const { result, apply } = await check([payment], { now: afterExpiry });
      expect(result).toEqual({ status: "pending", verifying: true });
      expect(apply).not.toHaveBeenCalled();
    }
    // Control: with no payment at all, an expired quote is reported as expired.
    expect((await check([], { now: afterExpiry })).result).toEqual({ status: "expired" });
  });
});
