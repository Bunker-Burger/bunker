import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSignatureHeader, signatureManifest, verifyMercadoPagoSignature } from "./webhook-signature";

const secret = "test-webhook-secret";

/** Signs like Mercado Pago's documentation, independently of the module under test. */
function documentedSignature(manifest: string, key = secret) {
  return createHmac("sha256", key).update(manifest).digest("hex");
}

const ts = "1742505638683";
const requestId = "bb56a2f1-6aae-46ac-982e-9dcd3581d08e";

function signed(dataId: string, overrides: Partial<{ requestId: string | null; signature: string | null }> = {}) {
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  return {
    dataId,
    requestId,
    signature: `ts=${ts},v1=${documentedSignature(manifest)}`,
    ...overrides
  };
}

describe("signatureManifest", () => {
  it("follows the documented template id;request-id;ts", () => {
    expect(signatureManifest({ dataId: "123456", requestId, ts })).toBe(`id:123456;request-id:${requestId};ts:${ts};`);
  });

  it("lowercases an alphanumeric data.id", () => {
    expect(signatureManifest({ dataId: "ORD01JQ4S4KY8", requestId, ts })).toBe(`id:ord01jq4s4ky8;request-id:${requestId};ts:${ts};`);
  });

  it("leaves out values the notification does not carry", () => {
    expect(signatureManifest({ dataId: "123", requestId: null, ts })).toBe(`id:123;ts:${ts};`);
    expect(signatureManifest({ dataId: null, requestId, ts })).toBe(`request-id:${requestId};ts:${ts};`);
  });
});

describe("parseSignatureHeader", () => {
  it("reads ts and v1 in any order and with spaces", () => {
    const v1 = "a".repeat(64);
    expect(parseSignatureHeader(`ts=${ts},v1=${v1}`)).toEqual({ ts, v1 });
    expect(parseSignatureHeader(` v1=${v1.toUpperCase()} , ts=${ts} `)).toEqual({ ts, v1 });
  });

  it.each([null, "", "v1=abc", `ts=${ts}`, `ts=abc,v1=${"a".repeat(64)}`, `ts=${ts},v1=${"g".repeat(64)}`, `ts=${ts},v1=${"a".repeat(63)}`])(
    "rejects %s",
    (header) => {
      expect(parseSignatureHeader(header)).toBeNull();
    }
  );
});

describe("verifyMercadoPagoSignature", () => {
  it("accepts a notification signed with the application's secret", () => {
    expect(verifyMercadoPagoSignature(secret, signed("123456789"))).toBe(true);
  });

  it("accepts an alphanumeric id signed in lowercase", () => {
    expect(verifyMercadoPagoSignature(secret, signed("ORD01JQ4S4KY8"))).toBe(true);
  });

  it("rejects another secret", () => {
    expect(verifyMercadoPagoSignature("another-secret", signed("123456789"))).toBe(false);
  });

  it("rejects a notification whose payment id was changed", () => {
    expect(verifyMercadoPagoSignature(secret, { ...signed("123456789"), dataId: "987654321" })).toBe(false);
  });

  it("rejects a changed request id", () => {
    expect(verifyMercadoPagoSignature(secret, signed("123456789", { requestId: "another-request" }))).toBe(false);
  });

  it("rejects a changed timestamp", () => {
    const original = signed("123456789");
    const header = String(original.signature);
    expect(verifyMercadoPagoSignature(secret, { ...original, signature: header.replace(`ts=${ts}`, "ts=1742505638684") })).toBe(false);
  });

  it("rejects a missing or malformed header and an empty secret", () => {
    expect(verifyMercadoPagoSignature(secret, signed("123456789", { signature: null }))).toBe(false);
    expect(verifyMercadoPagoSignature(secret, signed("123456789", { signature: "garbage" }))).toBe(false);
    expect(verifyMercadoPagoSignature("", signed("123456789"))).toBe(false);
  });
});
