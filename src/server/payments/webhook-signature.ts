import { createHmac, timingSafeEqual } from "node:crypto";
import type { WebhookNotification, WebhookSignatureVerifier } from "./ports";

/*
 * Mercado Pago webhook signature (BB-15), as documented in "Webhooks › Validar origen de la
 * notificación": the `x-signature` header carries `ts=<timestamp>,v1=<hex HMAC-SHA256>`, signed
 * with the application's secret over the manifest
 *
 *   id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 *
 * where `data.id` comes from the query string (lowercased when alphanumeric) and any value
 * missing from the notification is left out of the manifest.
 *
 * Not verified against a real delivery yet (no Mercado Pago credentials, see issue #38): the
 * format follows the documentation and the tests sign with it.
 *
 * No time window on `ts`: the documentation does not say whether retries are signed again, and a
 * replayed notification only makes the server read the payment from the API once more, which is
 * idempotent (see `processMercadoPagoWebhook`).
 */

export function signatureManifest({ dataId, requestId, ts }: { dataId: string | null; requestId: string | null; ts: string | null }) {
  const id = dataId && /^[0-9a-z]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  return [id ? `id:${id};` : "", requestId ? `request-id:${requestId};` : "", ts ? `ts:${ts};` : ""].join("");
}

/** `ts` and `v1` of an `x-signature` header; null when either is missing or malformed. */
export function parseSignatureHeader(header: string | null): { ts: string; v1: string } | null {
  if (!header) return null;
  const parts = new Map<string, string>();
  for (const part of header.split(",")) {
    const [key, ...rest] = part.split("=");
    if (key && rest.length > 0) parts.set(key.trim(), rest.join("=").trim());
  }
  const ts = parts.get("ts");
  const v1 = parts.get("v1");
  if (!ts || !/^\d{1,16}$/.test(ts) || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return null;
  return { ts, v1: v1.toLowerCase() };
}

export function signMercadoPagoManifest(secret: string, manifest: string) {
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

export function verifyMercadoPagoSignature(secret: string, notification: Pick<WebhookNotification, "dataId" | "requestId" | "signature">) {
  if (!secret) return false;
  const parsed = parseSignatureHeader(notification.signature);
  if (!parsed) return false;
  const expected = Buffer.from(signMercadoPagoManifest(secret, signatureManifest({ dataId: notification.dataId, requestId: notification.requestId, ts: parsed.ts })), "hex");
  const received = Buffer.from(parsed.v1, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function createMercadoPagoSignatureVerifier(secret: string): WebhookSignatureVerifier {
  return { verify: async (notification) => verifyMercadoPagoSignature(secret, notification) };
}
