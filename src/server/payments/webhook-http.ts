import { z } from "zod";
import type { MercadoPagoPaymentGateway, PaymentAttemptsPort, WebhookEventsPort, WebhookNotification } from "./ports";
import { createMercadoPagoSignatureVerifier } from "./webhook-signature";
import { processMercadoPagoWebhook, WebhookRetryableError, type WebhookResult } from "./webhook";

/*
 * HTTP side of the Mercado Pago webhook (BB-15). Mercado Pago expects a 200/201 within 22 seconds
 * and retries anything else (every 15 minutes, then less often), so:
 * - 200 for everything that is settled: processed, duplicate, ignored topics and payments that
 *   cannot be credited (recorded on the event for a person to review; retrying changes nothing);
 * - 401 for an invalid signature, 400 for a malformed request;
 * - 500 when Mercado Pago or the database could not answer now, so the delivery is retried;
 * - 503 while Mercado Pago, its webhook secret or durable storage are not configured.
 * Responses never carry details; logs carry ids and outcomes, never contact data or secrets.
 */

/** Notifications are a few hundred bytes; anything far larger is not one. */
const MAX_BODY_BYTES = 16_384;

const bodySchema = z.object({
  id: z.union([z.number().int().nonnegative(), z.string().min(1).max(255)]),
  type: z.string().min(1).max(64).optional(),
  data: z.object({ id: z.union([z.number().int().nonnegative(), z.string().min(1).max(64)]) }).optional()
});

export interface WebhookHttpDependencies {
  secret: string | null;
  ports: { attempts: Required<Pick<PaymentAttemptsPort, "applyProviderPayment">>; events: WebhookEventsPort } | null;
  gateway: MercadoPagoPaymentGateway | null;
  log?: (level: "info" | "warn" | "error", entry: Record<string, string>) => void;
}

const json = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

function defaultLog(level: "info" | "warn" | "error", entry: Record<string, string>) {
  console[level](JSON.stringify({ scope: "mercado-pago-webhook", ...entry }));
}

async function readBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return undefined;
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function handleMercadoPagoWebhookRequest(request: Request, dependencies: WebhookHttpDependencies): Promise<Response> {
  const log = dependencies.log ?? defaultLog;
  if (!dependencies.secret || !dependencies.ports || !dependencies.gateway) {
    log("error", { result: "not_configured" });
    return json(503, { error: "unavailable" });
  }

  const url = new URL(request.url);
  // Legacy IPN deliveries (`?topic=…&id=…`) are unsigned: acknowledged so they stop, never processed.
  if (url.searchParams.has("topic") && !url.searchParams.has("type")) return json(200, { received: true });

  const body = bodySchema.safeParse(await readBody(request));
  const dataId = url.searchParams.get("data.id");
  const type = url.searchParams.get("type") ?? (body.success ? body.data.type : undefined);
  if (!body.success || !dataId || !/^[0-9A-Za-z_-]{1,64}$/.test(dataId) || !type) return json(400, { error: "invalid_notification" });
  // The query `data.id` is the signed one; a body that names another resource is not trusted.
  if (body.data.data && String(body.data.data.id) !== dataId) return json(400, { error: "invalid_notification" });

  const notification: WebhookNotification = {
    eventId: String(body.data.id),
    type,
    dataId,
    signature: request.headers.get("x-signature"),
    requestId: request.headers.get("x-request-id")
  };

  let result: WebhookResult;
  try {
    result = await processMercadoPagoWebhook(notification, {
      verifier: createMercadoPagoSignatureVerifier(dependencies.secret),
      events: dependencies.ports.events,
      attempts: dependencies.ports.attempts,
      gateway: dependencies.gateway
    });
  } catch (error) {
    log("error", { result: error instanceof WebhookRetryableError ? "retry" : "error", eventId: notification.eventId, paymentId: dataId });
    return json(500, { error: "retry" });
  }

  switch (result.kind) {
    case "invalid_signature":
      log("warn", { result: "invalid_signature", paymentId: dataId });
      return json(401, { error: "invalid_signature" });
    case "not_applied":
      // Credits nothing; conflicting payments and mismatches need a person (see the refunds runbook).
      log("warn", { result: "not_applied", reason: result.reason, eventId: notification.eventId, paymentId: result.paymentId });
      return json(200, { received: true });
    case "processed":
      log("info", { result: "processed", outcome: result.outcome, eventId: notification.eventId, paymentId: result.paymentId });
      return json(200, { received: true });
    default:
      return json(200, { received: true });
  }
}
