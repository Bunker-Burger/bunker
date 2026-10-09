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
  customer: customerSchema.optional()
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
 * P2-09: Deriva una identidad de idempotencia determinista y canónica para el checkout lógico.
 * Garantiza longitud entre 16 y 128 caracteres para compatibilidad con la restricción de BD.
 */
export function deriveLogicalCheckoutIdempotencyKey(checkout: CheckoutRequest): string {
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

  // Usar hash SHA-256 para una clave compacta y determinista (41 caracteres: checkout- + 32 hex)
  const jsonStr = JSON.stringify(canonical);
  const digest = createHash("sha256").update(jsonStr).digest("hex");
  return `checkout-${digest.slice(0, 32)}`;
}

