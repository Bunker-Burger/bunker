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
