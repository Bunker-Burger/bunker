import type { CartLine, PromotionRule } from "./types";

/** The lines of the cart that were added from this combo. */
export const comboLines = (lines: readonly CartLine[], combo: Pick<PromotionRule, "id">) => lines.filter((line) => line.comboId === combo.id);

/**
 * How many complete combos the cart holds: the units of each included product that came from the
 * combo, divided by what one combo includes, the smallest of them.
 */
export function comboCount(lines: readonly CartLine[], combo: Pick<PromotionRule, "id" | "items">): number {
  const own = comboLines(lines, combo);
  if (combo.items.length === 0) return 0;
  return Math.min(
    ...combo.items.map((item) => {
      const units = own.filter((line) => line.productId === item.productId).reduce((total, line) => total + line.quantity, 0);
      return Math.floor(units / item.quantity);
    })
  );
}

/**
 * The cart with one combo less: what one combo includes is taken off the combo's lines, from the
 * last ones first. The last combo takes all its lines away.
 */
export function removeOneCombo(lines: readonly CartLine[], combo: Pick<PromotionRule, "id" | "items">): CartLine[] {
  if (comboCount(lines, combo) <= 1) return lines.filter((line) => line.comboId !== combo.id);
  const remaining = new Map<string, number>(combo.items.map((item) => [item.productId, item.quantity]));
  const next = [...lines].reverse().flatMap((line): CartLine[] => {
    const need = line.comboId === combo.id ? remaining.get(line.productId) ?? 0 : 0;
    if (need === 0) return [line];
    const take = Math.min(line.quantity, need);
    remaining.set(line.productId, need - take);
    return line.quantity - take > 0 ? [{ ...line, quantity: line.quantity - take }] : [];
  });
  return next.reverse();
}
