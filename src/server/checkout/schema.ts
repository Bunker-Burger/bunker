import { createHash } from "node:crypto";
import { z } from "zod";

const identifier = z.string().trim().min(1).max(100);

const checkoutItemSchema = z.object({
  productId: identifier,
  quantity: z.number().int().min(1).max(20),
  optionSelections: z.record(identifier, z.array(identifier).max(20)).default({}),
  notes: z.string().trim().max(300).default("")
}).strict();

const customerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(8).max(30).regex(/^\+?[0-9 ()-]+$/, "Teléfono inválido")
}).strict();

export const untrustedCheckoutSchema = z.object({
  items: z.array(checkoutItemSchema).min(1).max(50),
  fulfilment: z.enum(["pickup", "delivery"]),
  paymentMethod: z.enum(["cash_exact", "transfer", "mercado_pago"]),
  customer: customerSchema.optional(),
  intentNonce: z.string().trim().min(4).max(128).optional()
}).strict().superRefine((checkout, context) => {
  if (checkout.paymentMethod === "mercado_pago" && !checkout.customer) {
    context.addIssue({
      code: "custom",
      message: "Mercado Pago requiere nombre y teléfono",
      path: ["customer"]
    });
  }
});

export type CheckoutRequest = z.infer<typeof untrustedCheckoutSchema>;

export function parseUntrustedCheckout(input: unknown): CheckoutRequest {
  return untrustedCheckoutSchema.parse(input);
}

/**
 * P1-10: Canonicaliza el payload del carrito y contacto del cliente.
 * Produce un digest SHA-256 determinista del contenido ordenado canónicamente.
 */
export function deriveLogicalCheckoutPayloadDigest(checkout: CheckoutRequest): string {
  const canonical = {
    customer: {
      name: checkout.customer?.name.trim().toLowerCase(),
      phone: checkout.customer?.phone.trim()
    },
    fulfilment: checkout.fulfilment,
    paymentMethod: checkout.paymentMethod,
    items: [...checkout.items]
      .map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        notes: item.notes.trim(),
        optionSelections: Object.keys(item.optionSelections)
          .sort()
          .map((k) => [k, [...(item.optionSelections[k] ?? [])].sort()])
      }))
      .sort((a, b) => a.productId.localeCompare(b.productId))
  };

  const jsonStr = JSON.stringify(canonical);
  return createHash("sha256").update(jsonStr).digest("hex");
}

/**
 * P1-10: Deriva una clave de idempotencia combinando el hash canónico del payload
 * con el nonce de intención de compra del intento (intentNonce).
 * Garantiza longitud fija de 41 caracteres (checkout- + 32 hex), satisfaciendo la restricción DB de 16..128.
 */
export function deriveLogicalCheckoutIdempotencyKey(
  checkout: CheckoutRequest,
  intentNonce?: string
): string {
  const payloadDigest = deriveLogicalCheckoutPayloadDigest(checkout);
  const nonce = intentNonce?.trim() || checkout.intentNonce?.trim();
  if (nonce) {
    const combinedDigest = createHash("sha256")
      .update(`${payloadDigest}:${nonce}`)
      .digest("hex");
    return `checkout-${combinedDigest.slice(0, 32)}`;
  }
  return `checkout-${payloadDigest.slice(0, 32)}`;
}

