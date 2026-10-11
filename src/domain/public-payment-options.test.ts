import { describe, expect, it } from "vitest";
import { offeredPaymentOptions } from "./public-payment-options";

describe("offeredPaymentOptions", () => {
  it("lists enabled methods in checkout order, whatever order they were enabled in", () => {
    expect(offeredPaymentOptions(["cash", "bank_transfer", "mercado_pago"], true).map((option) => option.method)).toEqual(["mercado_pago", "bank_transfer", "cash"]);
  });

  it("leaves Mercado Pago out while it is not available, even if the store enabled it", () => {
    expect(offeredPaymentOptions(["mercado_pago", "cash"], false).map((option) => option.method)).toEqual(["cash"]);
  });

  it("never offers a method the store did not enable", () => {
    expect(offeredPaymentOptions([], true)).toEqual([]);
    expect(offeredPaymentOptions(["bank_transfer"], true).map((option) => option.method)).toEqual(["bank_transfer"]);
  });

  it("describes transfers without bank details", () => {
    const [transfer] = offeredPaymentOptions(["bank_transfer"], false);
    expect(transfer?.note).toBe("Pedí el alias por WhatsApp y enviá el comprobante por ese chat");
  });
});
