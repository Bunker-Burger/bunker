import type { PaymentMethodKind } from "./types";

/*
 * How the checkout presents each payment method. Fixed copy, never the store's free text: a
 * transfer never shows an alias or bank details; the customer asks for them on WhatsApp and sends
 * the receipt there (BB-10). The admin's "what customers see" preview uses the same list.
 */

export interface PublicPaymentOption {
  method: PaymentMethodKind;
  label: string;
  note: string;
}

/** In the order the checkout lists them. */
export const PUBLIC_PAYMENT_OPTIONS: readonly PublicPaymentOption[] = [
  { method: "mercado_pago", label: "Mercado Pago", note: "Pagá online de forma segura con tarjeta o dinero en cuenta" },
  { method: "bank_transfer", label: "Transferencia", note: "Pedí el alias por WhatsApp y enviá el comprobante por ese chat" },
  { method: "cash", label: "Efectivo exacto", note: "Tené el importe justo al recibir o retirar" }
];

export const PUBLIC_PAYMENT_NOTE = Object.fromEntries(PUBLIC_PAYMENT_OPTIONS.map((option) => [option.method, option.note])) as Record<PaymentMethodKind, string>;

/**
 * The methods a customer is offered: enabled by the store and, for Mercado Pago, operationally
 * available now (server configuration, persistence, quota). The stored preference is untouched.
 */
export function offeredPaymentOptions(enabled: readonly PaymentMethodKind[], mercadoPagoAvailable: boolean): PublicPaymentOption[] {
  return PUBLIC_PAYMENT_OPTIONS.filter((option) => enabled.includes(option.method) && (option.method !== "mercado_pago" || mercadoPagoAvailable));
}
