import { describe, expect, it, vi } from "vitest";
import { PaymentProviderUnavailableError } from "./mercado-pago-gateway";
import { createInMemoryPaymentRepository } from "./payment-repository";
import type { ProviderPayment } from "./ports";
import { signatureManifest, signMercadoPagoManifest } from "./webhook-signature";
import { handleMercadoPagoWebhookRequest, type WebhookHttpDependencies } from "./webhook-http";

const SECRET = "test-webhook-secret";
const URL_BASE = "https://bunker.example/api/payments/mercado-pago/webhook";
const payment: ProviderPayment = { id: "1001", externalReference: "ref-00000001", status: "approved", amountCents: 150000n, currency: "ARS" };

function request(options: { dataId?: string; body?: unknown; rawBody?: string; secret?: string; query?: string; headers?: Record<string, string> } = {}) {
  const dataId = options.dataId ?? "1001";
  const ts = "1742505638683";
  const requestId = "request-1";
  const signature = `ts=${ts},v1=${signMercadoPagoManifest(options.secret ?? SECRET, signatureManifest({ dataId, requestId, ts }))}`;
  const body = options.rawBody ?? JSON.stringify(options.body ?? { id: 12345, type: "payment", action: "payment.updated", data: { id: dataId } });
  return new Request(`${URL_BASE}?${options.query ?? `data.id=${dataId}&type=payment`}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-signature": signature, "x-request-id": requestId, ...options.headers },
    body
  });
}

async function dependencies(getPayment: () => Promise<ProviderPayment> = async () => payment) {
  const repository = createInMemoryPaymentRepository();
  await repository.attempts.save({
    id: "attempt-1",
    quoteId: "quote-1",
    externalReference: "ref-00000001",
    expectedAmountCents: 150000n,
    status: "pending",
    createdAt: new Date()
  });
  const log = vi.fn();
  const deps: WebhookHttpDependencies = { secret: SECRET, ports: repository, gateway: { getPayment: vi.fn(getPayment) }, log };
  return { deps, repository, log };
}

describe("handleMercadoPagoWebhookRequest", () => {
  it("answers 200 and applies a signed payment notification", async () => {
    const { deps, repository } = await dependencies();
    const response = await handleMercadoPagoWebhookRequest(request(), deps);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ received: true });
    expect((await repository.attempts.findByExternalReference("ref-00000001"))?.status).toBe("approved");
  });

  it("answers 200 to a replay, without new effects", async () => {
    const { deps } = await dependencies();
    await handleMercadoPagoWebhookRequest(request(), deps);
    const response = await handleMercadoPagoWebhookRequest(request(), deps);
    expect(response.status).toBe(200);
    expect(deps.gateway?.getPayment).toHaveBeenCalledTimes(1);
  });

  it("answers 401 to an invalid signature and logs it without details", async () => {
    const { deps, repository, log } = await dependencies();
    const response = await handleMercadoPagoWebhookRequest(request({ secret: "attacker" }), deps);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_signature" });
    expect((await repository.attempts.findByExternalReference("ref-00000001"))?.status).toBe("pending");
    expect(log).toHaveBeenCalledWith("warn", { result: "invalid_signature", paymentId: "1001" });
  });

  it("answers 500 when Mercado Pago cannot be read, so the delivery is retried", async () => {
    const { deps } = await dependencies(async () => { throw new PaymentProviderUnavailableError("503"); });
    expect((await handleMercadoPagoWebhookRequest(request(), deps)).status).toBe(500);
  });

  it("answers 200 to a payment that cannot be credited (retrying would not change it) and logs the reason", async () => {
    const { deps, log } = await dependencies(async () => ({ ...payment, amountCents: 1n }));
    expect((await handleMercadoPagoWebhookRequest(request(), deps)).status).toBe(200);
    expect(log).toHaveBeenCalledWith("warn", expect.objectContaining({ result: "not_applied", reason: "amount_mismatch" }));
  });

  it("answers 503 while Mercado Pago, the webhook secret or the storage are not configured", async () => {
    const { deps } = await dependencies();
    for (const missing of [{ secret: null }, { ports: null }, { gateway: null }]) {
      expect((await handleMercadoPagoWebhookRequest(request(), { ...deps, ...missing })).status).toBe(503);
    }
  });

  it.each([
    ["no data.id", { query: "type=payment" }],
    ["a non-JSON body", { rawBody: "not json" }],
    ["a body without id", { body: { type: "payment", data: { id: "1001" } } }],
    ["a body naming another payment than the signed query", { body: { id: 1, type: "payment", data: { id: "2002" } } }],
    ["a data.id with odd characters", { dataId: "10 01", query: "data.id=10%2001&type=payment" }],
    ["an oversized body", { rawBody: JSON.stringify({ id: 1, type: "payment", pad: "x".repeat(20_000) }) }]
  ])("answers 400 to %s", async (_case, options) => {
    const { deps } = await dependencies();
    expect((await handleMercadoPagoWebhookRequest(request(options), deps)).status).toBe(400);
    expect(deps.gateway?.getPayment).not.toHaveBeenCalled();
  });

  it("acknowledges legacy IPN deliveries without processing them", async () => {
    const { deps } = await dependencies();
    const response = await handleMercadoPagoWebhookRequest(request({ query: "topic=payment&id=1001" }), deps);
    expect(response.status).toBe(200);
    expect(deps.gateway?.getPayment).not.toHaveBeenCalled();
  });

  it("acknowledges other topics without reading the payment API", async () => {
    const { deps } = await dependencies();
    const response = await handleMercadoPagoWebhookRequest(request({ query: "data.id=1001&type=merchant_order" }), deps);
    expect(response.status).toBe(200);
    expect(deps.gateway?.getPayment).not.toHaveBeenCalled();
  });
});
