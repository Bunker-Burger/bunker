import type { CartLine, FulfilmentMethod } from "@/domain/types";
import { formatArs } from "@/lib/money";

export type PaymentMethod = "cash" | "transfer" | "mercado-pago";

export function changeLineQuantity(lines: CartLine[], id: string, delta: number): CartLine[] {
  return lines.flatMap((line) => {
    if (line.id !== id) return [line];
    const quantity = line.quantity + delta;
    return quantity > 0 ? [{ ...line, quantity }] : [];
  });
}

export { clearOptionGroup, toggleOption } from "@/domain/options";

export function validateCashAmount(value: string, totalCents: bigint): boolean {
  if (!/^\d+$/.test(value)) return false;
  return BigInt(value) * 100n >= totalCents;
}

const fulfilmentLabels: Record<FulfilmentMethod, string> = {
  pickup: "Retiro en el local",
  delivery: "Delivery"
};

const paymentLabels: Record<PaymentMethod, string> = {
  cash: "Efectivo",
  transfer: "Transferencia",
  "mercado-pago": "Mercado Pago"
};

export function createWhatsAppUrl(input: {
  phone: string;
  fulfilment: FulfilmentMethod;
  payment: PaymentMethod;
  totalCents: bigint;
  lines: CartLine[];
  customerName?: string;
  address?: string;
}): string {
  const plainMoney = (value: bigint) => formatArs(value).replace(/\s/g, "");
  const items = input.lines.map((line) =>
    `• ${line.quantity}× ${line.productName} — ${plainMoney(line.unitPriceCents * BigInt(line.quantity))}`
  );
  const message = [
    "Hola Búnker Burger!",
    "",
    "Quiero confirmar este pedido:",
    ...items,
    "",
    ...(input.customerName?.trim() ? [`Nombre: ${input.customerName.trim()}`] : []),
    ...(input.address?.trim() ? [`Dirección: ${input.address.trim()}`] : []),
    `Modalidad: ${fulfilmentLabels[input.fulfilment]}`,
    `Pago: ${paymentLabels[input.payment]}`,
    `Total: ${plainMoney(input.totalCents)}`
  ].join("\n");
  const phone = input.phone.replace(/\D/g, "");
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}
