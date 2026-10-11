import { describe, expect, it, vi } from "vitest";
import {
  createMercadoPagoPaymentGateway,
  PaymentNotFoundError,
  PaymentProviderUnavailableError,
  providerAmountToCents,
  UnusablePaymentAmountError
} from "./mercado-pago-gateway";

function gatewayAnswering(status: number, body: unknown) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  return { fetcher, gateway: createMercadoPagoPaymentGateway({ accessToken: "TEST-token", fetcher: fetcher as unknown as typeof fetch }) };
}

const payment = { id: 123456789, status: "approved", external_reference: "ref-00000001", transaction_amount: 15000.5, currency_id: "ARS" };

describe("createMercadoPagoPaymentGateway", () => {
  it("reads the payment from the API with the access token and no cache", async () => {
    const { fetcher, gateway } = gatewayAnswering(200, payment);
    await expect(gateway.getPayment("123456789")).resolves.toEqual({
      id: "123456789",
      externalReference: "ref-00000001",
      status: "approved",
      amountCents: 1500050n,
      currency: "ARS"
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.mercadopago.com/v1/payments/123456789",
      expect.objectContaining({ headers: { Authorization: "Bearer TEST-token" }, cache: "no-store" })
    );
  });

  it("keeps a payment without reference as such", async () => {
    const { gateway } = gatewayAnswering(200, { ...payment, external_reference: null });
    expect((await gateway.getPayment("123456789")).externalReference).toBeNull();
  });

  it("knows a payment Mercado Pago does not have, and never asks for a non-numeric id", async () => {
    await expect(gatewayAnswering(404, {}).gateway.getPayment("123")).rejects.toBeInstanceOf(PaymentNotFoundError);
    const { fetcher, gateway } = gatewayAnswering(200, payment);
    await expect(gateway.getPayment("../users/me")).rejects.toBeInstanceOf(PaymentNotFoundError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([500, 503, 401, 429])("treats a %s as temporarily unavailable", async (status) => {
    await expect(gatewayAnswering(status, {}).gateway.getPayment("123")).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
  });

  it("treats a network failure or an unexpected body as temporarily unavailable", async () => {
    const failing = createMercadoPagoPaymentGateway({ accessToken: "t", fetcher: (async () => { throw new TypeError("network"); }) as unknown as typeof fetch });
    await expect(failing.getPayment("123")).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
    await expect(gatewayAnswering(200, { id: 123 }).gateway.getPayment("123")).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
  });

  it("does not accept another payment than the one asked for", async () => {
    await expect(gatewayAnswering(200, payment).gateway.getPayment("111")).rejects.toBeInstanceOf(PaymentProviderUnavailableError);
  });

  it("flags an amount with fractions of a cent as unusable", async () => {
    await expect(gatewayAnswering(200, { ...payment, transaction_amount: 10.005 }).gateway.getPayment("123456789")).rejects.toBeInstanceOf(
      UnusablePaymentAmountError
    );
  });
});

describe("providerAmountToCents", () => {
  it.each([
    [15000, 1500000n],
    [15000.5, 1500050n],
    [0.1 + 0.2, 30n],
    [7800.99, 780099n]
  ])("%s → %s cents", (amount, cents) => {
    expect(providerAmountToCents(amount)).toBe(cents);
  });

  it.each([10.005, 0, -5, Number.MAX_VALUE])("rejects %s", (amount) => {
    expect(providerAmountToCents(amount)).toBeNull();
  });
});
