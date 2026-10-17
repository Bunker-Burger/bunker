"use client";

import { Banknote, Landmark, Wallet } from "lucide-react";
import { type PaymentMethod } from "../storefront-state";

const PAYMENT_ICONS: Record<PaymentMethod, typeof Banknote> = { "mercado-pago": Wallet, transfer: Landmark, cash: Banknote };

export function PaymentChoice({ checked, label, note, onChange, value }: { checked: boolean; label: string; note: string; onChange: () => void; value: PaymentMethod }) {
  const Icon = PAYMENT_ICONS[value];
  return (
    <label className={checked ? "payment-choice active" : "payment-choice"}>
      <input checked={checked} name="payment" onChange={onChange} type="radio" value={value} />
      <span><strong>{label}</strong><small>{note}</small></span>
      <Icon aria-hidden="true" />
    </label>
  );
}
