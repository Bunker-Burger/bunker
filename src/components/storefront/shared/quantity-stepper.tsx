import { Minus, Plus } from "lucide-react";

/** Minus / count / plus: the cart, the product detail and the combo detail all count this way. */
export function QuantityStepper({
  value,
  onDecrement,
  onIncrement,
  decrementLabel,
  incrementLabel,
  decrementDisabled = false,
  compact = false,
  valueLabel
}: {
  value: number;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementLabel: string;
  incrementLabel: string;
  decrementDisabled?: boolean;
  compact?: boolean;
  /** Spoken label of the count, when the number alone is not enough. */
  valueLabel?: string | undefined;
}) {
  return (
    <div className={compact ? "quantity-stepper compact" : "quantity-stepper"}>
      <button aria-label={decrementLabel} disabled={decrementDisabled} onClick={onDecrement} type="button"><Minus /></button>
      <strong {...(valueLabel ? { "aria-label": valueLabel } : {})}>{value}</strong>
      <button aria-label={incrementLabel} onClick={onIncrement} type="button"><Plus /></button>
    </div>
  );
}
